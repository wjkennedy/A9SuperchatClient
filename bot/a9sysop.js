#!/usr/bin/env node
const net = require('net');
const tls = require('tls');
const {
  buildCommandPayload,
  createRateLimiter,
  ircActionToLines,
  normalizeChannels,
  parseAddressedCommand,
  parseIrcLine,
  redactSecrets
} = require('../src/irc-bot-lib');

const config = {
  server: process.env.IRC_SERVER || 'testnet.inspircd.org',
  port: Number(process.env.IRC_PORT || 6697),
  tls: process.env.IRC_TLS !== 'false',
  nick: process.env.IRC_NICK || 'A9SysOp',
  username: process.env.IRC_USERNAME || 'a9sysop',
  realName: process.env.IRC_REALNAME || 'A9 Superchat Channel Operator',
  channels: normalizeChannels(process.env.IRC_CHANNELS),
  commandUrl: process.env.SUPERCHAT_COMMAND_URL,
  eventUrl: process.env.SUPERCHAT_EVENT_URL,
  botToken: process.env.SUPERCHAT_BOT_TOKEN || '',
  privateTargets: process.env.IRC_PRIVATE_TARGETS === 'true',
  reconnectMs: Math.max(5000, Number(process.env.IRC_RECONNECT_MS || 15000)),
  rateLimitPerMinute: Math.max(1, Number(process.env.IRC_COMMAND_RATE_LIMIT_PER_MINUTE || 6))
};

const forgeCallbacksEnabled = Boolean(config.commandUrl && config.eventUrl);

const allowCommand = createRateLimiter({
  limit: config.rateLimitPerMinute,
  windowMs: 60000
});

let socket = null;
let buffer = '';
let registered = false;
let reconnectTimer = null;

function log(message) {
  process.stdout.write(`[a9sysop] ${message}\n`);
}

function send(line) {
  if (!socket || socket.destroyed) return;
  socket.write(`${line}\r\n`);
}

function privmsg(target, text) {
  send(`PRIVMSG ${target} :${redactSecrets(text).replace(/[\r\n]+/g, ' ').slice(0, 450)}`);
}

async function postForge(url, payload) {
  const headers = { 'content-type': 'application/json' };
  if (config.botToken) headers['x-superchat-bot-token'] = config.botToken;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Forge callback failed with ${response.status}`);
  }
  return body;
}

function sendForgeActions(actions) {
  for (const action of actions || []) {
    for (const line of ircActionToLines(action, { privateTargets: config.privateTargets })) {
      send(line);
    }
  }
}

async function handleForgeCommand({ channel, actorNick, parsed }) {
  if (!forgeCallbacksEnabled) {
    privmsg(channel, `${actorNick}: Forge callback URLs are not configured for A9SysOp yet.`);
    return;
  }

  const rateKey = `${channel}:${actorNick}:${parsed.command}`;
  if (!allowCommand(rateKey)) {
    privmsg(channel, `${actorNick}: A9 command rate limit reached. Try again shortly.`);
    return;
  }

  const payload = buildCommandPayload({ channel, actorNick, parsed });
  const result = await postForge(config.commandUrl, payload);
  sendForgeActions(result.actions);
}

async function handleForgeEvent(payload) {
  if (!forgeCallbacksEnabled) return;
  const result = await postForge(config.eventUrl, payload);
  sendForgeActions(result.actions);
}

function handlePrivmsg(parsed) {
  const [target, text = ''] = parsed.params;
  const directMessage = target && target.toLowerCase() === config.nick.toLowerCase();
  const channel = directMessage ? parsed.nick : target;
  const command = parseAddressedCommand({
    text,
    botNick: config.nick,
    directMessage
  });

  if (!command) return;

  handleForgeCommand({
    channel,
    actorNick: parsed.nick || 'irc-user',
    parsed: command
  }).catch((error) => {
    log(`command error: ${error.message}`);
    if (channel) privmsg(channel, `${parsed.nick}: ${error.message}`);
  });
}

function handleLine(rawLine) {
  const parsed = parseIrcLine(rawLine);
  if (!parsed.command) return;

  if (parsed.command === 'PING') {
    send(`PONG ${parsed.params.join(' ')}`);
    return;
  }

  if (parsed.command === '001') {
    registered = true;
    log(`registered; joining ${config.channels.join(', ')}`);
    for (const channel of config.channels) send(`JOIN ${channel}`);
    return;
  }

  if (parsed.command === 'JOIN') {
    const channel = parsed.params[0];
    if (!channel || parsed.nick.toLowerCase() === config.nick.toLowerCase()) return;
    handleForgeEvent({
      channel,
      type: 'join',
      actorNick: parsed.nick,
      botNick: config.nick
    }).catch((error) => log(`join event error: ${error.message}`));
    return;
  }

  if (parsed.command === 'INVITE') {
    const channel = parsed.params[1];
    if (!channel) return;
    send(`JOIN ${channel}`);
    handleForgeEvent({
      channel,
      type: 'invite',
      actorNick: parsed.nick,
      botNick: config.nick,
      agentName: config.realName
    }).catch((error) => log(`invite event error: ${error.message}`));
    return;
  }

  if (parsed.command === 'PRIVMSG') {
    handlePrivmsg(parsed);
  }
}

function connect() {
  clearTimeout(reconnectTimer);
  buffer = '';
  registered = false;
  log(`connecting to ${config.server}:${config.port} tls=${config.tls}`);
  if (!forgeCallbacksEnabled) {
    log('Forge callbacks disabled; set SUPERCHAT_COMMAND_URL and SUPERCHAT_EVENT_URL to enable Rovo bridge actions');
  }

  socket = config.tls
    ? tls.connect({ host: config.server, port: config.port, servername: config.server })
    : net.connect({ host: config.server, port: config.port });

  socket.setEncoding('utf8');

  socket.on('connect', () => {
    send(`NICK ${config.nick}`);
    send(`USER ${config.username} 0 * :${config.realName}`);
  });

  socket.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines.filter(Boolean)) handleLine(line);
  });

  socket.on('error', (error) => {
    log(`socket error: ${error.message}`);
  });

  socket.on('close', () => {
    log(registered ? 'connection closed' : 'connection closed before registration');
    reconnectTimer = setTimeout(connect, config.reconnectMs);
  });
}

process.on('SIGINT', () => {
  log('shutting down');
  clearTimeout(reconnectTimer);
  if (socket && !socket.destroyed) {
    send('QUIT :A9 Superchat bridge shutting down');
    socket.end();
  }
  process.exit(0);
});

connect();
