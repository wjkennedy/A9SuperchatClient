jest.mock('@forge/resolver', () => {
  function MockResolver() {
    const definitions = {};
    return {
      define: (name, handler) => {
        definitions[name] = handler;
      },
      getDefinitions: () => definitions
    };
  }
  return { default: MockResolver };
});

const mockStorage = {
  get: jest.fn(),
  set: jest.fn()
};

const mockRequestJira = jest.fn();
const mockRequestConfluence = jest.fn();

jest.mock('@forge/api', () => ({
  route: (strings, ...values) => strings.reduce((out, part, index) => out + part + (values[index] || ''), ''),
  storage: mockStorage,
  asUser: () => ({ requestJira: mockRequestJira, requestConfluence: mockRequestConfluence }),
  asApp: () => ({ requestJira: mockRequestJira })
}));

const app = require('../src/index');

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.SUPERCHAT_BOT_TOKEN;
  delete process.env.SUPERCHAT_ALLOWED_CHANNELS;
  delete process.env.SUPERCHAT_CALLBACK_RATE_LIMIT_PER_MINUTE;
});

test('sanitizes valid settings for Forge storage', () => {
  const settings = app._private.sanitizeSettings({
    relayUrl: 'wss://relay.example.com/tenant/site',
    defaultServer: 'irc.example.com',
    defaultPort: 7001,
    defaultChannels: ['#p1', '#engineering'],
    autoConnect: true,
    transcriptRetentionDays: 120,
    allowRovoInvites: true
  });

  expect(settings.defaultPort).toBe(7001);
  expect(settings.autoConnect).toBe(true);
  expect(settings.transcriptRetentionDays).toBe(90);
  expect(settings.defaultChannels).toEqual(['#p1', '#engineering']);
});

test('rejects unsafe relay urls', () => {
  expect(() => app._private.sanitizeSettings({
    relayUrl: 'http://relay.example.com',
    defaultChannels: ['#p1']
  })).toThrow('relayUrl must be a wss:// URL');
});

test('normalizes public A9 tunnel port to WSS default', () => {
  const settings = app._private.sanitizeSettings({
    defaultServer: 'irc.a9group.net',
    defaultPort: 8097,
    defaultChannels: ['#a9superchat']
  });

  expect(settings.defaultPort).toBe(443);
});

test('sanitizes agent admin settings for default Rovo channel mappings', () => {
  const settings = app._private.sanitizeAgentAdminSettings({
    defaultAssignments: [
      {
        channel: '#p1',
        agentName: 'Portal Triage Agent',
        templateKey: 'incident-channel-operator'
      }
    ],
    templates: [
      {
        key: 'incident-channel-operator',
        name: 'Incident channel operator',
        agentName: 'Portal Triage Agent',
        description: 'Incident triage helper',
        instructions: 'Use A9 Superchat actions to work in IRC.',
        starters: ['Ask #p1 what evidence is missing'],
        actions: ['superchat-triage-action']
      }
    ],
    rovoStudioUrl: 'https://studio.atlassian.com'
  });

  expect(settings.defaultAssignments).toEqual([
    {
      channel: '#p1',
      agentName: 'Portal Triage Agent',
      templateKey: 'incident-channel-operator'
    }
  ]);
  expect(settings.templates[0].actions).toEqual(['superchat-triage-action']);
});

test('queues Rovo triage message with Jira issue context', async () => {
  mockRequestJira.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      fields: {
        summary: 'Portal outage',
        status: { name: 'Investigating' },
        priority: { name: 'Highest' },
        issuetype: { name: 'Incident' }
      }
    })
  });

  const result = await app.rovoTriageAction({
    issueKey: 'CS-123',
    channel: '#p1',
    question: 'What should support triage?'
  });

  expect(result.channel).toBe('#p1');
  expect(result.issue.summary).toBe('Portal outage');
  expect(mockStorage.set).toHaveBeenCalledTimes(2);
  expect(mockStorage.set.mock.calls[0][1].type).toBe('relay-message');
  expect(mockStorage.set.mock.calls[1][0]).toBe(app._private.agentQueueKey());
});

test('bootstrap prefers Jira identity and storage settings', async () => {
  mockRequestJira.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      accountId: 'abc-123',
      displayName: 'Ada Lovelace',
      avatarUrls: { '48x48': 'https://avatar.example/ada.png' }
    })
  });
  mockStorage.get.mockResolvedValueOnce({
    relayUrl: 'wss://relay.example.com',
    defaultChannels: ['#ops']
  });

  const result = await app.handler.bootstrap({ context: { accountId: 'abc-123' } });

  expect(result.user.suggestedNick).toBe('adalovelace');
  expect(result.settings.defaultChannels).toEqual(['#ops']);
  expect(result.agentAdminSettings.defaultAssignments[0].channel).toBe('#a9superchat');
  expect(result.capabilities.remoteRelayRequired).toBe(true);
});

test('saves agent admin settings', async () => {
  const result = await app.handler.saveAgentAdminSettings({
    payload: {
      settings: {
        defaultAssignments: [
          {
            channel: '#ops',
            agentName: 'Ops Rovo Agent',
            templateKey: 'incident-channel-operator'
          }
        ],
        templates: [
          {
            key: 'incident-channel-operator',
            name: 'Incident channel operator',
            agentName: 'Ops Rovo Agent',
            description: 'Ops incident agent',
            instructions: 'Use A9 Superchat actions from Rovo Studio.',
            starters: ['Ask #ops for missing evidence'],
            actions: ['superchat-triage-action', 'superchat-channel-summary-action']
          }
        ]
      }
    }
  });

  expect(result.settings.defaultAssignments[0].channel).toBe('#ops');
  expect(mockStorage.set).toHaveBeenCalledWith(
    app._private.agentAdminSettingsKey(),
    expect.objectContaining({
      defaultAssignments: expect.any(Array),
      templates: expect.any(Array)
    })
  );
});

test('returns recent agent queue records', async () => {
  mockStorage.get.mockResolvedValueOnce([
    {
      id: 'queue-1',
      type: 'relay-message',
      channel: '#ops',
      actor: 'A9 Superchat',
      text: 'Queued triage',
      status: 'queued',
      createdAt: '2026-05-26T12:00:00.000Z'
    }
  ]);

  const result = await app.handler.getAgentQueue({});

  expect(result.queue).toHaveLength(1);
  expect(result.queue[0]).toMatchObject({
    channel: '#ops',
    text: 'Queued triage',
    status: 'queued'
  });
});

test('invites an agent when Rovo invites are enabled', async () => {
  mockStorage.get.mockResolvedValueOnce({
    allowRovoInvites: true,
    defaultChannels: ['#p1']
  });

  const result = await app.handler.inviteAgentToChannel({
    context: { accountId: 'abc-123' },
    payload: {
      agentName: 'Portal Triage Agent',
      channel: '#p1'
    }
  });

  expect(result.agentName).toBe('Portal Triage Agent');
  expect(result.channel).toBe('#p1');
  expect(mockStorage.set).toHaveBeenCalledTimes(2);
  expect(mockStorage.set.mock.calls[0][1].type).toBe('agent-invite');
  expect(mockStorage.set.mock.calls[1][0]).toBe(app._private.agentQueueKey());
});

test('blocks agent invites when disabled in settings', async () => {
  mockStorage.get.mockResolvedValueOnce({
    allowRovoInvites: false,
    defaultChannels: ['#p1']
  });

  await expect(app.handler.inviteAgentToChannel({
    context: { accountId: 'abc-123' },
    payload: {
      agentName: 'Portal Triage Agent',
      channel: '#p1'
    }
  })).rejects.toThrow('Rovo agent invites are disabled');
});

test('queues channel summary from resolver', async () => {
  const result = await app.handler.summarizeChannel({
    context: { accountId: 'abc-123' },
    payload: {
      channel: '#p1',
      format: 'best-practice'
    }
  });

  expect(result.channel).toBe('#p1');
  expect(result.format).toBe('best-practice');
  expect(mockStorage.set).toHaveBeenCalledTimes(2);
  expect(mockStorage.set.mock.calls[0][1].type).toBe('channel-summary');
  expect(mockStorage.set.mock.calls[1][0]).toBe(app._private.agentQueueKey());
});

test('prepares browser RAG context for IRC bot handoff', async () => {
  const result = await app.handler.prepareBotContext({
    context: { accountId: 'abc-123' },
    payload: {
      channel: '#a9superchat',
      source: 'forge-browser',
      pageTitle: 'Incident CS-123',
      pageUrl: 'https://example.atlassian.net/browse/CS-123',
      transcript: ['Ada: token=super-secret-token', 'Grace: timeline is incomplete']
    }
  });

  expect(result.channel).toBe('#a9superchat');
  expect(result.ircLine).toBe(`A9SysOp: context ${result.contextId}`);
  expect(result.contextId).toMatch(/^[a-f0-9]{16}$/);
  expect(mockStorage.set).toHaveBeenCalledTimes(2);
  expect(mockStorage.set.mock.calls[0][0]).toBe(app._private.botContextKey(result.contextId));
  expect(mockStorage.set.mock.calls[0][1].transcript[0]).toContain('token=<redacted>');
  expect(mockStorage.set.mock.calls[1][1].type).toBe('bot-context-prepared');
});

test('irc context command activates browser context for a channel', async () => {
  mockStorage.get.mockResolvedValueOnce({
    channel: '#a9superchat',
    accountId: 'abc-123',
    source: 'forge-browser',
    pageTitle: 'Incident CS-123',
    pageUrl: 'https://example.atlassian.net/browse/CS-123',
    selectedText: '',
    note: 'Active IRC channel #a9superchat',
    transcript: ['Ada: timeline is incomplete'],
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString()
  });

  const response = await app.ircCommand({
    body: JSON.stringify({
      channel: '#a9superchat',
      actorNick: 'Ada',
      command: 'context',
      args: ['0123456789abcdef']
    })
  });
  const body = JSON.parse(response.body);

  expect(response.statusCode).toBe(202);
  expect(body.actions[0].text).toContain('Loaded browser context 0123456789abcdef');
  expect(mockStorage.set).toHaveBeenCalledTimes(3);
  expect(mockStorage.set.mock.calls[1][0]).toBe(app._private.activeChannelContextKey('#a9superchat'));
  expect(mockStorage.set.mock.calls[2][1].type).toBe('bot-context-activated');
});

test('irc command webtrigger returns bot help action', async () => {
  const response = await app.ircCommand({
    body: JSON.stringify({
      channel: '#a9superchat',
      actorNick: 'Ada',
      command: 'help'
    })
  });
  const body = JSON.parse(response.body);

  expect(response.statusCode).toBe(200);
  expect(body.ok).toBe(true);
  expect(body.actions[0]).toMatchObject({
    type: 'irc-message',
    channel: '#a9superchat',
    target: 'Ada'
  });
  expect(body.actions[0].text).toContain('A9 commands');
  expect(mockStorage.set).toHaveBeenCalledTimes(1);
  expect(mockStorage.set.mock.calls[0][1].type).toBe('irc-command');
});

test('irc command webtrigger queues agent invite', async () => {
  const response = await app.ircCommand({
    body: JSON.stringify({
      channel: '#a9superchat',
      actorNick: 'Ada',
      command: 'invite',
      args: ['Portal', 'Triage', 'Agent']
    })
  });
  const body = JSON.parse(response.body);

  expect(response.statusCode).toBe(202);
  expect(body.queued.agentName).toBe('Portal Triage Agent');
  expect(body.actions[0].text).toContain('Portal Triage Agent has been invited');
  expect(mockStorage.set).toHaveBeenCalledTimes(3);
  expect(mockStorage.set.mock.calls[1][1].type).toBe('agent-invite');
  expect(mockStorage.set.mock.calls[2][0]).toBe(app._private.agentQueueKey());
});

test('irc command webtrigger queues Jira-grounded ask', async () => {
  mockRequestJira.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      fields: {
        summary: 'Portal outage',
        status: { name: 'Investigating' },
        priority: { name: 'Highest' },
        issuetype: { name: 'Incident' }
      }
    })
  });

  const response = await app.ircCommand({
    body: JSON.stringify({
      channel: '#p1',
      actorNick: 'Ada',
      command: 'ask',
      args: ['CS-123', 'What', 'evidence', 'is', 'missing?']
    })
  });
  const body = JSON.parse(response.body);

  expect(response.statusCode).toBe(202);
  expect(body.queued.issue.summary).toBe('Portal outage');
  expect(body.actions[0].text).toBe('[Rovo triage] CS-123: What evidence is missing?');
  expect(mockStorage.set).toHaveBeenCalledTimes(3);
  expect(mockStorage.set.mock.calls[1][1].type).toBe('relay-message');
  expect(mockStorage.set.mock.calls[2][0]).toBe(app._private.agentQueueKey());
});

test('irc event webtrigger welcomes new joiners', async () => {
  const response = await app.ircEvent({
    body: JSON.stringify({
      channel: '#atlassian',
      type: 'join',
      actorNick: 'Ada',
      botNick: 'A9Rovo'
    })
  });
  const body = JSON.parse(response.body);

  expect(response.statusCode).toBe(200);
  expect(body.actions[0]).toMatchObject({
    type: 'irc-message',
    channel: '#atlassian',
    target: 'Ada'
  });
  expect(body.actions[0].text).toContain('Welcome to #atlassian');
  expect(mockStorage.set).toHaveBeenCalledTimes(1);
  expect(mockStorage.set.mock.calls[0][1].eventType).toBe('join');
});

test('irc event webtrigger queues invite on invite event', async () => {
  const response = await app.ircEvent({
    body: JSON.stringify({
      channel: '#a9superchat',
      type: 'invite',
      actorNick: 'Ada',
      agentName: 'Engineering Rovo Agent'
    })
  });
  const body = JSON.parse(response.body);

  expect(response.statusCode).toBe(202);
  expect(body.queued.agentName).toBe('Engineering Rovo Agent');
  expect(body.actions[0].text).toContain('Engineering Rovo Agent has been invited');
  expect(mockStorage.set).toHaveBeenCalledTimes(3);
  expect(mockStorage.set.mock.calls[1][1].type).toBe('agent-invite');
  expect(mockStorage.set.mock.calls[2][0]).toBe(app._private.agentQueueKey());
});

test('irc command webtrigger rejects invalid bot token when configured', async () => {
  process.env.SUPERCHAT_BOT_TOKEN = 'shared-secret';

  const response = await app.ircCommand({
    headers: {
      'x-superchat-bot-token': ['wrong-secret']
    },
    body: JSON.stringify({
      channel: '#a9superchat',
      actorNick: 'Ada',
      command: 'help'
    })
  });
  const body = JSON.parse(response.body);

  expect(response.statusCode).toBe(401);
  expect(body.ok).toBe(false);
  expect(mockStorage.set).not.toHaveBeenCalled();
});

test('irc command webtrigger accepts valid bot token when configured', async () => {
  process.env.SUPERCHAT_BOT_TOKEN = 'shared-secret';

  const response = await app.ircCommand({
    headers: {
      'x-superchat-bot-token': ['shared-secret']
    },
    body: JSON.stringify({
      channel: '#a9superchat',
      actorNick: 'Ada',
      command: 'help'
    })
  });

  expect(response.statusCode).toBe(200);
  expect(mockStorage.set).toHaveBeenCalledTimes(1);
});

test('irc command webtrigger enforces configured channel allowlist', async () => {
  process.env.SUPERCHAT_ALLOWED_CHANNELS = '#a9superchat,#atlassian';

  const response = await app.ircCommand({
    body: JSON.stringify({
      channel: '#random',
      actorNick: 'Ada',
      command: 'help'
    })
  });
  const body = JSON.parse(response.body);

  expect(response.statusCode).toBe(400);
  expect(body.error).toContain('not allowed');
  expect(mockStorage.set).not.toHaveBeenCalled();
});

test('irc command webtrigger enforces configured storage-backed rate limit', async () => {
  process.env.SUPERCHAT_CALLBACK_RATE_LIMIT_PER_MINUTE = '1';
  mockStorage.get.mockResolvedValueOnce(1);

  const response = await app.ircCommand({
    body: JSON.stringify({
      channel: '#a9superchat',
      actorNick: 'Ada',
      command: 'help'
    })
  });
  const body = JSON.parse(response.body);

  expect(response.statusCode).toBe(400);
  expect(body.error).toContain('rate limit');
  expect(mockStorage.set).not.toHaveBeenCalled();
});

test('irc command webtrigger redacts secrets before returning channel actions', async () => {
  mockRequestJira.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      fields: {
        summary: 'Portal outage',
        status: { name: 'Investigating' },
        priority: { name: 'Highest' },
        issuetype: { name: 'Incident' }
      }
    })
  });

  const response = await app.ircCommand({
    body: JSON.stringify({
      channel: '#p1',
      actorNick: 'Ada',
      command: 'ask',
      args: ['CS-123', 'token=super-secret-token', 'What', 'changed?']
    })
  });
  const body = JSON.parse(response.body);

  expect(response.statusCode).toBe(202);
  expect(body.actions[0].text).toContain('token=<redacted>');
  expect(body.actions[0].text).not.toContain('super-secret-token');
});
