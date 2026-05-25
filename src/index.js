const ResolverModule = require('@forge/resolver');
const api = require('@forge/api');
const crypto = require('crypto');
const { normalizeChannels, redactSecrets } = require('./irc-bot-lib');
const { route, storage } = api;

const Resolver = ResolverModule.default || ResolverModule;
const resolver = new Resolver();

const DEFAULT_SETTINGS = {
  relayUrl: '',
  defaultServer: 'irc.a9group.net',
  defaultPort: 443,
  defaultUseTls: true,
  defaultChannels: ['#a9superchat', '#atlassian'],
  autoConnect: false,
  transcriptRetentionDays: 14,
  allowRovoInvites: true,
  allowDccProxy: false
};

function userSettingsKey(accountId) {
  return `user-settings:${accountId || 'anonymous'}`;
}

function botContextKey(contextId) {
  return `bot-context:${contextId}`;
}

function activeChannelContextKey(channel) {
  const safeChannel = String(channel || 'unknown').replace(/[^a-zA-Z0-9#_-]/g, '_');
  return `active-bot-context:${safeChannel}`;
}

function channelAuditKey(channel, now = Date.now()) {
  const safeChannel = String(channel || 'unknown').replace(/[^a-zA-Z0-9#_-]/g, '_');
  return `channel-audit:${safeChannel}:${now}`;
}

function assertObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
}

function sanitizeChannel(channel) {
  const value = String(channel || '').trim();
  if (!/^[#&][A-Za-z0-9._-]{1,80}$/.test(value)) {
    throw new Error('channel must be an IRC channel name like #incident-123');
  }
  return value;
}

function sanitizeAgentName(agentName) {
  const value = String(agentName || 'A9 Superchat Channel Operator').trim();
  if (!value || value.length > 120) {
    throw new Error('agentName must be between 1 and 120 characters');
  }
  return value.replace(/[\r\n]/g, ' ');
}

function sanitizeNick(nick, fallback = 'guest') {
  const value = String(nick || fallback).trim().replace(/[^A-Za-z0-9_[\]{}\\`^|-]/g, '');
  return value.slice(0, 32) || fallback;
}

function sanitizeText(text, maxLength = 1000) {
  return redactSecrets(String(text || ''))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .slice(0, maxLength);
}

function getHeader(headers, name) {
  const wanted = String(name).toLowerCase();
  const found = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === wanted);
  const value = found && found[1];
  return Array.isArray(value) ? value[0] : value;
}

function validateBotToken(event) {
  const expected = process.env.SUPERCHAT_BOT_TOKEN;
  if (!expected) {
    return true;
  }

  const actual = getHeader(event && event.headers, 'x-superchat-bot-token');
  if (!actual || actual.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function getAllowedBotChannels() {
  if (!process.env.SUPERCHAT_ALLOWED_CHANNELS) {
    return null;
  }
  return normalizeChannels(process.env.SUPERCHAT_ALLOWED_CHANNELS, []);
}

function assertBotChannelAllowed(channel) {
  const allowedChannels = getAllowedBotChannels();
  if (allowedChannels && !allowedChannels.includes(channel)) {
    throw new Error(`IRC channel ${channel} is not allowed for A9 Superchat callbacks`);
  }
}

async function assertCallbackRateLimit({ channel, actor, action }) {
  const limit = Number(process.env.SUPERCHAT_CALLBACK_RATE_LIMIT_PER_MINUTE || 0);
  if (!limit) {
    return;
  }

  const minute = Math.floor(Date.now() / 60000);
  const key = `callback-rate:${channel}:${actor || 'unknown'}:${action || 'callback'}:${minute}`;
  const current = Number(await storage.get(key) || 0);
  if (current >= limit) {
    throw new Error('A9 Superchat callback rate limit reached');
  }
  await storage.set(key, current + 1);
}

function sanitizeSettings(settings) {
  assertObject(settings, 'settings');
  const next = { ...DEFAULT_SETTINGS, ...settings };

  next.relayUrl = String(next.relayUrl || '').trim();
  next.defaultServer = String(next.defaultServer || DEFAULT_SETTINGS.defaultServer).trim();
  next.defaultPort = Number(next.defaultPort || DEFAULT_SETTINGS.defaultPort);
  if (next.defaultServer === 'irc.a9group.net' && next.defaultPort === 8097) {
    next.defaultPort = 443;
  }
  next.defaultUseTls = Boolean(next.defaultUseTls);
  next.defaultChannels = Array.isArray(next.defaultChannels)
    ? next.defaultChannels.map(sanitizeChannel).slice(0, 20)
    : DEFAULT_SETTINGS.defaultChannels;
  next.autoConnect = Boolean(next.autoConnect);
  next.transcriptRetentionDays = Math.max(1, Math.min(90, Number(next.transcriptRetentionDays || 14)));
  next.allowRovoInvites = Boolean(next.allowRovoInvites);
  next.allowDccProxy = Boolean(next.allowDccProxy);

  if (next.relayUrl && !/^wss:\/\/[a-zA-Z0-9.-]+(?::[0-9]+)?(?:\/.*)?$/.test(next.relayUrl)) {
    throw new Error('relayUrl must be a wss:// URL');
  }

  if (!Number.isInteger(next.defaultPort) || next.defaultPort < 1 || next.defaultPort > 65535) {
    throw new Error('defaultPort must be between 1 and 65535');
  }

  return next;
}

async function getCurrentUser() {
  const jiraResponse = await api.asUser().requestJira(route`/rest/api/3/myself`);
  if (jiraResponse.ok) {
    const jiraUser = await jiraResponse.json();
    return {
      source: 'jira',
      accountId: jiraUser.accountId,
      displayName: jiraUser.displayName,
      emailAddress: jiraUser.emailAddress || null,
      avatarUrl: jiraUser.avatarUrls && (jiraUser.avatarUrls['48x48'] || jiraUser.avatarUrls['24x24'])
    };
  }

  const confluenceResponse = await api.asUser().requestConfluence(route`/wiki/rest/api/user/current`);
  if (confluenceResponse.ok) {
    const confluenceUser = await confluenceResponse.json();
    return {
      source: 'confluence',
      accountId: confluenceUser.accountId,
      displayName: confluenceUser.displayName || confluenceUser.publicName,
      emailAddress: confluenceUser.email || null,
      avatarUrl: confluenceUser.profilePicture && confluenceUser.profilePicture.path
    };
  }

  return {
    source: 'forge-context',
    accountId: null,
    displayName: 'A9 Superchat User',
    emailAddress: null,
    avatarUrl: null
  };
}

async function getSettings(accountId) {
  const stored = await storage.get(userSettingsKey(accountId));
  return sanitizeSettings(stored || DEFAULT_SETTINGS);
}

resolver.define('bootstrap', async ({ context }) => {
  const user = await getCurrentUser();
  const accountId = context && context.accountId ? context.accountId : user.accountId;
  const settings = await getSettings(accountId);

  return {
    user: {
      ...user,
      accountId,
      suggestedNick: String(user.displayName || 'superchat')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 20) || 'superchat'
    },
    settings,
    capabilities: {
      forgeStorageSettings: true,
      rovoAgentInvite: settings.allowRovoInvites,
      dccProxy: settings.allowDccProxy,
      remoteRelayRequired: true
    }
  };
});

resolver.define('saveSettings', async ({ payload, context }) => {
  const settings = sanitizeSettings(payload && payload.settings);
  await storage.set(userSettingsKey(context.accountId), settings);
  return { ok: true, settings };
});

resolver.define('recordChannelEvent', async ({ payload, context }) => {
  assertObject(payload, 'payload');
  const channel = sanitizeChannel(payload.channel);
  const event = {
    channel,
    type: String(payload.type || 'message').slice(0, 40),
    text: String(payload.text || '').slice(0, 4000),
    actor: String(payload.actor || context.accountId || 'unknown').slice(0, 120),
    createdAt: new Date().toISOString()
  };

  await storage.set(channelAuditKey(channel), event);
  return { ok: true };
});

async function fetchIssueSummary(issueKey) {
  const key = String(issueKey || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(key)) {
    throw new Error('issueKey must be a Jira issue key');
  }

  const response = await api.asApp().requestJira(route`/rest/api/3/issue/${key}?fields=summary,status,priority,issuetype,description`);
  if (!response.ok) {
    return { issueKey: key, unavailable: true };
  }

  const issue = await response.json();
  return {
    issueKey: key,
    summary: issue.fields && issue.fields.summary,
    status: issue.fields && issue.fields.status && issue.fields.status.name,
    priority: issue.fields && issue.fields.priority && issue.fields.priority.name,
    issueType: issue.fields && issue.fields.issuetype && issue.fields.issuetype.name
  };
}

async function queueRelayMessage({ channel, actor, text, issue }) {
  const message = {
    channel: sanitizeChannel(channel),
    actor: String(actor || 'A9 Superchat').slice(0, 80),
    text: String(text || '').slice(0, 1000),
    issue: issue || null,
    createdAt: new Date().toISOString(),
    status: 'queued'
  };

  await storage.set(channelAuditKey(message.channel), {
    type: 'relay-message',
    ...message
  });

  return message;
}

async function queueAgentInvite({ channel, agentName, invitedBy }) {
  const invite = {
    channel: sanitizeChannel(channel),
    agentName: sanitizeAgentName(agentName),
    invitedBy: String(invitedBy || 'unknown').slice(0, 120),
    createdAt: new Date().toISOString(),
    status: 'queued'
  };

  await storage.set(channelAuditKey(invite.channel), {
    type: 'agent-invite',
    ...invite
  });

  return invite;
}

async function rovoTriageAction(payload) {
  const issue = await fetchIssueSummary(payload.issueKey);
  const channel = sanitizeChannel(payload.channel);
  const question = String(payload.question || '').trim();
  if (!question) {
    throw new Error('question is required');
  }

  const text = `[Rovo triage] ${issue.issueKey}: ${question}`;
  return queueRelayMessage({
    channel,
    actor: 'A9 Superchat Channel Operator',
    text,
    issue
  });
}

async function rovoChannelSummaryAction(payload) {
  const channel = sanitizeChannel(payload.channel);
  const job = {
    channel,
    format: payload.format || 'rca',
    status: 'queued',
    note: 'Transcript distillation should run as an async job over retained channel-audit records.'
  };
  await storage.set(channelAuditKey(channel), {
    type: 'channel-summary',
    ...job,
    createdAt: new Date().toISOString()
  });
  return job;
}

function sanitizeBotContextPayload(payload, context) {
  assertObject(payload, 'payload');
  const channel = sanitizeChannel(payload.channel);
  const transcript = Array.isArray(payload.transcript)
    ? payload.transcript.map((line) => sanitizeText(line, 240)).filter(Boolean).slice(-25)
    : [];

  return {
    channel,
    accountId: context && context.accountId ? context.accountId : 'unknown',
    source: sanitizeText(payload.source || 'forge-browser', 80),
    pageTitle: sanitizeText(payload.pageTitle || 'A9 Superchat browser context', 160),
    pageUrl: sanitizeText(payload.pageUrl || '', 500),
    selectedText: sanitizeText(payload.selectedText || '', 1500),
    note: sanitizeText(payload.note || '', 1200),
    transcript,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
  };
}

async function prepareBotContext(payload, context) {
  const botContext = sanitizeBotContextPayload(payload, context);
  const contextId = crypto.randomBytes(8).toString('hex');
  await storage.set(botContextKey(contextId), botContext);
  await storage.set(channelAuditKey(botContext.channel), {
    type: 'bot-context-prepared',
    contextId,
    channel: botContext.channel,
    accountId: botContext.accountId,
    source: botContext.source,
    pageTitle: botContext.pageTitle,
    createdAt: botContext.createdAt,
    expiresAt: botContext.expiresAt
  });

  return {
    ok: true,
    contextId,
    channel: botContext.channel,
    expiresAt: botContext.expiresAt,
    ircLine: `A9SysOp: context ${contextId}`
  };
}

async function activateBotContext({ channel, actorNick, contextId }) {
  const id = String(contextId || '').trim();
  if (!/^[a-f0-9]{16}$/.test(id)) {
    throw new Error('context id must be a 16 character hex token');
  }

  const botContext = await storage.get(botContextKey(id));
  if (!botContext) {
    throw new Error('context id was not found or has expired');
  }
  if (new Date(botContext.expiresAt).getTime() < Date.now()) {
    throw new Error('context id has expired');
  }
  if (botContext.channel !== channel) {
    throw new Error(`context id is scoped to ${botContext.channel}`);
  }

  const activeContext = {
    ...botContext,
    contextId: id,
    activatedBy: actorNick,
    activatedAt: new Date().toISOString()
  };
  await storage.set(activeChannelContextKey(channel), activeContext);
  await storage.set(channelAuditKey(channel), {
    type: 'bot-context-activated',
    contextId: id,
    channel,
    actorNick,
    source: botContext.source,
    pageTitle: botContext.pageTitle,
    createdAt: activeContext.activatedAt
  });

  const pieces = [
    `Loaded browser context ${id}`,
    botContext.pageTitle ? `from "${botContext.pageTitle}"` : '',
    botContext.transcript.length ? `with ${botContext.transcript.length} recent channel lines` : '',
    'for this channel.'
  ].filter(Boolean);

  return {
    ok: true,
    context: activeContext,
    actions: [
      botMessage({
        channel,
        text: `${pieces.join(' ')} Ask, invite, or distill with that context in Forge.`
      })
    ]
  };
}

resolver.define('inviteAgentToChannel', async ({ payload, context }) => {
  assertObject(payload, 'payload');
  const settings = await getSettings(context.accountId);
  if (!settings.allowRovoInvites) {
    throw new Error('Rovo agent invites are disabled in A9 Superchat settings');
  }
  return queueAgentInvite({
    channel: payload.channel,
    agentName: payload.agentName,
    invitedBy: context.accountId
  });
});

resolver.define('askAgentInChannel', async ({ payload }) => {
  assertObject(payload, 'payload');
  return rovoTriageAction({
    issueKey: payload.issueKey,
    channel: payload.channel,
    question: payload.question
  });
});

resolver.define('summarizeChannel', async ({ payload }) => {
  assertObject(payload, 'payload');
  return rovoChannelSummaryAction(payload);
});

resolver.define('prepareBotContext', async ({ payload, context }) => {
  return prepareBotContext(payload, context);
});

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': ['application/json'] },
    body: JSON.stringify(body)
  };
}

function parseJsonBody(event) {
  if (!event || !event.body) {
    return {};
  }
  if (typeof event.body === 'object') {
    return event.body;
  }
  return JSON.parse(event.body);
}

function botMessage({ channel, text, target = null }) {
  return {
    type: 'irc-message',
    channel: sanitizeChannel(channel),
    target,
    text: sanitizeText(text, 450)
  };
}

async function recordBotEnvelope(channel, envelope) {
  await storage.set(channelAuditKey(channel), {
    ...envelope,
    channel,
    createdAt: new Date().toISOString()
  });
}

async function ircCommand(event) {
  try {
    if (!validateBotToken(event)) {
      return jsonResponse(401, { ok: false, error: 'Unauthorized IRC bot callback' });
    }

    const body = parseJsonBody(event);
    assertObject(body, 'body');
    const channel = sanitizeChannel(body.channel || '#a9superchat');
    const actorNick = sanitizeNick(body.actorNick, 'irc-user');
    const command = String(body.command || '').trim().replace(/^\//, '').toLowerCase();
    const args = Array.isArray(body.args) ? body.args.map((arg) => String(arg)) : [];

    assertBotChannelAllowed(channel);
    await assertCallbackRateLimit({ channel, actor: actorNick, action: command || 'help' });

    await recordBotEnvelope(channel, {
      type: 'irc-command',
      actorNick,
      command,
      args: args.slice(0, 8).map((arg) => sanitizeText(arg, 160))
    });

    if (!command || command === 'help') {
      return jsonResponse(200, {
        ok: true,
        actions: [
          botMessage({
            channel,
            target: actorNick,
            text: 'A9 commands: context ID, invite [agent], ask ISSUE-123 question, distill [rca|timeline|handoff|best-practice], help.'
          })
        ]
      });
    }

    if (command === 'invite') {
      const agentName = sanitizeAgentName(args.join(' ') || body.agentName);
      const invite = await queueAgentInvite({ channel, agentName, invitedBy: actorNick });
      return jsonResponse(202, {
        ok: true,
        queued: invite,
        actions: [
          botMessage({
            channel,
            text: `${invite.agentName} has been invited into ${channel}.`
          })
        ]
      });
    }

    if (command === 'context' || command === 'ctx' || command === 'summon') {
      const contextId = args[0] || body.contextId;
      const result = await activateBotContext({ channel, actorNick, contextId });
      return jsonResponse(202, result);
    }

    if (command === 'ask') {
      const issueKey = args[0] || body.issueKey;
      const question = sanitizeText(body.question || args.slice(1).join(' '), 700);
      const queued = await rovoTriageAction({ issueKey, channel, question });
      return jsonResponse(202, {
        ok: true,
        queued,
        actions: [
          botMessage({
            channel,
            text: queued.text
          })
        ]
      });
    }

    if (command === 'distill' || command === 'summarize' || command === 'summary') {
      const format = sanitizeText(body.format || args[0] || 'rca', 60);
      const queued = await rovoChannelSummaryAction({ channel, format });
      return jsonResponse(202, {
        ok: true,
        queued,
        actions: [
          botMessage({
            channel,
            text: `Queued ${queued.format} distillation for ${channel}.`
          })
        ]
      });
    }

    return jsonResponse(400, {
      ok: false,
      error: `Unsupported A9 command: ${command}`,
      actions: [
        botMessage({
          channel,
          target: actorNick,
          text: `Unsupported A9 command "${sanitizeText(command, 40)}". Try: help, context, invite, ask, or distill.`
        })
      ]
    });
  } catch (error) {
    return jsonResponse(400, {
      ok: false,
      error: error.message || 'Invalid IRC command callback'
    });
  }
}

async function ircEvent(event) {
  try {
    if (!validateBotToken(event)) {
      return jsonResponse(401, { ok: false, error: 'Unauthorized IRC bot callback' });
    }

    const body = parseJsonBody(event);
    assertObject(body, 'body');
    const channel = sanitizeChannel(body.channel || '#a9superchat');
    const type = String(body.type || '').trim().toLowerCase();
    const actorNick = sanitizeNick(body.actorNick, 'irc-user');
    const botNick = sanitizeNick(body.botNick, 'A9SysOp');

    assertBotChannelAllowed(channel);
    await assertCallbackRateLimit({ channel, actor: actorNick, action: type || 'event' });

    await recordBotEnvelope(channel, {
      type: 'irc-event',
      eventType: sanitizeText(type, 40),
      actorNick,
      botNick,
      text: sanitizeText(body.text, 1000)
    });

    if (type === 'join' && actorNick.toLowerCase() !== botNick.toLowerCase()) {
      return jsonResponse(200, {
        ok: true,
        actions: [
          botMessage({
            channel,
            target: actorNick,
            text: `Welcome to ${channel}. I can invite Rovo agents, ask Jira-grounded triage questions, and distill this channel. Try: help.`
          })
        ]
      });
    }

    if (type === 'invite') {
      const invite = await queueAgentInvite({
        channel,
        agentName: body.agentName || 'A9 Superchat Channel Operator',
        invitedBy: actorNick
      });
      return jsonResponse(202, {
        ok: true,
        queued: invite,
        actions: [
          botMessage({
            channel,
            text: `${invite.agentName} has been invited into ${channel}.`
          })
        ]
      });
    }

    return jsonResponse(200, { ok: true, actions: [] });
  } catch (error) {
    return jsonResponse(400, {
      ok: false,
      error: error.message || 'Invalid IRC event callback'
    });
  }
}

async function incidentIngest(event) {
  const body = parseJsonBody(event);
  const channel = sanitizeChannel(body.channel || '#incident');
  const issue = body.issueKey ? await fetchIssueSummary(body.issueKey) : null;
  const question = body.question || 'A high-priority customer issue needs triage. What evidence should support accurate routing?';

  const queued = await queueRelayMessage({
    channel,
    actor: body.actor || 'A9 Superchat Incident Ingest',
    text: question,
    issue
  });

  return {
    statusCode: 202,
    headers: { 'content-type': ['application/json'] },
    body: JSON.stringify({ ok: true, queued })
  };
}

module.exports = {
  handler: resolver.getDefinitions(),
  incidentIngest,
  ircCommand,
  ircEvent,
  rovoTriageAction,
  rovoChannelSummaryAction,
  prepareBotContext,
  _private: {
    sanitizeSettings,
    sanitizeChannel,
    sanitizeAgentName,
    sanitizeNick,
    sanitizeText,
    assertBotChannelAllowed,
    assertCallbackRateLimit,
    validateBotToken,
    userSettingsKey,
    botContextKey,
    activeChannelContextKey
  }
};
