# A9 Superchat IRC Bot Manifestation Guide

This guide describes how to manifest the persistent IRC bot that represents A9 Superchat inside IRC channels.

The Forge app owns Atlassian identity, Jira/Confluence context, Rovo actions, storage, audit envelopes, and policy. The IRC bot owns the always-on IRC presence. It listens in channels, calls Forge webtriggers when channel activity should cross into A9 Superchat, and translates Forge responses back into IRC messages.

## Bot Identity

Recommended default bot identity:

- Nick: `A9Rovo`
- Real name: `A9 Superchat Channel Operator`
- Default channels: `#a9superchat`, `#atlassian`
- Role: channel host, Rovo bridge, Jira-aware triage helper, channel distillation trigger

The bot should not pretend to be a human user. It should identify itself as the A9 Superchat/Rovo bridge and keep messages concise.

## Responsibilities

The bot should:

- Connect persistently to the selected IRC network.
- Join configured default channels.
- Watch for channel commands intended for A9 Superchat.
- Welcome new joiners when appropriate.
- Call Forge webtriggers for IRC command and event callbacks.
- Translate returned Forge `actions` into IRC `PRIVMSG` or notice output.
- Avoid logging or forwarding secrets, credentials, unrestricted logs, or private customer data.

The bot should not:

- Call Jira or Confluence APIs directly.
- Store Atlassian tokens.
- Hold Forge secrets in browser-accessible code.
- Execute MCP/tool actions without Forge-side policy approval.
- Claim that Rovo work is complete when Forge only reports it as queued.

## Forge Webtrigger URLs

After deployment, retrieve the webtrigger URLs:

```sh
forge webtrigger get-url --key superchat-irc-command
forge webtrigger get-url --key superchat-irc-event
forge webtrigger get-url --key superchat-incident-ingest
```

Configure the bot with:

```text
SUPERCHAT_COMMAND_URL=<superchat-irc-command URL>
SUPERCHAT_EVENT_URL=<superchat-irc-event URL>
SUPERCHAT_INCIDENT_INGEST_URL=<superchat-incident-ingest URL>
SUPERCHAT_BOT_TOKEN=<shared callback token>
```

If `SUPERCHAT_BOT_TOKEN` is configured in Forge, the bot must send it on every callback:

```http
x-superchat-bot-token: <shared callback token>
```

For production, set `SUPERCHAT_BOT_TOKEN` in Forge environment variables before exposing the bot publicly.

## IRC Commands

The bot should support these channel-facing commands:

```text
help
invite [agent name]
ask ISSUE-123 question text
distill [rca|timeline|handoff|best-practice|action-items|executive-summary]
```

Recommended IRC command forms:

```text
A9Rovo: help
A9Rovo: invite Portal Triage Agent
A9Rovo: ask CS-123 What evidence is missing for accurate triage?
A9Rovo: distill rca
```

The bot may also accept slash-style commands if the network/client sends them as channel text:

```text
/invite A9Rovo
/msg A9Rovo ask CS-123 What evidence is missing?
```

## Command Callback

Send command callbacks to `superchat-irc-command`.

Example request:

```json
{
  "channel": "#a9superchat",
  "actorNick": "ada",
  "command": "ask",
  "args": ["CS-123", "What evidence is missing?"]
}
```

Supported fields:

- `channel`: IRC channel beginning with `#` or `&`.
- `actorNick`: nick that issued the command.
- `command`: `help`, `invite`, `ask`, `distill`, `summarize`, or `summary`.
- `args`: command arguments as an array of strings.
- `issueKey`: optional direct issue key for `ask`.
- `question`: optional direct question text for `ask`.
- `format`: optional direct summary format for `distill`.
- `agentName`: optional direct agent name for `invite`.

Example response:

```json
{
  "ok": true,
  "queued": {
    "channel": "#a9superchat",
    "actor": "A9 Superchat Channel Operator",
    "text": "[Rovo triage] CS-123: What evidence is missing?",
    "status": "queued"
  },
  "actions": [
    {
      "type": "irc-message",
      "channel": "#a9superchat",
      "target": null,
      "text": "[Rovo triage] CS-123: What evidence is missing?"
    }
  ]
}
```

The bot should send each `irc-message` action to IRC. If `target` is present, use a private notice or a directed channel reply depending on network policy.

## Event Callback

Send channel lifecycle callbacks to `superchat-irc-event`.

Join event:

```json
{
  "channel": "#atlassian",
  "type": "join",
  "actorNick": "ada",
  "botNick": "A9Rovo"
}
```

Invite event:

```json
{
  "channel": "#a9superchat",
  "type": "invite",
  "actorNick": "ada",
  "agentName": "Engineering Rovo Agent"
}
```

Supported event types:

- `join`: Forge returns a short welcome action unless the joining nick is the bot.
- `invite`: Forge queues an agent invite and returns an acknowledgement action.

## IRC Action Translation

Forge responses use this shape:

```json
{
  "type": "irc-message",
  "channel": "#a9superchat",
  "target": "ada",
  "text": "Welcome to #a9superchat..."
}
```

Recommended translation:

- If `target` is empty: `PRIVMSG #channel :text`
- If `target` is present and the message is safe for the channel: `PRIVMSG #channel :target: text`
- If `target` is present and the message should be private: `NOTICE target :text`

Keep bot replies short. Do not dump long Jira payloads or full transcript output into IRC.

## Host Behavior

When the bot joins a configured channel:

1. Join quietly.
2. Set or read the channel topic if the network permits it.
3. On new user joins, call the event callback.
4. Post only the returned welcome action.

Recommended welcome tone:

```text
ada: Welcome to #a9superchat. I can invite Rovo agents, ask Jira-grounded triage questions, and distill this channel. Try: help.
```

For incident channels, the bot should steer toward facts:

- Jira issue key
- customer impact
- timeline
- recent changes
- current owner
- known workaround
- logs or evidence links
- open questions

## Incident Flow

1. A P1 or incident issue is created in Jira Service Management.
2. Automation or an external integration calls `superchat-incident-ingest`.
3. Forge fetches permitted issue context and queues a triage message.
4. The bot posts the queued message into the target IRC channel.
5. Humans, Rovo agents, and MCP-backed helpers collaborate in the channel.
6. A user calls `A9Rovo: distill rca`.
7. Forge queues channel distillation for RCA, handoff, best-practice, or action items.

## Security And Policy

Minimum production controls:

- Configure `SUPERCHAT_BOT_TOKEN` in Forge and bot runtime.
- Restrict bot callbacks to approved channels.
- Rate-limit repeated commands per channel and nick.
- Redact secrets before forwarding text to Forge.
- Store bounded event envelopes, not unrestricted channel logs.
- Treat Jira and Confluence as systems of record.
- Use Forge actions/resolvers for Atlassian API access.

Recommended future controls:

- Tenant installation identifier in every callback.
- HMAC signature over timestamp and raw request body.
- Replay protection with timestamp drift limits.
- Channel allowlist stored in Forge settings.
- Admin-only Rovo/MCP enablement.
- Audit view for bot commands, invites, and distillation requests.

## Minimal Bot Loop

Pseudo-code:

```js
onMessage(async (message) => {
  if (!isAddressedToBot(message)) {
    return;
  }

  const command = parseA9Command(message.text);
  const response = await postJson(process.env.SUPERCHAT_COMMAND_URL, {
    channel: message.channel,
    actorNick: message.nick,
    command: command.name,
    args: command.args
  });

  for (const action of response.actions || []) {
    sendIrcAction(action);
  }
});

onJoin(async (event) => {
  const response = await postJson(process.env.SUPERCHAT_EVENT_URL, {
    channel: event.channel,
    type: 'join',
    actorNick: event.nick,
    botNick: currentBotNick
  });

  for (const action of response.actions || []) {
    sendIrcAction(action);
  }
});
```

`postJson` should include `x-superchat-bot-token` when configured.

## Deployment Checklist

- Deploy Forge app.
- Retrieve command and event webtrigger URLs.
- Set `SUPERCHAT_BOT_TOKEN` in Forge.
- Set matching token in bot runtime.
- Configure IRC server, port, TLS, nick, real name, and channels.
- Start bot and verify it joins `#a9superchat` and `#atlassian`.
- Run `A9Rovo: help` in channel.
- Run `A9Rovo: invite A9 Superchat Channel Operator`.
- Run `A9Rovo: ask CS-123 What evidence is missing?`.
- Run `A9Rovo: distill rca`.
- Verify Forge audit envelopes are created.

## Current Limits

- Forge queues agent work and returns IRC-ready actions; it does not hold the persistent IRC socket.
- Browser refresh still creates a new browser WebSocket session for the UI Kit console.
- Full transcript summarization remains a queued job stub until the distillation worker is implemented.
- MCP execution should remain disabled until channel policy, auth, and audit controls are explicit.
