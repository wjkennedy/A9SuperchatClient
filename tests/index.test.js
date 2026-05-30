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
  mockStorage.get.mockReset();
  mockStorage.set.mockReset();
  mockRequestJira.mockReset();
  mockRequestConfluence.mockReset();
  delete process.env.SUPERCHAT_BOT_TOKEN;
  delete process.env.SUPERCHAT_BOT_TOKEN_PREVIOUS;
  delete process.env.SUPERCHAT_BOT_TOKENS;
  delete process.env.SUPERCHAT_ALLOWED_CHANNELS;
  delete process.env.SUPERCHAT_CALLBACK_RATE_LIMIT_PER_MINUTE;
  delete process.env.SUPERCHAT_INGEST_SECRET;
  delete process.env.SUPERCHAT_TRACE_RETENTION_DAYS;
  delete process.env.SUPERCHAT_ARTIFACT_METADATA_RETENTION_DAYS;
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
  expect(result.issue.contextSource).toBe('jira-asApp');
  expect(result.issue.contextStatus).toBe('ok');
  expect(result.source).toBe('rovo-action');
  expect(result.workflow).toBe('jira-grounded-triage-ask');
  expect(result.correlationId).toMatch(/^[a-f0-9]{24}:ok$/);
  expect(result.id).toMatch(/^relay-[a-f0-9]{12}$/);
  expect(mockStorage.set).toHaveBeenCalledTimes(2);
  expect(mockStorage.set.mock.calls[0][1].envelopeId).toBe(result.id);
  expect(mockStorage.set.mock.calls[0][1].type).toBe('relay-message');
  expect(mockStorage.set.mock.calls[0][1].source).toBe('rovo-action');
  expect(mockStorage.set.mock.calls[0][1].workflow).toBe('jira-grounded-triage-ask');
  expect(mockStorage.set.mock.calls[1][0]).toBe(app._private.agentQueueKey());
  expect(mockStorage.set.mock.calls[1][1][0].id).toBe(result.id);
  expect(mockStorage.set.mock.calls[1][1][0].source).toBe('rovo-action');
  expect(mockStorage.set.mock.calls[1][1][0].workflow).toBe('jira-grounded-triage-ask');
});

test('queues Rovo triage even when Jira context is unavailable', async () => {
  mockRequestJira.mockResolvedValueOnce({
    ok: false
  });

  const result = await app.rovoTriageAction({
    issueKey: 'CS-999',
    channel: '#p1',
    question: 'What should support triage?'
  });

  expect(result.issue.unavailable).toBe(true);
  expect(result.issue.contextSource).toBe('jira-asApp');
  expect(result.issue.contextStatus).toBe('unavailable');
  expect(result.correlationId).toMatch(/^[a-f0-9]{24}:unavailable$/);
  expect(result.id).toMatch(/^relay-[a-f0-9]{12}$/);
  expect(mockStorage.set).toHaveBeenCalledTimes(2);
});

test('rovo triage action enforces channel allowlist outside callback path', async () => {
  process.env.SUPERCHAT_ALLOWED_CHANNELS = '#a9superchat,#atlassian';
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

  await expect(app.rovoTriageAction({
    issueKey: 'CS-123',
    channel: '#p1',
    question: 'What should support triage?'
  })).rejects.toThrow('not allowed');
});

test('channel summary action enforces channel allowlist outside callback path', async () => {
  process.env.SUPERCHAT_ALLOWED_CHANNELS = '#a9superchat,#atlassian';

  await expect(app.rovoChannelSummaryAction({
    channel: '#p1',
    format: 'rca'
  })).rejects.toThrow('not allowed');
});

test('buildSummaryJobEnvelope returns a versioned channel-distillation schema', () => {
  const job = app._private.buildSummaryJobEnvelope({
    channel: '#a9superchat',
    format: 'timeline',
    requestedBy: 'Ada',
    source: 'irc-callback',
    window: {
      start: '2026-05-30T00:00:00Z',
      end: '2026-05-30T02:00:00Z'
    }
  });

  expect(job).toMatchObject({
    schemaVersion: 1,
    jobType: 'channel-distillation',
    channel: '#a9superchat',
    format: 'timeline',
    requestedBy: 'Ada',
    source: 'irc-callback',
    status: 'queued',
    window: {
      start: '2026-05-30T00:00:00Z',
      end: '2026-05-30T02:00:00Z'
    }
  });
  expect(job.id).toMatch(/^summary-[a-f0-9]{12}$/);
});

test('summary job envelope normalizes output format aliases', () => {
  const best = app._private.buildSummaryJobEnvelope({
    channel: '#a9superchat',
    format: 'bestpractice'
  });
  const bp = app._private.buildSummaryJobEnvelope({
    channel: '#a9superchat',
    format: 'bp'
  });

  expect(best.format).toBe('best-practice');
  expect(bp.format).toBe('best-practice');
});

test('summary job envelope rejects unsupported output format', () => {
  expect(() => app._private.buildSummaryJobEnvelope({
    channel: '#a9superchat',
    format: 'deep-dive'
  })).toThrow('format must be one of');
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
  process.env.SUPERCHAT_ARTIFACT_METADATA_RETENTION_DAYS = '200';
  const result = await app.handler.summarizeChannel({
    context: { accountId: 'abc-123' },
    payload: {
      channel: '#p1',
      format: 'best-practice'
    }
  });

  expect(result.channel).toBe('#p1');
  expect(result.format).toBe('best-practice');
  expect(result.schemaVersion).toBe(1);
  expect(result.jobType).toBe('channel-distillation');
  expect(result.id).toMatch(/^summary-[a-f0-9]{12}$/);
  expect(result.artifactMetadata.id).toMatch(/^artifact-[a-f0-9]{12}$/);
  expect(result.artifactMetadata.storageType).toBe('metadata-only');
  expect(result.artifactMetadata.retentionDays).toBe(90);
  expect(result.artifactMetadata.sourceJobId).toBe(result.id);
  expect(mockStorage.set).toHaveBeenCalledTimes(3);
  expect(mockStorage.set.mock.calls[0][1].envelopeId).toBe(result.id);
  expect(mockStorage.set.mock.calls[0][1].type).toBe('channel-summary');
  expect(mockStorage.set.mock.calls[1][0]).toBe(app._private.agentQueueKey());
  expect(mockStorage.set.mock.calls[1][1][0].workflow).toBe('channel-distillation');
  const artifactCall = mockStorage.set.mock.calls.find(([key]) => String(key).startsWith('artifact-meta:'));
  expect(artifactCall).toBeTruthy();
  expect(artifactCall[1].retentionDays).toBe(90);
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
      contractVersion: 1,
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
      contractVersion: 1,
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
      contractVersion: 1,
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

test('irc command alias ctx routes to context handler', async () => {
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
      contractVersion: 1,
      channel: '#a9superchat',
      actorNick: 'Ada',
      command: 'ctx',
      args: ['0123456789abcdef']
    })
  });
  expect(response.statusCode).toBe(202);
});

test('irc command alias summarize routes to distill handler', async () => {
  const response = await app.ircCommand({
    body: JSON.stringify({
      contractVersion: 1,
      channel: '#a9superchat',
      actorNick: 'Ada',
      command: 'summarize',
      args: ['timeline']
    })
  });
  const body = JSON.parse(response.body);

  expect(response.statusCode).toBe(202);
  expect(body.queued.format).toBe('timeline');
});

test('irc command alias ? routes to help handler', async () => {
  const response = await app.ircCommand({
    body: JSON.stringify({
      contractVersion: 1,
      channel: '#a9superchat',
      actorNick: 'Ada',
      command: '?'
    })
  });
  const body = JSON.parse(response.body);

  expect(response.statusCode).toBe(200);
  expect(body.actions[0].text).toContain('A9 commands');
});

test('bounded action sanitizer enforces max count and message bounds', () => {
  const actions = app._private.boundedIrcActions([
    { type: 'irc-message', channel: '#a9superchat', text: 'one', target: 'Ada' },
    { type: 'noop', channel: '#a9superchat', text: 'skip' },
    { type: 'irc-message', channel: '#a9superchat', text: 'x'.repeat(1000), target: 'Ada' },
    { type: 'irc-message', channel: '#a9superchat', text: 'three', target: 'Ada' },
    { type: 'irc-message', channel: '#a9superchat', text: 'four', target: 'Ada' }
  ]);

  expect(actions).toHaveLength(2);
  expect(actions[0].text).toBe('one');
  expect(actions[1].text.length).toBeLessThanOrEqual(300);
});

test('irc event webtrigger welcomes new joiners', async () => {
  const response = await app.ircEvent({
    body: JSON.stringify({
      contractVersion: 1,
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
      contractVersion: 1,
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
      contractVersion: 1,
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
      contractVersion: 1,
      channel: '#a9superchat',
      actorNick: 'Ada',
      command: 'help'
    })
  });

  expect(response.statusCode).toBe(200);
  expect(mockStorage.set).toHaveBeenCalledTimes(1);
});

test('irc command webtrigger accepts previous bot token during rotation', async () => {
  process.env.SUPERCHAT_BOT_TOKEN = 'new-secret';
  process.env.SUPERCHAT_BOT_TOKEN_PREVIOUS = 'old-secret';

  const response = await app.ircCommand({
    headers: {
      'x-superchat-bot-token': ['old-secret']
    },
    body: JSON.stringify({
      contractVersion: 1,
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
      contractVersion: 1,
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
  mockStorage.get.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

  const response = await app.ircCommand({
    body: JSON.stringify({
      contractVersion: 1,
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

test('callback rate limit is enforced across different actions in same minute', async () => {
  process.env.SUPERCHAT_CALLBACK_RATE_LIMIT_PER_MINUTE = '2';
  const memory = new Map();
  mockStorage.get.mockImplementation(async (key) => memory.get(key) || 0);
  mockStorage.set.mockImplementation(async (key, value) => {
    memory.set(key, value);
  });

  const first = await app.ircCommand({
    body: JSON.stringify({
      contractVersion: 1,
      channel: '#a9superchat',
      actorNick: 'Ada',
      command: 'help'
    })
  });
  const second = await app.ircCommand({
    body: JSON.stringify({
      contractVersion: 1,
      channel: '#a9superchat',
      actorNick: 'Ada',
      command: 'invite',
      args: ['Ops', 'Agent']
    })
  });
  const third = await app.ircCommand({
    body: JSON.stringify({
      contractVersion: 1,
      channel: '#a9superchat',
      actorNick: 'Ada',
      command: 'distill',
      args: ['rca']
    })
  });
  const thirdBody = JSON.parse(third.body);

  expect(first.statusCode).toBe(200);
  expect(second.statusCode).toBe(202);
  expect(third.statusCode).toBe(400);
  expect(thirdBody.error).toContain('rate limit');
});

test('callback rate limit resets on next minute bucket', async () => {
  process.env.SUPERCHAT_CALLBACK_RATE_LIMIT_PER_MINUTE = '1';
  const memory = new Map();
  mockStorage.get.mockImplementation(async (key) => memory.get(key) || 0);
  mockStorage.set.mockImplementation(async (key, value) => {
    memory.set(key, value);
  });
  const nowSpy = jest.spyOn(Date, 'now');
  nowSpy.mockReturnValue(1000);

  const first = await app.ircCommand({
    body: JSON.stringify({
      contractVersion: 1,
      channel: '#a9superchat',
      actorNick: 'Ada',
      command: 'help'
    })
  });
  nowSpy.mockReturnValue(61000);
  const second = await app.ircCommand({
    body: JSON.stringify({
      contractVersion: 1,
      channel: '#a9superchat',
      actorNick: 'Ada',
      command: 'help'
    })
  });
  nowSpy.mockRestore();

  expect(first.statusCode).toBe(200);
  expect(second.statusCode).toBe(200);
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
      contractVersion: 1,
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

test('irc command webtrigger rejects unsupported callback contract version', async () => {
  const response = await app.ircCommand({
    body: JSON.stringify({
      contractVersion: 2,
      channel: '#a9superchat',
      actorNick: 'Ada',
      command: 'help'
    })
  });
  const body = JSON.parse(response.body);

  expect(response.statusCode).toBe(400);
  expect(body.error).toContain('Unsupported callback contractVersion');
});

test('irc command webtrigger rejects non-array args', async () => {
  const response = await app.ircCommand({
    body: JSON.stringify({
      contractVersion: 1,
      channel: '#a9superchat',
      actorNick: 'Ada',
      command: 'ask',
      args: 'CS-123 what changed'
    })
  });
  const body = JSON.parse(response.body);

  expect(response.statusCode).toBe(400);
  expect(body.error).toContain('args must be an array');
});

test('incident ingest rejects invalid signature when secret is configured', async () => {
  process.env.SUPERCHAT_INGEST_SECRET = 'ingest-secret';

  const response = await app.incidentIngest({
    headers: { 'x-superchat-signature': ['sha256=wrong'] },
    body: JSON.stringify({
      channel: '#p1',
      question: 'Need triage'
    })
  });
  const body = JSON.parse(response.body);

  expect(response.statusCode).toBe(401);
  expect(body.error).toContain('Invalid incident ingest signature');
});

test('incident ingest honors idempotency key and deduplicates retries', async () => {
  let idempotencyReads = 0;
  mockStorage.get.mockImplementation(async (key) => {
    if (String(key).startsWith('ingest-idempotency:')) {
      idempotencyReads += 1;
      return idempotencyReads === 1 ? null : { status: 'complete', queued: { id: 'relay-1' } };
    }
    return null;
  });

  const first = await app.incidentIngest({
    headers: { 'x-idempotency-key': ['abc-123'] },
    body: JSON.stringify({
      channel: '#p1',
      question: 'Need triage'
    })
  });
  const second = await app.incidentIngest({
    headers: { 'x-idempotency-key': ['abc-123'] },
    body: JSON.stringify({
      channel: '#p1',
      question: 'Need triage'
    })
  });

  const firstBody = JSON.parse(first.body);
  const secondBody = JSON.parse(second.body);
  expect(first.statusCode).toBe(202);
  expect(firstBody.ok).toBe(true);
  expect(second.statusCode).toBe(202);
  expect(secondBody.duplicate).toBe(true);
});

test('incident ingest records malformed payload and returns 400', async () => {
  const response = await app.incidentIngest({
    body: '{"channel":"#p1", "question":'
  });
  const body = JSON.parse(response.body);

  expect(response.statusCode).toBe(400);
  expect(body.ok).toBe(false);
  expect(mockStorage.set).toHaveBeenCalled();
});

test('incident ingest normalizes trace translation envelope fields', async () => {
  const response = await app.incidentIngest({
    headers: { 'x-trace-id': ['trace-hdr-123'] },
    body: JSON.stringify({
      channel: '#p1',
      trace: {
        frontend: { name: 'portal-ui', version: '1.2.3', region: 'us-east-1' },
        backend: { service: 'incident-api', version: '2026.05.30', region: 'us-west-2' }
      }
    })
  });
  const body = JSON.parse(response.body);

  expect(response.statusCode).toBe(202);
  expect(body.translation).toMatchObject({
    traceId: 'trace-hdr-123',
    frontend: {
      service: 'portal-ui',
      version: '1.2.3',
      region: 'us-east-1'
    },
    backend: {
      service: 'incident-api',
      version: '2026.05.30',
      region: 'us-west-2'
    }
  });
  expect(body.translation.confidence).toMatchObject({
    score: 1,
    populatedFields: 7,
    totalFields: 7,
    missingFields: []
  });
});

test('trace translation confidence reflects missing enrichment fields', () => {
  const normalized = app._private.normalizeTraceEnvelope(
    { headers: {} },
    {
      traceId: 'trace-only',
      frontend: { service: 'portal-ui' }
    }
  );

  expect(normalized.confidence.score).toBeLessThan(1);
  expect(normalized.confidence.missingFields).toContain('backend.service');
  expect(normalized.confidence.missingFields).toContain('frontend.version');
});

test('incident ingest persists trace translation with bounded retention', async () => {
  process.env.SUPERCHAT_TRACE_RETENTION_DAYS = '45';

  const response = await app.incidentIngest({
    body: JSON.stringify({
      channel: '#p1',
      traceId: 'trace-retention-1',
      frontend: { service: 'portal-ui' }
    })
  });
  const body = JSON.parse(response.body);

  expect(response.statusCode).toBe(202);
  expect(body.translationRecord.retentionDays).toBe(30);
  expect(body.translationRecord.expiresAt).toBeTruthy();
  const persistedCall = mockStorage.set.mock.calls.find(([key]) => String(key).startsWith('trace-translation:'));
  expect(persistedCall).toBeTruthy();
  expect(persistedCall[1].retentionDays).toBe(30);
});

test('incident ingest deduplicates repeated payloads without explicit idempotency key', async () => {
  const memory = new Map();
  mockStorage.get.mockImplementation(async (key) => memory.get(key));
  mockStorage.set.mockImplementation(async (key, value) => {
    memory.set(key, value);
  });

  const event = {
    body: JSON.stringify({
      channel: '#p1',
      question: 'Same payload'
    })
  };

  const first = await app.incidentIngest(event);
  const second = await app.incidentIngest(event);
  const secondBody = JSON.parse(second.body);

  expect(first.statusCode).toBe(202);
  expect(second.statusCode).toBe(202);
  expect(secondBody.duplicate).toBe(true);
});

test('incident ingest returns retryLater while same payload is processing', async () => {
  mockStorage.get.mockResolvedValueOnce({ status: 'processing' });

  const response = await app.incidentIngest({
    headers: { 'x-idempotency-key': ['processing-1'] },
    body: JSON.stringify({
      channel: '#p1',
      question: 'Still processing'
    })
  });
  const body = JSON.parse(response.body);

  expect(response.statusCode).toBe(202);
  expect(body.retryLater).toBe(true);
});
