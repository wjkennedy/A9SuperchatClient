import React, { useEffect, useMemo, useRef, useState } from 'react';
import ForgeReconciler, {
  Badge,
  Box,
  Button,
  ButtonGroup,
  Checkbox,
  CodeBlock,
  EmptyState,
  Form,
  FormFooter,
  FormHeader,
  FormSection,
  Heading,
  HelperMessage,
  Icon,
  Inline,
  Label,
  Lozenge,
  SectionMessage,
  SectionMessageAction,
  Select,
  Spinner,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Tag,
  TagGroup,
  Text,
  TextArea,
  Textfield,
  Tooltip,
  useProductContext,
  xcss
} from '@forge/react';
import { invoke } from '@forge/bridge';

const DEFAULT_FORM = {
  relayUrl: '',
  defaultServer: 'irc.a9group.net',
  defaultPort: 443,
  defaultUseTls: true,
  defaultChannels: '#a9superchat,#atlassian',
  autoConnect: false,
  transcriptRetentionDays: 14,
  allowRovoInvites: true,
  allowDccProxy: false
};

const DEFAULT_AGENT_FORM = {
  agentName: 'A9 Superchat Channel Operator',
  channel: '#p1',
  issueKey: '',
  question: 'What evidence should support accurate triage?',
  summaryFormat: 'rca'
};

const DEFAULT_AGENT_ADMIN_FORM = {
  channel: '#a9superchat',
  agentName: 'A9 Superchat Channel Operator',
  templateKey: 'incident-channel-operator'
};

const DEFAULT_AGENT_ADMIN_SETTINGS = {
  defaultAssignments: [
    {
      channel: '#a9superchat',
      agentName: 'A9 Superchat Channel Operator',
      templateKey: 'incident-channel-operator'
    }
  ],
  templates: [
    {
      key: 'incident-channel-operator',
      name: 'Incident channel operator',
      agentName: 'A9 Superchat Channel Operator',
      description: 'Joins incident IRC channels, asks Jira-grounded triage questions, and distills retained transcript evidence.',
      instructions: 'Create a Rovo agent that can use the A9 Superchat actions. It should ask concise triage questions in the configured IRC channel, use Jira issue context when available, summarize channel evidence, and never post secrets or private customer data into IRC.',
      starters: [
        'Ask #a9superchat what evidence is missing for this incident',
        'Distill #a9superchat into an RCA draft'
      ],
      actions: ['superchat-triage-action', 'superchat-channel-summary-action']
    }
  ],
  rovoStudioUrl: 'https://studio.atlassian.com'
};

const DEFAULT_TESTER = {
  url: 'wss://irc.a9group.net',
  nick: '',
  wsType: 'text',
  rawLine: '',
  follow: true,
  respondToPings: true
};

const CONSOLE_STATE_KEY = 'a9-superchat-console-state-v1';
const IRC_WEBSOCKET_PROTOCOLS = ['text.ircv3.net', 'binary.ircv3.net'];
const VIEW_ORDER = ['console', 'admin', 'agents', 'audit'];
const VIEW_LABELS = {
  console: 'Connect',
  admin: 'Admin',
  agents: 'Agents',
  audit: 'Audit'
};
const TESTER_PROTOCOL_OPTIONS = [
  { label: 'Text IRCv3', value: 'text' },
  { label: 'Binary IRCv3', value: 'binary' },
  { label: 'No subprotocol', value: 'none' }
];
const SUMMARY_FORMAT_OPTIONS = [
  { label: 'Root cause analysis', value: 'rca' },
  { label: 'Timeline', value: 'timeline' },
  { label: 'Handoff', value: 'handoff' },
  { label: 'Best practices', value: 'best-practice' },
  { label: 'Short summary', value: 'summary' }
];
const pageHeaderStyles = xcss({
  borderColor: 'color.border',
  borderStyle: 'solid',
  borderWidth: 'border.width',
  borderRadius: 'radius.small',
  padding: 'space.200',
  backgroundColor: 'color.background.neutral.subtle'
});
const surfaceStyles = xcss({
  borderColor: 'color.border',
  borderStyle: 'solid',
  borderWidth: 'border.width',
  borderRadius: 'radius.small',
  padding: 'space.200'
});
const subtleSurfaceStyles = xcss({
  borderColor: 'color.border',
  borderStyle: 'solid',
  borderWidth: 'border.width',
  borderRadius: 'radius.small',
  padding: 'space.150',
  backgroundColor: 'color.background.neutral.subtle'
});
const sidebarStyles = xcss({
  borderColor: 'color.border',
  borderStyle: 'solid',
  borderWidth: 'border.width',
  borderRadius: 'radius.small',
  padding: 'space.150',
  width: '220px'
});
const composerInputStyles = xcss({
  width: '50%'
});
const scrollbackBoxStyles = xcss({
  maxHeight: '480px',
  overflowY: 'auto',
  overflowX: 'auto',
  borderColor: 'color.border',
  borderStyle: 'solid',
  borderWidth: 'border.width',
  borderRadius: 'radius.small'
});

function loadConsoleState() {
  try {
    const raw = window.localStorage.getItem(CONSOLE_STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function saveConsoleState(state) {
  try {
    window.localStorage.setItem(CONSOLE_STATE_KEY, JSON.stringify(state));
  } catch (err) {
    // Ignore storage failures; chat should still work without persistence.
  }
}

function timestamp() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function parseIrcLine(rawLine) {
  let line = String(rawLine || '');
  if (line.startsWith('@')) line = line.substring(line.indexOf(' ') + 1).trimStart();
  let prefix = '';
  if (line.startsWith(':')) {
    const spaceIndex = line.indexOf(' ');
    prefix = line.substring(1, spaceIndex);
    line = line.substring(spaceIndex + 1).trimStart();
  }
  const trailingIndex = line.indexOf(' :');
  let trailing = '';
  if (trailingIndex !== -1) {
    trailing = line.substring(trailingIndex + 2);
    line = line.substring(0, trailingIndex);
  }
  const parts = line.split(' ').filter(Boolean);
  return {
    prefix,
    nick: prefix.split('!')[0],
    command: (parts.shift() || '').toUpperCase(),
    params: trailing ? parts.concat(trailing) : parts,
    raw: rawLine
  };
}

function normalizeSettings(settings) {
  const normalized = {
    ...DEFAULT_FORM,
    ...settings,
    defaultChannels: Array.isArray(settings?.defaultChannels)
      ? settings.defaultChannels.join(',')
      : settings?.defaultChannels || DEFAULT_FORM.defaultChannels
  };
  if (normalized.defaultServer === 'irc.a9group.net' && Number(normalized.defaultPort) === 8097) {
    normalized.defaultPort = 443;
  }
  return normalized;
}

function assembleWebSocketUrl({ server, port, useTls }) {
  const protocol = useTls ? 'wss' : 'ws';
  const numericPort = Number(port);
  const defaultPort = useTls ? 443 : 80;
  const portSuffix = numericPort && numericPort !== defaultPort ? `:${numericPort}` : '';
  return `${protocol}://${server}${portSuffix}`;
}

function normalizePublicEndpoint(parsedUrl) {
  if (parsedUrl.hostname === 'irc.a9group.net' && (parsedUrl.port === '8097' || parsedUrl.port === '')) {
    return {
      server: parsedUrl.hostname,
      port: 443,
      useTls: true
    };
  }
  return {
    server: parsedUrl.hostname,
    port: Number(parsedUrl.port || (parsedUrl.protocol === 'wss:' ? 443 : 80)),
    useTls: parsedUrl.protocol === 'wss:'
  };
}

function normalizePublicWebSocketUrl(url) {
  const parsedUrl = new URL(url);
  const endpoint = normalizePublicEndpoint(parsedUrl);
  return assembleWebSocketUrl(endpoint);
}

function hasConnectionConfig(settings) {
  return Boolean(settings?.defaultServer && Number(settings?.defaultPort));
}

function normalizeAgentAdminSettings(settings) {
  return {
    ...DEFAULT_AGENT_ADMIN_SETTINGS,
    ...settings,
    defaultAssignments: Array.isArray(settings?.defaultAssignments) && settings.defaultAssignments.length
      ? settings.defaultAssignments
      : DEFAULT_AGENT_ADMIN_SETTINGS.defaultAssignments,
    templates: Array.isArray(settings?.templates) && settings.templates.length
      ? settings.templates
      : DEFAULT_AGENT_ADMIN_SETTINGS.templates
  };
}

function buildRovoStudioPrompt(template, assignment) {
  const starters = (template.starters || []).map((starter) => `- ${starter}`).join('\n');
  const actions = (template.actions || []).map((action) => `- ${action}`).join('\n');
  return [
    `Agent name: ${assignment.agentName || template.agentName}`,
    `Default IRC channel: ${assignment.channel}`,
    '',
    'Purpose:',
    template.description,
    '',
    'Instructions:',
    template.instructions,
    '',
    'Conversation starters:',
    starters,
    '',
    'Required A9 Superchat actions:',
    actions
  ].join('\n');
}

function applySmartValues(text, context) {
  const replacements = {
    channel: context.activeConsoleWindow,
    nick: context.consoleNick || context.consoleNickInput || 'superchat',
    server: context.connectionUrl,
    agent: context.agentName,
    date: new Date().toLocaleDateString(),
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
  return String(text || '').replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key] : match
  ));
}

function extractMentions(text) {
  return Array.from(new Set(
    String(text || '')
      .match(/(^|\s)@([A-Za-z0-9_[\]{}\\`^|-]{1,32})/g)?.map((match) => match.trim().slice(1)) || []
  ));
}

function App() {
  const productContext = useProductContext();
  const [activeView, setActiveView] = useState('console');
  const [bootstrap, setBootstrap] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [agentForm, setAgentForm] = useState(DEFAULT_AGENT_FORM);
  const [agentAdminSettings, setAgentAdminSettings] = useState(DEFAULT_AGENT_ADMIN_SETTINGS);
  const [agentAdminForm, setAgentAdminForm] = useState(DEFAULT_AGENT_ADMIN_FORM);
  const [isSavingAgentAdmin, setIsSavingAgentAdmin] = useState(false);
  const [agentBusyAction, setAgentBusyAction] = useState(null);
  const [agentResult, setAgentResult] = useState(null);
  const [agentQueue, setAgentQueue] = useState([]);
  const [contextBusy, setContextBusy] = useState(false);
  const [tester, setTester] = useState(DEFAULT_TESTER);
  const [testerLog, setTesterLog] = useState('... irc lines will go here ...');
  const [testerConnected, setTesterConnected] = useState(false);
  const [consoleConnected, setConsoleConnected] = useState(false);
  const [consoleRegistered, setConsoleRegistered] = useState(false);
  const [consoleNick, setConsoleNick] = useState('');
  const [consoleNickInput, setConsoleNickInput] = useState('');
  const [consoleInput, setConsoleInput] = useState('');
  const [consoleMessages, setConsoleMessages] = useState([]);
  const [consoleWindows, setConsoleWindows] = useState(['Status']);
  const [consoleNicks, setConsoleNicks] = useState({});
  const [consoleTopics, setConsoleTopics] = useState({});
  const [consoleUnread, setConsoleUnread] = useState({});
  const [consoleMentions, setConsoleMentions] = useState({});
  const [activeConsoleWindow, setActiveConsoleWindow] = useState('Status');
  const [consoleShouldReconnect, setConsoleShouldReconnect] = useState(false);
  const [message, setMessage] = useState(null);
  const testerSocketRef = useRef(null);
  const consoleSocketRef = useRef(null);
  const connectionUrlRef = useRef('');
  const formRef = useRef(DEFAULT_FORM);
  const pendingConsoleUrlRef = useRef(null);
  const manualRefreshRef = useRef(false);
  const consoleShouldReconnectRef = useRef(false);
  const reconnectTimerRef = useRef(null);
  const autoReconnectAttemptedRef = useRef(false);
  const isUnmountedRef = useRef(false);
  const [restoreRequested, setRestoreRequested] = useState(false);

  const connectionUrl = useMemo(() => {
    return assembleWebSocketUrl({
      server: form.defaultServer,
      port: form.defaultPort,
      useTls: form.defaultUseTls
    });
  }, [form.defaultServer, form.defaultPort, form.defaultUseTls]);

  useEffect(() => {
    connectionUrlRef.current = connectionUrl;
    formRef.current = form;
  }, [connectionUrl, form]);

  useEffect(() => {
    let mounted = true;
    invoke('bootstrap')
      .then((data) => {
        if (!mounted) return;
        const persisted = loadConsoleState();
        const normalizedSettings = normalizeSettings(data.settings);
        const normalizedAgentAdminSettings = normalizeAgentAdminSettings(data.agentAdminSettings);
        setBootstrap(data);
        setForm(normalizedSettings);
        setAgentAdminSettings(normalizedAgentAdminSettings);
        setAgentQueue(Array.isArray(data.agentQueue) ? data.agentQueue : []);
        setAgentAdminForm((current) => ({
          ...current,
          templateKey: normalizedAgentAdminSettings.templates[0]?.key || current.templateKey,
          agentName: normalizedAgentAdminSettings.templates[0]?.agentName || current.agentName
        }));
        setConsoleNickInput(persisted?.nickInput || data.user?.suggestedNick || 'superchat');
        if (persisted?.nick) setConsoleNick(persisted.nick);
        if (Array.isArray(persisted?.messages)) setConsoleMessages(persisted.messages.slice(-500));
        if (Array.isArray(persisted?.windows) && persisted.windows.length) setConsoleWindows(persisted.windows);
        if (persisted?.nicks && typeof persisted.nicks === 'object') setConsoleNicks(persisted.nicks);
        if (persisted?.topics && typeof persisted.topics === 'object') setConsoleTopics(persisted.topics);
        if (persisted?.unread && typeof persisted.unread === 'object') setConsoleUnread(persisted.unread);
        if (persisted?.mentions && typeof persisted.mentions === 'object') setConsoleMentions(persisted.mentions);
        if (persisted?.activeWindow) setActiveConsoleWindow(persisted.activeWindow);
        if (persisted?.input) setConsoleInput(persisted.input);
        if (persisted?.shouldReconnect || (normalizedSettings.autoConnect && hasConnectionConfig(normalizedSettings))) {
          setActiveView('console');
          setConsoleShouldReconnect(true);
          setRestoreRequested(true);
        }
      })
      .catch((err) => {
        if (!mounted) return;
        setMessage({ appearance: 'error', text: err.message || 'Failed to load A9 Superchat settings.' });
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      isUnmountedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (testerSocketRef.current) testerSocketRef.current.close();
      if (consoleSocketRef.current) consoleSocketRef.current.close();
    };
  }, []);

  useEffect(() => {
    const moduleKey = productContext?.extension?.moduleKey || productContext?.moduleKey || '';
    if (moduleKey.includes('admin')) {
      setActiveView('admin');
    }
  }, [productContext?.extension?.moduleKey, productContext?.moduleKey]);

  useEffect(() => {
    consoleShouldReconnectRef.current = consoleShouldReconnect;
  }, [consoleShouldReconnect]);

  useEffect(() => {
    if (isLoading) return;
    saveConsoleState({
      shouldReconnect: consoleShouldReconnect,
      nick: consoleNick,
      nickInput: consoleNickInput,
      input: consoleInput,
      windows: consoleWindows,
      nicks: consoleNicks,
      topics: consoleTopics,
      unread: consoleUnread,
      mentions: consoleMentions,
      activeWindow: activeConsoleWindow,
      messages: consoleMessages.slice(-500),
      connectionUrl,
      savedAt: new Date().toISOString()
    });
  }, [
    activeConsoleWindow,
    connectionUrl,
    consoleInput,
    consoleMessages,
    consoleMentions,
    consoleNick,
    consoleNickInput,
    consoleNicks,
    consoleShouldReconnect,
    consoleTopics,
    consoleUnread,
    consoleWindows,
    isLoading
  ]);

  const testerCode = useMemo(() => {
    const protocols = tester.wsType === 'text'
      ? ", ['text.ircv3.net', 'binary.ircv3.net']"
      : tester.wsType === 'binary'
        ? ", ['binary.ircv3.net', 'text.ircv3.net']"
        : '';
    const nick = tester.nick || 'dan';
    let url = tester.url || 'wss://ws.example.org';
    try {
      url = normalizePublicWebSocketUrl(url);
    } catch (err) {
      // Keep the raw value in the example while the user is editing an invalid URL.
    }
    return [
      `let socket = new WebSocket('${url}'${protocols});`,
      "socket.addEventListener('open', () => {",
      `  socket.send('NICK ${nick}');`,
      "  socket.send('USER 0 0 0 0');",
      '});',
      "socket.addEventListener('message', async e => {",
      '  var line = e.data;',
      '  if (line instanceof Blob) line = await e.data.text();',
      '  processLine(line);',
      '});'
    ].join('\n');
  }, [tester.nick, tester.url, tester.wsType]);

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function updateTesterField(name, value) {
    setTester((current) => ({ ...current, [name]: value }));
  }

  function addConsoleWindow(name) {
    setConsoleWindows((current) => current.includes(name) ? current : current.concat(name));
  }

  function markConsoleActivity(target, text) {
    if (!target || target === activeConsoleWindow) return;
    setConsoleUnread((current) => ({ ...current, [target]: (current[target] || 0) + 1 }));
    const lowerText = String(text || '').toLowerCase();
    const lowerNick = String(consoleNick || '').toLowerCase();
    if (lowerNick && lowerText.includes(lowerNick)) {
      setConsoleMentions((current) => ({ ...current, [target]: (current[target] || 0) + 1 }));
    }
  }

  function addConsoleMessage(target, kind, actor, text) {
    addConsoleWindow(target);
    markConsoleActivity(target, text);
    setConsoleMessages((current) => current.concat({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      at: timestamp(),
      target,
      kind,
      actor,
      text
    }).slice(-500));
  }

  function addConsoleNick(channel, nick) {
    if (!channel || !nick) return;
    const cleanNick = String(nick).replace(/^[~&@%+]+/, '');
    setConsoleNicks((current) => {
      const existing = current[channel] || [];
      if (existing.includes(cleanNick)) return current;
      return { ...current, [channel]: existing.concat(cleanNick).sort((a, b) => a.localeCompare(b)) };
    });
  }

  function setConsoleNickList(channel, nicks) {
    if (!channel) return;
    const cleanNicks = nicks
      .map((nick) => String(nick).replace(/^[~&@%+]+/, ''))
      .filter(Boolean)
      .filter((nick, index, list) => list.indexOf(nick) === index)
      .sort((a, b) => a.localeCompare(b));
    setConsoleNicks((current) => ({ ...current, [channel]: cleanNicks }));
  }

  function removeConsoleNick(channel, nick) {
    if (!channel || !nick) return;
    const cleanNick = String(nick).replace(/^[~&@%+]+/, '');
    setConsoleNicks((current) => ({
      ...current,
      [channel]: (current[channel] || []).filter((value) => value !== cleanNick)
    }));
  }

  function removeConsoleNickEverywhere(nick) {
    const cleanNick = String(nick || '').replace(/^[~&@%+]+/, '');
    if (!cleanNick) return;
    setConsoleNicks((current) => Object.fromEntries(
      Object.entries(current).map(([channel, nicks]) => [
        channel,
        nicks.filter((value) => value !== cleanNick)
      ])
    ));
  }

  function clearConsoleAttention(windowName) {
    setConsoleUnread((current) => ({ ...current, [windowName]: 0 }));
    setConsoleMentions((current) => ({ ...current, [windowName]: 0 }));
  }

  function switchConsoleWindow(windowName) {
    setActiveConsoleWindow(windowName);
    clearConsoleAttention(windowName);
  }

  function clearStatusHistory() {
    setConsoleMessages((current) => current.filter((entry) => entry.target !== 'Status'));
    clearConsoleAttention('Status');
  }

  function setConsoleTopic(channel, topic) {
    if (!channel) return;
    setConsoleTopics((current) => ({ ...current, [channel]: topic || '' }));
  }

  function consoleSendRaw(line, echoTarget = 'Status', options = {}) {
    const socket = consoleSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      addConsoleMessage('Status', 'error', 'client', 'Not connected.');
      return false;
    }
    socket.send(`${line}\r\n`);
    if (!options.silent) {
      addConsoleMessage(echoTarget, 'outbound', consoleNick || 'me', `-> ${line}`);
    }
    return true;
  }

  function consoleSendPrivmsg(target, body) {
    if (!consoleSendRaw(`PRIVMSG ${target} :${body}`, target, { silent: true })) {
      return false;
    }
    addConsoleMessage(target, 'message', consoleNick || consoleNickInput || 'me', body);
    return true;
  }

  async function saveSettings() {
    setIsSaving(true);
    setMessage(null);
    try {
      const settings = {
        ...form,
        defaultPort: Number(form.defaultPort),
        transcriptRetentionDays: Number(form.transcriptRetentionDays),
        defaultChannels: String(form.defaultChannels)
          .split(',')
          .map((channel) => channel.trim())
          .filter(Boolean)
      };
      const result = await invoke('saveSettings', { settings });
      setForm(normalizeSettings(result.settings));
      setMessage({ appearance: 'confirmation', text: 'Settings saved for your Atlassian account.' });
    } catch (err) {
      setMessage({ appearance: 'error', text: err.message || 'Unable to save settings.' });
    } finally {
      setIsSaving(false);
    }
  }

  function updateAgentField(name, value) {
    setAgentForm((current) => ({ ...current, [name]: value }));
  }

  function updateAgentAdminField(name, value) {
    setAgentAdminForm((current) => ({ ...current, [name]: value }));
  }

  function selectAgentTemplate(templateKey) {
    const template = agentAdminSettings.templates.find((item) => item.key === templateKey);
    setAgentAdminForm((current) => ({
      ...current,
      templateKey,
      agentName: template?.agentName || current.agentName
    }));
  }

  function addDefaultAgentAssignment() {
    const nextAssignment = {
      channel: agentAdminForm.channel,
      agentName: agentAdminForm.agentName,
      templateKey: agentAdminForm.templateKey
    };
    setAgentAdminSettings((current) => ({
      ...current,
      defaultAssignments: current.defaultAssignments
        .filter((assignment) => assignment.channel !== nextAssignment.channel)
        .concat(nextAssignment)
    }));
    setMessage({ appearance: 'info', text: `${nextAssignment.agentName} staged as the default agent for ${nextAssignment.channel}. Save admin settings to keep it.` });
  }

  function removeDefaultAgentAssignment(channel) {
    setAgentAdminSettings((current) => ({
      ...current,
      defaultAssignments: current.defaultAssignments.filter((assignment) => assignment.channel !== channel)
    }));
  }

  async function saveAgentAdminSettings() {
    setIsSavingAgentAdmin(true);
    setMessage(null);
    try {
      const result = await invoke('saveAgentAdminSettings', { settings: agentAdminSettings });
      setAgentAdminSettings(normalizeAgentAdminSettings(result.settings));
      setMessage({ appearance: 'confirmation', text: 'Agent admin settings saved.' });
    } catch (err) {
      setMessage({ appearance: 'error', text: err.message || 'Unable to save agent admin settings.' });
    } finally {
      setIsSavingAgentAdmin(false);
    }
  }

  async function refreshAgentQueue() {
    try {
      const result = await invoke('getAgentQueue');
      setAgentQueue(Array.isArray(result.queue) ? result.queue : []);
    } catch (err) {
      setMessage({ appearance: 'error', text: err.message || 'Unable to refresh agent queue.' });
    }
  }

  async function runAgentAction(actionName, payload) {
    setAgentBusyAction(actionName);
    setAgentResult(null);
    setMessage(null);
    try {
      const result = await invoke(actionName, payload);
      setAgentResult(result);
      await refreshAgentQueue();
      setMessage({ appearance: 'confirmation', text: 'Agent work queued for the relay.' });
    } catch (err) {
      setMessage({ appearance: 'error', text: err.message || 'Unable to queue agent work.' });
    } finally {
      setAgentBusyAction(null);
    }
  }

  function inviteAgent() {
    return runAgentAction('inviteAgentToChannel', {
      agentName: agentForm.agentName,
      channel: agentForm.channel
    });
  }

  function askAgent() {
    return runAgentAction('askAgentInChannel', {
      issueKey: agentForm.issueKey,
      channel: agentForm.channel,
      question: agentForm.question
    });
  }

  function summarizeChannel() {
    return runAgentAction('summarizeChannel', {
      channel: agentForm.channel,
      format: agentForm.summaryFormat
    });
  }

  function activeChannelForAgent() {
    return activeConsoleWindow === 'Status' ? (String(form.defaultChannels).split(',')[0]?.trim() || '#a9superchat') : activeConsoleWindow;
  }

  function inviteAgentToActiveChannel() {
    return runAgentAction('inviteAgentToChannel', {
      agentName: agentForm.agentName,
      channel: activeChannelForAgent()
    });
  }

  function askAgentInActiveChannel() {
    return runAgentAction('askAgentInChannel', {
      issueKey: agentForm.issueKey,
      channel: activeChannelForAgent(),
      question: agentForm.question
    });
  }

  function summarizeActiveChannel() {
    return runAgentAction('summarizeChannel', {
      channel: activeChannelForAgent(),
      format: agentForm.summaryFormat
    });
  }

  async function summonBotWithContext() {
    const channel = activeChannelForAgent();
    if (channel === 'Status') {
      setMessage({ appearance: 'error', text: 'Select or join a channel before summoning A9SysOp with context.' });
      return;
    }
    if (!consoleConnected) {
      setMessage({ appearance: 'error', text: 'Connect to IRC before summoning A9SysOp into the channel.' });
      return;
    }

    setContextBusy(true);
    setMessage(null);
    try {
      const transcript = consoleMessages
        .filter((entry) => entry.target === channel)
        .slice(-25)
        .map((entry) => `[${entry.at}] ${entry.actor ? `${entry.actor}: ` : ''}${entry.text}`);
      const result = await invoke('prepareBotContext', {
        channel,
        source: 'forge-browser',
        pageTitle: document.title || 'A9 Superchat',
        pageUrl: window.location.href,
        note: `Active IRC channel ${channel}; selected console window ${activeConsoleWindow}.`,
        transcript
      });

      if (consoleSendPrivmsg(channel, result.ircLine)) {
        setAgentResult(result);
        setMessage({ appearance: 'confirmation', text: `A9SysOp context ${result.contextId} sent into ${channel}.` });
      }
    } catch (err) {
      setMessage({ appearance: 'error', text: err.message || 'Unable to prepare browser context for A9SysOp.' });
    } finally {
      setContextBusy(false);
    }
  }

  function addTesterLog(line, reset = false) {
    setTesterLog((current) => {
      const base = reset || current === '... irc lines will go here ...' ? '' : `${current}\n`;
      return `${base}${line}`.split('\n').slice(-160).join('\n');
    });
  }

  function testerProtocols() {
    if (tester.wsType === 'text') return ['text.ircv3.net', 'binary.ircv3.net'];
    if (tester.wsType === 'binary') return ['binary.ircv3.net', 'text.ircv3.net'];
    return [];
  }

  function sendTesterLine(line) {
    const socket = testerSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      addTesterLog('[ircws-tester] Not connected.');
      return;
    }
    socket.send(line);
    addTesterLog(` -> ${line}`);
  }

  function respondToTesterPing(rawLine) {
    const socket = testerSocketRef.current;
    if (!tester.respondToPings || !socket || socket.readyState !== WebSocket.OPEN) return;
    let line = rawLine;
    if (line.startsWith('@')) line = line.substring(line.indexOf(' ') + 1).trimStart();
    if (line.startsWith(':')) line = line.substring(line.indexOf(' ') + 1).trimStart();
    const spaceIndex = line.indexOf(' ');
    const command = (spaceIndex === -1 ? line : line.substring(0, spaceIndex)).trim().toUpperCase();
    const rest = spaceIndex === -1 ? '' : line.substring(spaceIndex + 1).trimStart();
    if (command === 'PING') sendTesterLine(`PONG ${rest}`);
  }

  function connectTester() {
    if (testerSocketRef.current) {
      addTesterLog('[ircws-tester] Already connected. Disconnect before reconnecting.');
      return;
    }
    addTesterLog('[ircws-tester] Connecting...', true);
    try {
      const protocols = testerProtocols();
      const url = normalizePublicWebSocketUrl(tester.url);
      if (url !== tester.url) {
        updateTesterField('url', url);
        addTesterLog(`[ircws-tester] Normalized public A9 URL to ${url}`);
      }
      testerSocketRef.current = protocols.length ? new WebSocket(url, protocols) : new WebSocket(url);
    } catch (err) {
      testerSocketRef.current = null;
      setTesterConnected(false);
      addTesterLog(`[ircws-tester] ${err.message}`);
      return;
    }

    testerSocketRef.current.addEventListener('open', () => {
      const socket = testerSocketRef.current;
      setTesterConnected(true);
      addTesterLog(`[ircws-tester] Connected using WS protocol [${socket?.protocol || ''}]`);
      if (!tester.nick) {
        addTesterLog('[ircws-tester] Start typing IRC protocol lines.');
        return;
      }
      sendTesterLine('USER 0 0 0 0');
      sendTesterLine(`NICK ${tester.nick}`);
    });

    testerSocketRef.current.addEventListener('message', async (event) => {
      let line = event.data;
      if (line instanceof Blob) line = await line.text();
      String(line).split(/\r?\n/).filter(Boolean).forEach((part) => {
        addTesterLog(`<-  ${part}`);
        respondToTesterPing(part);
      });
    });

    testerSocketRef.current.addEventListener('close', (event) => {
      addTesterLog(event.reason
        ? `[ircws-tester] Connection closed (${event.reason})`
        : '[ircws-tester] Connection closed');
      testerSocketRef.current = null;
      setTesterConnected(false);
    });

    testerSocketRef.current.addEventListener('error', () => {
      addTesterLog("[ircws-tester] WebSocket error. Check Forge client egress, protocol mode, and the server's allowed origins.");
    });
  }

  function disconnectTester() {
    if (testerSocketRef.current) testerSocketRef.current.close();
  }

  function sendTesterInput() {
    if (!tester.rawLine) return;
    sendTesterLine(tester.rawLine);
    updateTesterField('rawLine', '');
  }

  function useTesterUrl() {
    let parsed;
    try {
      parsed = new URL(tester.url);
    } catch (err) {
      setMessage({ appearance: 'error', text: 'Enter a valid ws:// or wss:// URL before using it.' });
      return;
    }
    const endpoint = normalizePublicEndpoint(parsed);
    const nextUrl = assembleWebSocketUrl(endpoint);
    if (nextUrl !== tester.url) updateTesterField('url', nextUrl);
    connectionUrlRef.current = nextUrl;
    pendingConsoleUrlRef.current = nextUrl;
    updateField('defaultServer', endpoint.server);
    updateField('defaultPort', endpoint.port);
    updateField('defaultUseTls', endpoint.useTls);
    if (consoleSocketRef.current || consoleShouldReconnectRef.current) {
      setActiveView('console');
      refreshConsoleConnection({ url: nextUrl, reason: 'Applying new WebSocket URL' });
      setMessage({ appearance: 'info', text: `Using ${nextUrl} for the refreshed Connect session. Save settings to keep it.` });
      return;
    }
    if (tester.nick) setMessage({ appearance: 'info', text: `URL applied to Connect settings. Use ${tester.nick} as your IRC nick, then save settings to keep it.` });
    else setMessage({ appearance: 'confirmation', text: 'WebSocket URL applied to Connect settings. Save settings to keep it.' });
  }

  function handleConsoleLine(rawLine) {
    const parsed = parseIrcLine(rawLine);
    if (parsed.command === 'PING') {
      consoleSendRaw(`PONG ${parsed.params.join(' ')}`);
      return;
    }

    if (parsed.command === 'CAP') {
      addConsoleMessage('Status', 'server', 'CAP', parsed.params.join(' '));
      if (parsed.params[1] === 'LS') consoleSendRaw('CAP END');
      return;
    }

    if (parsed.command === '001') {
      setConsoleRegistered(true);
      addConsoleMessage('Status', 'system', 'server', parsed.params.slice(1).join(' ') || 'Registered with IRC server.');
      const channels = String(formRef.current.defaultChannels)
        .split(',')
        .map((channel) => channel.trim())
        .filter(Boolean);
      if (channels.length) consoleSendRaw(`JOIN ${channels.join(',')}`);
      return;
    }

    if (parsed.command === 'JOIN') {
      const channel = parsed.params[0] || activeConsoleWindow;
      addConsoleWindow(channel);
      addConsoleNick(channel, parsed.nick);
      if (parsed.nick === consoleNick) setActiveConsoleWindow(channel);
      addConsoleMessage(channel, 'system', 'join', `${parsed.nick || 'Someone'} joined ${channel}`);
      return;
    }

    if (parsed.command === 'PART') {
      const channel = parsed.params[0] || activeConsoleWindow;
      removeConsoleNick(channel, parsed.nick);
      addConsoleMessage(channel, 'system', 'part', `${parsed.nick || 'Someone'} left ${channel}`);
      return;
    }

    if (parsed.command === '332') {
      const channel = parsed.params[1];
      const topic = parsed.params.slice(2).join(' ');
      setConsoleTopic(channel, topic);
      addConsoleMessage(channel, 'system', 'topic', `Topic: ${topic}`);
      return;
    }

    if (parsed.command === '331') {
      const channel = parsed.params[1];
      setConsoleTopic(channel, '');
      addConsoleMessage(channel, 'system', 'topic', 'No topic is set.');
      return;
    }

    if (parsed.command === 'TOPIC') {
      const channel = parsed.params[0];
      const topic = parsed.params.slice(1).join(' ');
      setConsoleTopic(channel, topic);
      addConsoleMessage(channel, 'system', 'topic', `${parsed.nick || 'Someone'} changed topic: ${topic}`);
      return;
    }

    if (parsed.command === 'QUIT') {
      removeConsoleNickEverywhere(parsed.nick);
      addConsoleMessage(activeConsoleWindow, 'system', 'quit', `${parsed.nick || 'Someone'} quit`);
      return;
    }

    if (parsed.command === '353') {
      const channel = parsed.params[2];
      const names = (parsed.params[3] || '').split(' ').filter(Boolean);
      setConsoleNickList(channel, names);
      addConsoleWindow(channel);
      return;
    }

    if (parsed.command === '366') {
      const channel = parsed.params[1];
      addConsoleMessage(channel, 'system', 'names', 'End of names list.');
      return;
    }

    if (parsed.command === 'PRIVMSG') {
      const target = parsed.params[0] === consoleNick ? parsed.nick : parsed.params[0];
      const text = parsed.params.slice(1).join(' ');
      if (text.startsWith('\u0001ACTION ') && text.endsWith('\u0001')) {
        const action = text.slice(8, -1);
        addConsoleMessage(target || activeConsoleWindow, 'action', '*', `${parsed.nick} ${action}`);
        return;
      }
      addConsoleMessage(target || activeConsoleWindow, 'message', parsed.nick, text);
      return;
    }

    if (parsed.command === 'NOTICE') {
      const text = parsed.params.slice(1).join(' ');
      addConsoleMessage(activeConsoleWindow, 'notice', parsed.nick || 'notice', text);
      return;
    }

    if (/^\d{3}$/.test(parsed.command)) {
      addConsoleMessage('Status', 'server', parsed.command, parsed.params.slice(1).join(' '));
      return;
    }

    addConsoleMessage('Status', 'server', parsed.command || 'server', parsed.raw);
  }

  function connectConsole(options = {}) {
    if (consoleSocketRef.current) {
      addConsoleMessage('Status', 'system', 'client', 'Already connected.');
      return;
    }
    const nick = (consoleNickInput || bootstrap?.user?.suggestedNick || 'superchat')
      .replace(/[^a-zA-Z0-9_\-[\]]/g, '')
      .slice(0, 20);
    const url = options.url || pendingConsoleUrlRef.current || connectionUrlRef.current || connectionUrl;
    pendingConsoleUrlRef.current = null;
    setConsoleShouldReconnect(true);
    consoleShouldReconnectRef.current = true;
    setConsoleNick(nick);
    if (!options.preserveState) {
      setConsoleWindows((current) => current.length ? current : ['Status']);
      setActiveConsoleWindow((current) => current || 'Status');
      setConsoleUnread({});
      setConsoleMentions({});
    }
    setConsoleRegistered(false);
    addConsoleMessage('Status', 'system', 'client', `Connecting to ${url} ...`);

    try {
      consoleSocketRef.current = new WebSocket(url, IRC_WEBSOCKET_PROTOCOLS);
    } catch (err) {
      consoleSocketRef.current = null;
      setConsoleShouldReconnect(false);
      consoleShouldReconnectRef.current = false;
      addConsoleMessage('Status', 'error', 'client', err.message);
      return;
    }

    consoleSocketRef.current.addEventListener('open', () => {
      setConsoleConnected(true);
      addConsoleMessage('Status', 'system', 'client', 'WebSocket connected.');
      consoleSendRaw('CAP LS 302');
      consoleSendRaw(`NICK ${nick}`);
      consoleSendRaw('USER superchat 0 * :A9 Superchat');
    });

    consoleSocketRef.current.addEventListener('message', async (event) => {
      let line = event.data;
      if (line instanceof Blob) line = await line.text();
      String(line).split(/\r?\n/).filter(Boolean).forEach(handleConsoleLine);
    });

    consoleSocketRef.current.addEventListener('close', () => {
      addConsoleMessage('Status', 'system', 'client', 'Connection closed.');
      consoleSocketRef.current = null;
      setConsoleConnected(false);
      setConsoleRegistered(false);
      if (!isUnmountedRef.current && consoleShouldReconnectRef.current) {
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        const delay = manualRefreshRef.current ? 250 : 2500;
        manualRefreshRef.current = false;
        reconnectTimerRef.current = setTimeout(() => {
          addConsoleMessage('Status', 'system', 'client', 'Refreshing IRC connection...');
          connectConsole({ preserveState: true });
        }, delay);
      }
    });

    consoleSocketRef.current.addEventListener('error', () => {
      addConsoleMessage('Status', 'error', 'client', 'WebSocket error.');
    });
  }

  function disconnectConsole() {
    setConsoleShouldReconnect(false);
    consoleShouldReconnectRef.current = false;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    if (consoleSocketRef.current) consoleSocketRef.current.close();
    else addConsoleMessage('Status', 'system', 'client', 'Disconnected.');
  }

  function refreshConsoleConnection(options = {}) {
    setConsoleShouldReconnect(true);
    consoleShouldReconnectRef.current = true;
    if (options.url) {
      connectionUrlRef.current = options.url;
      pendingConsoleUrlRef.current = options.url;
    }
    manualRefreshRef.current = true;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    if (consoleSocketRef.current) {
      addConsoleMessage('Status', 'system', 'client', `${options.reason || 'Refreshing IRC connection'}...`);
      consoleSocketRef.current.close();
    } else {
      connectConsole({ preserveState: true, url: options.url });
    }
  }

  useEffect(() => {
    if (isLoading || !restoreRequested || !consoleShouldReconnect || autoReconnectAttemptedRef.current || consoleSocketRef.current) return;
    autoReconnectAttemptedRef.current = true;
    setRestoreRequested(false);
    reconnectTimerRef.current = setTimeout(() => {
      addConsoleMessage('Status', 'system', 'client', 'Restoring IRC connection...');
      connectConsole({ preserveState: true });
    }, 300);
  }, [consoleShouldReconnect, isLoading, restoreRequested]);

  function resolveConsoleText(rawText) {
    const expanded = applySmartValues(rawText, {
      activeConsoleWindow,
      consoleNick,
      consoleNickInput,
      connectionUrl,
      agentName: agentForm.agentName
    });
    const mentions = extractMentions(expanded);
    return {
      text: expanded.trim(),
      mentions
    };
  }

  function sendConsoleText(rawText) {
    const { text, mentions } = resolveConsoleText(rawText);
    if (!text) return;
    setConsoleInput('');
    if (mentions.length) {
      addConsoleMessage('Status', 'system', 'client', `Mentioning ${mentions.map((nick) => `@${nick}`).join(', ')} in ${activeConsoleWindow}.`);
    }

    if (text.startsWith('/')) {
      const [commandRaw, ...args] = text.slice(1).split(' ');
      const command = commandRaw.toLowerCase();
      if (command === 'join' && args[0]) {
        consoleSendRaw(`JOIN ${args[0]}`);
        addConsoleWindow(args[0]);
        setActiveConsoleWindow(args[0]);
        return;
      }
      if (command === 'part') {
        const channel = args[0] || activeConsoleWindow;
        consoleSendRaw(`PART ${channel}`);
        return;
      }
      if (command === 'msg' && args.length >= 2) {
        const [target, ...messageParts] = args;
        const body = messageParts.join(' ');
        consoleSendRaw(`PRIVMSG ${target} :${body}`, target);
        addConsoleMessage(target, 'message', consoleNick, body);
        setActiveConsoleWindow(target);
        return;
      }
      if (command === 'me' && args.length) {
        if (activeConsoleWindow !== 'Status') {
          const body = args.join(' ');
          consoleSendRaw(`PRIVMSG ${activeConsoleWindow} :\u0001ACTION ${body}\u0001`, activeConsoleWindow);
          addConsoleMessage(activeConsoleWindow, 'action', '*', `${consoleNick} ${body}`);
        }
        return;
      }
      if (command === 'topic') {
        if (activeConsoleWindow !== 'Status') {
          consoleSendRaw(args.length ? `TOPIC ${activeConsoleWindow} :${args.join(' ')}` : `TOPIC ${activeConsoleWindow}`);
        }
        return;
      }
      if (command === 'names') {
        consoleSendRaw(`NAMES ${args[0] || activeConsoleWindow}`);
        return;
      }
      if (command === 'whois' && args[0]) {
        consoleSendRaw(`WHOIS ${args[0]}`);
        return;
      }
      if (command === 'invite' && args.length >= 2) {
        consoleSendRaw(`INVITE ${args[0]} ${args[1]}`);
        return;
      }
      if (command === 'raw' || command === 'quote') {
        consoleSendRaw(args.join(' '));
        return;
      }
      consoleSendRaw(text.slice(1));
      return;
    }

    if (activeConsoleWindow === 'Status') {
      addConsoleMessage('Status', 'error', 'client', 'Join or select a channel before sending a message.');
      return;
    }
    consoleSendRaw(`PRIVMSG ${activeConsoleWindow} :${text}`, activeConsoleWindow);
    addConsoleMessage(activeConsoleWindow, 'message', consoleNick, text);
  }

  function sendConsoleInput() {
    sendConsoleText(consoleInput);
  }

  function updateConsoleInput(value) {
    const nextValue = String(value || '');
    if (/\r?\n$/.test(nextValue)) {
      sendConsoleText(nextValue.replace(/\r?\n$/, ''));
      return;
    }
    setConsoleInput(nextValue);
  }

  const visibleConsoleMessages = consoleMessages.filter((entry) => entry.target === activeConsoleWindow);
  const consoleTranscript = visibleConsoleMessages.length
    ? visibleConsoleMessages.map((entry) => `[${entry.at}] ${entry.actor ? `${entry.actor}: ` : ''}${entry.text}`).join('\n')
    : 'No messages in this window yet.';
  const selectedViewIndex = Math.max(0, VIEW_ORDER.indexOf(activeView));
  const testerProtocolValue = TESTER_PROTOCOL_OPTIONS.find((option) => option.value === tester.wsType) || TESTER_PROTOCOL_OPTIONS[0];
  const summaryFormatValue = SUMMARY_FORMAT_OPTIONS.find((option) => option.value === agentForm.summaryFormat) || SUMMARY_FORMAT_OPTIONS[0];
  const agentTemplateOptions = agentAdminSettings.templates.map((template) => ({
    label: template.name,
    value: template.key
  }));
  const selectedAgentTemplate = agentAdminSettings.templates.find((template) => template.key === agentAdminForm.templateKey) || agentAdminSettings.templates[0] || DEFAULT_AGENT_ADMIN_SETTINGS.templates[0];
  const selectedAgentTemplateValue = agentTemplateOptions.find((option) => option.value === selectedAgentTemplate.key) || agentTemplateOptions[0];
  const rovoStudioPrompt = buildRovoStudioPrompt(selectedAgentTemplate, agentAdminForm);
  const activeNicks = consoleNicks[activeConsoleWindow] || [];
  const activeUnreadCount = Object.values(consoleUnread).reduce((total, count) => total + Number(count || 0), 0);
  const activeMentionCount = Object.values(consoleMentions).reduce((total, count) => total + Number(count || 0), 0);
  const connectedAppearance = consoleConnected ? 'success' : 'default';
  const registeredAppearance = consoleRegistered ? 'inprogress' : 'default';

  if (isLoading) {
    return (
      <Box padding="space.300">
        <Inline space="space.100" alignBlock="center">
          <Spinner size="medium" />
          <Text>Loading A9 Superchat...</Text>
        </Inline>
      </Box>
    );
  }

  return (
    <Box padding="space.300">
      <Stack space="space.300">
        <Box xcss={pageHeaderStyles}>
          <Inline spread="space-between" alignBlock="center" shouldWrap>
            <Inline space="space.150" alignBlock="center" shouldWrap>
              <Icon glyph="rovo-chat" label="" color="color.icon.discovery" />
              <Stack space="space.025">
                <Heading as="h1" size="large">A9 Superchat</Heading>
                <Text>IRC collaboration with Jira, Confluence, and Rovo context.</Text>
              </Stack>
            </Inline>
            <Inline space="space.100" alignBlock="center" shouldWrap>
              <Lozenge appearance={connectedAppearance}>{consoleConnected ? 'connected' : 'offline'}</Lozenge>
              <Lozenge appearance={registeredAppearance}>{consoleRegistered ? 'registered' : 'pending'}</Lozenge>
              {activeUnreadCount ? <Badge appearance="primary">{activeUnreadCount}</Badge> : null}
              {activeMentionCount ? <Badge appearance="important">{activeMentionCount}</Badge> : null}
            </Inline>
          </Inline>
        </Box>

        {message ? (
          <SectionMessage
            appearance={message.appearance}
            actions={[
              <SectionMessageAction key="dismiss-alert" onClick={() => setMessage(null)}>
                Dismiss
              </SectionMessageAction>
            ]}
          >
            <Text>{message.text}</Text>
          </SectionMessage>
        ) : null}

        <Tabs
          id="a9-superchat-views"
          selected={selectedViewIndex}
          onChange={(index) => setActiveView(VIEW_ORDER[index] || 'console')}
        >
          <TabList>
            {VIEW_ORDER.map((view) => (
              <Tab key={view}>{VIEW_LABELS[view]}</Tab>
            ))}
          </TabList>

          <TabPanel>
            <Stack space="space.250">
              <Box xcss={surfaceStyles}>
                <Inline spread="space-between" alignBlock="center" shouldWrap>
                  <Inline space="space.100" alignBlock="center" shouldWrap>
                    <TagGroup>
                      <Tag text={connectionUrl} color="blue-light" />
                      {consoleShouldReconnect ? <Tag text="restore on" color="teal-light" /> : null}
                    </TagGroup>
                  </Inline>
                  <Inline space="space.100" alignBlock="center" shouldWrap>
                    <Label labelFor="console-nick">Nick</Label>
                    <Textfield
                      name="console-nick"
                      id="console-nick"
                      value={consoleNickInput}
                      onChange={(event) => setConsoleNickInput(event.target.value)}
                      isDisabled={consoleConnected}
                    />
                    <ButtonGroup label="Connection actions">
                      <Button appearance="primary" iconBefore="link" onClick={connectConsole} isDisabled={consoleConnected}>
                        Connect
                      </Button>
                      <Button iconBefore="sign-out" onClick={disconnectConsole} isDisabled={!consoleConnected}>
                        Disconnect
                      </Button>
                      <Tooltip content="Reconnect while keeping channel state">
                        <Button iconBefore="refresh" onClick={() => refreshConsoleConnection()}>
                          Refresh
                        </Button>
                      </Tooltip>
                    </ButtonGroup>
                  </Inline>
                </Inline>
              </Box>

              <Inline space="space.200" alignBlock="start">
                <Box xcss={sidebarStyles}>
                  <Stack space="space.200">
                    <Stack space="space.100">
                      <Heading as="h2" size="small">Windows</Heading>
                      {consoleWindows.map((windowName) => (
                        <Button
                          key={windowName}
                          appearance={activeConsoleWindow === windowName ? 'primary' : 'subtle'}
                          shouldFitContainer
                          onClick={() => switchConsoleWindow(windowName)}
                        >
                          {windowName}
                          {consoleMentions[windowName] ? ` @${consoleMentions[windowName]}` : ''}
                          {!consoleMentions[windowName] && consoleUnread[windowName] ? ` (${consoleUnread[windowName]})` : ''}
                        </Button>
                      ))}
                    </Stack>
                    <Stack space="space.100">
                      <Inline spread="space-between" alignBlock="center">
                        <Heading as="h2" size="small">People</Heading>
                        <Badge>{activeNicks.length}</Badge>
                      </Inline>
                      {activeNicks.length ? activeNicks.map((nick) => (
                        <Inline key={nick} space="space.050" alignBlock="center">
                          <Icon glyph="person" label="" size="small" />
                          <Text>{nick}</Text>
                        </Inline>
                      )) : <Text>No nicks yet.</Text>}
                    </Stack>
                  </Stack>
                </Box>

                <Stack space="space.150" grow="fill">
                  <Box xcss={surfaceStyles}>
                    <Inline spread="space-between" alignBlock="start" shouldWrap>
                      <Stack space="space.050">
                        <Heading as="h2" size="medium">{activeConsoleWindow}</Heading>
                        <Text>{consoleTopics[activeConsoleWindow] || (activeConsoleWindow === 'Status' ? 'Connection status and server messages' : 'No topic set')}</Text>
                      </Stack>
                      <ButtonGroup label="Channel actions">
                        <Button
                          iconBefore="person-add"
                          onClick={inviteAgentToActiveChannel}
                          isDisabled={agentBusyAction !== null || !form.allowRovoInvites}
                        >
                          Invite
                        </Button>
                        <Button iconBefore="question-circle" onClick={askAgentInActiveChannel} isDisabled={agentBusyAction !== null}>
                          Ask
                        </Button>
                        <Button iconBefore="ai-generative-text-summary" onClick={summarizeActiveChannel} isDisabled={agentBusyAction !== null}>
                          Distill
                        </Button>
                        <Button iconBefore="ai-agent" onClick={summonBotWithContext} isDisabled={contextBusy || !consoleConnected || activeConsoleWindow === 'Status'}>
                          {contextBusy ? 'Summoning...' : 'A9SysOp'}
                        </Button>
                      </ButtonGroup>
                    </Inline>
                  </Box>

                  <Box xcss={scrollbackBoxStyles} padding="space.100">
                    {visibleConsoleMessages.length ? (
                      <CodeBlock language="text" text={consoleTranscript} />
                    ) : (
                      <EmptyState
                        header="No messages yet"
                        description={activeConsoleWindow === 'Status' ? 'Connect to an IRC WebSocket endpoint to see server status here.' : `Messages for ${activeConsoleWindow} will appear here.`}
                        primaryAction={<Button appearance="primary" onClick={connectConsole} isDisabled={consoleConnected}>Connect</Button>}
                      />
                    )}
                  </Box>

                  <Form onSubmit={sendConsoleInput}>
                    <Inline space="space.100" alignBlock="center">
                      <Box xcss={composerInputStyles}>
                        <TextArea
                          name="console-input"
                          id="console-input"
                          value={consoleInput}
                          minimumRows={2}
                          maxHeight="96px"
                          resize="none"
                          placeholder={activeConsoleWindow === 'Status' ? '/join #channel, /raw VERSION, or {{time}} status' : `Message ${activeConsoleWindow} with @nick or {{channel}}`}
                          onChange={(event) => updateConsoleInput(event.target.value)}
                        />
                      </Box>
                      <Button
                        appearance="primary"
                        iconBefore="send"
                        type="submit"
                        isDisabled={!consoleConnected}
                      >
                        Send
                      </Button>
                    </Inline>
                  </Form>
                  <Inline space="space.100" alignBlock="center" shouldWrap>
                    <Tag text="@nick mentions" color="purple-light" />
                    <Tag text="{{channel}}" color="blue-light" />
                    <Tag text="{{nick}}" color="blue-light" />
                    <Tag text="{{time}}" color="blue-light" />
                    <Tag text="{{date}}" color="blue-light" />
                    <Text>Enter sends. Unknown smart values are left unchanged.</Text>
                  </Inline>

                  <Inline space="space.100" alignBlock="center" shouldWrap>
                    <Button iconBefore="add" onClick={() => {
                      setConsoleInput(`/join ${String(form.defaultChannels).split(',')[0]?.trim() || '#a9superchat'}`);
                    }}>
                      Join default
                    </Button>
                    <Button iconBefore="angle-brackets" onClick={() => setConsoleInput('/raw ')}>
                      Raw
                    </Button>
                    <Button iconBefore="trash" onClick={clearStatusHistory}>
                      Clear status
                    </Button>
                    <Text>/join, /part, /msg, /me, /topic, /names, /whois, /invite, /raw, /quote</Text>
                  </Inline>
                </Stack>
              </Inline>
            </Stack>
          </TabPanel>

          <TabPanel>
            <Stack space="space.250">
              <Box xcss={surfaceStyles}>
                <FormHeader title="Admin setup" description="Manage the shared IRC endpoint, connection defaults, and agent bootstrap path." />
                <Inline space="space.200" alignBlock="start">
                  <Stack space="space.150" grow="fill">
                    <FormSection title="WebSocket tester">
                      <Inline space="space.100" shouldWrap>
                        <Button onClick={() => {
                          updateTesterField('url', 'wss://irc.a9group.net');
                          updateTesterField('wsType', 'text');
                        }}>
                          A9 InspIRCd
                        </Button>
                        <Button onClick={() => {
                          updateTesterField('url', 'wss://testnet.ergo.chat/webirc');
                          updateTesterField('wsType', 'text');
                        }}>
                          Ergo
                        </Button>
                        <Button onClick={() => {
                          updateTesterField('url', 'wss://testnet.inspircd.org:8097');
                          updateTesterField('wsType', 'text');
                        }}>
                          InspIRCd
                        </Button>
                        <Button onClick={() => {
                          updateTesterField('url', 'wss://irc.unrealircd.org:8000');
                          updateTesterField('wsType', 'text');
                        }}>
                          UnrealIRCd
                        </Button>
                      </Inline>

                      <Label labelFor="tester-url">WebSocket URL</Label>
                      <Textfield
                        name="tester-url"
                        id="tester-url"
                        value={tester.url}
                        onChange={(event) => updateTesterField('url', event.target.value)}
                      />
                      <HelperMessage>Use a browser WebSocket endpoint such as wss://irc.a9group.net, not a raw IRC port.</HelperMessage>

                      <Label labelFor="tester-nick">Nickname</Label>
                      <Textfield
                        name="tester-nick"
                        id="tester-nick"
                        value={tester.nick}
                        onChange={(event) => updateTesterField('nick', event.target.value)}
                      />

                      <Label labelFor="tester-protocol">Protocol mode</Label>
                      <Select
                        inputId="tester-protocol"
                        value={testerProtocolValue}
                        options={TESTER_PROTOCOL_OPTIONS}
                        onChange={(option) => updateTesterField('wsType', option?.value || 'text')}
                      />

                      <Inline space="space.100" shouldWrap>
                        <Button appearance="primary" iconBefore="link" onClick={connectTester} isDisabled={testerConnected}>
                          Connect
                        </Button>
                        <Button iconBefore="sign-out" onClick={disconnectTester} isDisabled={!testerConnected}>
                          Disconnect
                        </Button>
                        <Button iconBefore="check" onClick={useTesterUrl}>Use for Connect</Button>
                      </Inline>

                      <Inline space="space.200" shouldWrap>
                        <Checkbox
                          name="tester-follow"
                          value="tester-follow"
                          label="Follow new lines"
                          isChecked={tester.follow}
                          onChange={(event) => updateTesterField('follow', event.target.checked)}
                        />
                        <Checkbox
                          name="tester-pongs"
                          value="tester-pongs"
                          label="Respond to PINGs"
                          isChecked={tester.respondToPings}
                          onChange={(event) => updateTesterField('respondToPings', event.target.checked)}
                        />
                      </Inline>

                      <Label labelFor="tester-line">Send raw IRC line</Label>
                      <Inline space="space.100" alignBlock="center">
                        <Textfield
                          name="tester-line"
                          id="tester-line"
                          value={tester.rawLine}
                          onChange={(event) => updateTesterField('rawLine', event.target.value)}
                        />
                        <Button iconBefore="send" onClick={sendTesterInput} isDisabled={!testerConnected}>Send</Button>
                      </Inline>
                    </FormSection>
                  </Stack>

                  <Stack space="space.150" grow="fill">
                    <FormSection title="Connect settings">
                      <TagGroup>
                        <Tag text={connectionUrl} color="blue-light" />
                        <Tag text={bootstrap?.user?.suggestedNick || 'superchat'} color="teal-light" />
                      </TagGroup>
                      <Label labelFor="default-server">IRC server</Label>
                      <Textfield
                        name="default-server"
                        id="default-server"
                        value={form.defaultServer}
                        onChange={(event) => updateField('defaultServer', event.target.value)}
                      />
                      <Label labelFor="default-port">WebSocket port</Label>
                      <Textfield
                        name="default-port"
                        id="default-port"
                        value={String(form.defaultPort)}
                        onChange={(event) => updateField('defaultPort', event.target.value)}
                      />
                      <Label labelFor="default-channels">Default channels</Label>
                      <Textfield
                        name="default-channels"
                        id="default-channels"
                        value={form.defaultChannels}
                        onChange={(event) => updateField('defaultChannels', event.target.value)}
                      />
                      <Label labelFor="relay-url">Relay URL</Label>
                      <Textfield
                        name="relay-url"
                        id="relay-url"
                        value={form.relayUrl}
                        placeholder="wss://relay.example.com"
                        onChange={(event) => updateField('relayUrl', event.target.value)}
                      />
                      <Label labelFor="retention-days">Transcript retention days</Label>
                      <Textfield
                        name="retention-days"
                        id="retention-days"
                        value={String(form.transcriptRetentionDays)}
                        onChange={(event) => updateField('transcriptRetentionDays', event.target.value)}
                      />
                      <Checkbox
                        name="default-use-tls"
                        value="default-use-tls"
                        label="Use TLS / WSS"
                        isChecked={form.defaultUseTls}
                        onChange={(event) => updateField('defaultUseTls', event.target.checked)}
                      />
                      <Checkbox
                        name="auto-connect"
                        value="auto-connect"
                        label="Open Connect and reconnect automatically"
                        isChecked={form.autoConnect}
                        onChange={(event) => updateField('autoConnect', event.target.checked)}
                      />
                      <Checkbox
                        name="allow-rovo-invites"
                        value="allow-rovo-invites"
                        label="Allow Rovo agent channel invites"
                        isChecked={form.allowRovoInvites}
                        onChange={(event) => updateField('allowRovoInvites', event.target.checked)}
                      />
                      <Checkbox
                        name="allow-dcc-proxy"
                        value="allow-dcc-proxy"
                        label="Allow DCC-style relay file sharing"
                        isChecked={form.allowDccProxy}
                        onChange={(event) => updateField('allowDccProxy', event.target.checked)}
                      />
                      <FormFooter>
                        <Button appearance="primary" iconBefore="check" onClick={saveSettings} isDisabled={isSaving}>
                          {isSaving ? 'Saving...' : 'Save settings'}
                        </Button>
                        <Button iconBefore="chat-widget" onClick={() => setActiveView('console')}>Open Connect</Button>
                      </FormFooter>
                    </FormSection>
                  </Stack>
                </Inline>
              </Box>

              <Inline space="space.200" alignBlock="start">
                <Box xcss={subtleSurfaceStyles}>
                  <Stack space="space.100">
                    <Heading as="h3" size="small">Example code</Heading>
                    <CodeBlock language="javascript" text={testerCode} />
                  </Stack>
                </Box>
                <Box xcss={subtleSurfaceStyles}>
                  <Stack space="space.100">
                    <Heading as="h3" size="small">Tester log</Heading>
                    <Box xcss={scrollbackBoxStyles} padding="space.100">
                      <CodeBlock language="text" text={testerLog} />
                    </Box>
                  </Stack>
                </Box>
              </Inline>

              <Box xcss={surfaceStyles}>
                <FormHeader
                  title="Agent bootstrap"
                  description="Manage default Rovo agents for IRC channels and prepare templates for Rovo Studio."
                />
                <Inline space="space.200" alignBlock="start">
                  <Stack space="space.150" grow="fill">
                    <FormSection
                      title="Default channel agents"
                      description="These mappings define which Rovo agent should be invited or recommended for each IRC channel by default."
                    >
                      {agentAdminSettings.defaultAssignments.length ? (
                        <Stack space="space.100">
                          {agentAdminSettings.defaultAssignments.map((assignment) => {
                            const template = agentAdminSettings.templates.find((item) => item.key === assignment.templateKey);
                            return (
                              <Box key={`${assignment.channel}-${assignment.agentName}`} xcss={subtleSurfaceStyles}>
                                <Inline spread="space-between" alignBlock="center" shouldWrap>
                                  <Stack space="space.025">
                                    <Inline space="space.100" alignBlock="center" shouldWrap>
                                      <Tag text={assignment.channel} color="blue-light" />
                                      <Text>{assignment.agentName}</Text>
                                    </Inline>
                                    <Text>{template?.name || assignment.templateKey}</Text>
                                  </Stack>
                                  <Button iconBefore="trash" onClick={() => removeDefaultAgentAssignment(assignment.channel)}>
                                    Remove
                                  </Button>
                                </Inline>
                              </Box>
                            );
                          })}
                        </Stack>
                      ) : (
                        <EmptyState
                          header="No default agents"
                          description="Add a channel mapping so admins have a repeatable bootstrap path."
                        />
                      )}
                    </FormSection>

                    <FormSection title="Add or replace a channel mapping">
                      <Label labelFor="admin-agent-channel">IRC channel</Label>
                      <Textfield
                        name="admin-agent-channel"
                        id="admin-agent-channel"
                        value={agentAdminForm.channel}
                        onChange={(event) => updateAgentAdminField('channel', event.target.value)}
                      />
                      <Label labelFor="admin-agent-name">Agent name</Label>
                      <Textfield
                        name="admin-agent-name"
                        id="admin-agent-name"
                        value={agentAdminForm.agentName}
                        onChange={(event) => updateAgentAdminField('agentName', event.target.value)}
                      />
                      <Label labelFor="admin-agent-template">Template</Label>
                      <Select
                        inputId="admin-agent-template"
                        value={selectedAgentTemplateValue}
                        options={agentTemplateOptions}
                        onChange={(option) => selectAgentTemplate(option?.value || selectedAgentTemplate.key)}
                      />
                      <ButtonGroup label="Default agent actions">
                        <Button appearance="primary" iconBefore="add" onClick={addDefaultAgentAssignment}>
                          Stage default
                        </Button>
                        <Button iconBefore="check" onClick={saveAgentAdminSettings} isDisabled={isSavingAgentAdmin}>
                          {isSavingAgentAdmin ? 'Saving...' : 'Save admin settings'}
                        </Button>
                      </ButtonGroup>
                    </FormSection>
                  </Stack>

                  <Stack space="space.150" grow="fill">
                    <FormSection
                      title="Create in Rovo Studio"
                      description="Use this generated brief when creating or updating an IRC-capable Rovo agent."
                    >
                      <SectionMessage appearance="info" title="Rovo Studio handoff">
                        <Text>
                          Create a Rovo agent, add the listed A9 Superchat actions, paste the instructions below,
                          then return here and map that agent name to the target IRC channel.
                        </Text>
                      </SectionMessage>
                      <Label labelFor="rovo-studio-url">Rovo Studio URL</Label>
                      <Textfield
                        name="rovo-studio-url"
                        id="rovo-studio-url"
                        value={agentAdminSettings.rovoStudioUrl}
                        onChange={(event) => setAgentAdminSettings((current) => ({ ...current, rovoStudioUrl: event.target.value }))}
                      />
                      <Label labelFor="rovo-agent-brief">Generated agent brief</Label>
                      <TextArea
                        name="rovo-agent-brief"
                        id="rovo-agent-brief"
                        value={rovoStudioPrompt}
                        isReadOnly
                        isMonospaced
                        minimumRows={14}
                      />
                      <Heading as="h3" size="small">Required actions</Heading>
                      <TagGroup>
                        {(selectedAgentTemplate.actions || []).map((action) => (
                          <Tag key={action} text={action} color="purple-light" />
                        ))}
                      </TagGroup>
                      <Button iconBefore="open" onClick={() => setMessage({ appearance: 'info', text: `Open Rovo Studio at ${agentAdminSettings.rovoStudioUrl} and create ${agentAdminForm.agentName}.` })}>
                        Show Rovo Studio path
                      </Button>
                    </FormSection>

                    <FormSection title="Template guidance">
                      <Text>{selectedAgentTemplate.description}</Text>
                      <CodeBlock language="text" text={selectedAgentTemplate.instructions || ''} />
                    </FormSection>
                  </Stack>
                </Inline>
              </Box>

              <SectionMessage appearance="warning">
                <Text>Direct browser WebSocket hosts must be declared in Forge client egress before deployment.</Text>
              </SectionMessage>
            </Stack>
          </TabPanel>

          <TabPanel>
            <Stack space="space.250">
              <Box xcss={surfaceStyles}>
                <FormHeader title="Rovo and IRC agents" description="Queue agent invites, Jira-grounded questions, and channel summaries from the current IRC context." />
                {!form.allowRovoInvites ? (
                  <SectionMessage
                    appearance="warning"
                    actions={[
                      <SectionMessageAction key="dismiss-rovo-disabled" onClick={() => updateField('allowRovoInvites', true)}>
                        Enable
                      </SectionMessageAction>
                    ]}
                  >
                    <Text>Rovo channel invites are disabled in Admin.</Text>
                  </SectionMessage>
                ) : null}

                <Inline space="space.200" alignBlock="start">
                  <Stack space="space.150" grow="fill">
                    <FormSection title="Channel presence">
                      <Label labelFor="agent-name">Agent</Label>
                      <Textfield
                        name="agent-name"
                        id="agent-name"
                        value={agentForm.agentName}
                        onChange={(event) => updateAgentField('agentName', event.target.value)}
                      />
                      <Label labelFor="agent-channel">IRC channel</Label>
                      <Textfield
                        name="agent-channel"
                        id="agent-channel"
                        value={agentForm.channel}
                        onChange={(event) => updateAgentField('channel', event.target.value)}
                      />
                      <ButtonGroup label="Agent presence actions">
                        <Button
                          appearance="primary"
                          iconBefore="person-add"
                          onClick={inviteAgent}
                          isDisabled={agentBusyAction !== null || !form.allowRovoInvites}
                        >
                          {agentBusyAction === 'inviteAgentToChannel' ? 'Inviting...' : 'Invite'}
                        </Button>
                        <Button iconBefore="chat-widget" onClick={() => setActiveView('console')}>Open console</Button>
                        <Button iconBefore="ai-agent" onClick={summonBotWithContext} isDisabled={contextBusy || !consoleConnected}>
                          {contextBusy ? 'Summoning...' : 'Summon context'}
                        </Button>
                      </ButtonGroup>
                    </FormSection>

                    <FormSection title="Ask for triage">
                      <Label labelFor="agent-issue-key">Jira issue key</Label>
                      <Textfield
                        name="agent-issue-key"
                        id="agent-issue-key"
                        placeholder="CS-123"
                        value={agentForm.issueKey}
                        onChange={(event) => updateAgentField('issueKey', event.target.value)}
                      />
                      <Label labelFor="agent-question">Question</Label>
                      <Textfield
                        name="agent-question"
                        id="agent-question"
                        value={agentForm.question}
                        onChange={(event) => updateAgentField('question', event.target.value)}
                      />
                      <Button appearance="primary" iconBefore="question-circle" onClick={askAgent} isDisabled={agentBusyAction !== null}>
                        {agentBusyAction === 'askAgentInChannel' ? 'Asking...' : 'Ask channel'}
                      </Button>
                    </FormSection>
                  </Stack>

                  <Stack space="space.150" grow="fill">
                    <FormSection title="Distill channel">
                      <Label labelFor="summary-format">Summary format</Label>
                      <Select
                        inputId="summary-format"
                        value={summaryFormatValue}
                        options={SUMMARY_FORMAT_OPTIONS}
                        onChange={(option) => updateAgentField('summaryFormat', option?.value || 'rca')}
                      />
                      <Button appearance="primary" iconBefore="ai-generative-text-summary" onClick={summarizeChannel} isDisabled={agentBusyAction !== null}>
                        {agentBusyAction === 'summarizeChannel' ? 'Queueing...' : 'Queue summary'}
                      </Button>
                    </FormSection>

                    <FormSection title="Agent message queue">
                      <Inline space="space.100" alignBlock="center" shouldWrap>
                        <Button iconBefore="refresh" onClick={refreshAgentQueue}>Refresh queue</Button>
                        <Badge>{agentQueue.length}</Badge>
                      </Inline>
                      {agentQueue.length ? (
                        <Stack space="space.100">
                          {agentQueue.slice(0, 8).map((item) => (
                            <Box key={item.id} xcss={subtleSurfaceStyles}>
                              <Stack space="space.050">
                                <Inline space="space.100" alignBlock="center" shouldWrap>
                                  <Tag text={item.channel} color="blue-light" />
                                  <Tag text={item.type} color="purple-light" />
                                  <Lozenge appearance={item.status === 'queued' ? 'inprogress' : 'default'}>{item.status}</Lozenge>
                                </Inline>
                                <Text>{item.text || item.agentName || item.actor}</Text>
                                <Text>{item.createdAt}</Text>
                              </Stack>
                            </Box>
                          ))}
                        </Stack>
                      ) : (
                        <EmptyState
                          header="No queued agent messages"
                          description="Queued invites, triage messages, and summaries will appear here."
                        />
                      )}
                    </FormSection>

                    {agentResult ? (
                      <SectionMessage appearance="info" title="Last queued action">
                        <CodeBlock language="json" text={JSON.stringify(agentResult, null, 2)} />
                      </SectionMessage>
                    ) : (
                      <EmptyState
                        header="No agent work queued"
                        description="Invite an agent, ask a triage question, or queue a channel summary."
                        primaryAction={<Button appearance="primary" iconBefore="person-add" onClick={inviteAgent} isDisabled={agentBusyAction !== null || !form.allowRovoInvites}>Invite agent</Button>}
                      />
                    )}
                  </Stack>
                </Inline>
              </Box>
            </Stack>
          </TabPanel>

          <TabPanel>
            <Stack space="space.200">
              <Box xcss={surfaceStyles}>
                <FormHeader title="Audit and retention" description="Bounded channel events are stored in Forge for review and later RCA workflows." />
                <Inline space="space.200" shouldWrap>
                  <Box xcss={subtleSurfaceStyles}>
                    <Stack space="space.050">
                      <Heading as="h3" size="small">Retention</Heading>
                      <Text>{form.transcriptRetentionDays} days</Text>
                    </Stack>
                  </Box>
                  <Box xcss={subtleSurfaceStyles}>
                    <Stack space="space.050">
                      <Heading as="h3" size="small">File relay</Heading>
                      <Text>{form.allowDccProxy ? 'Allowed by settings' : 'Disabled by settings'}</Text>
                    </Stack>
                  </Box>
                  <Box xcss={subtleSurfaceStyles}>
                    <Stack space="space.050">
                      <Heading as="h3" size="small">Agent invites</Heading>
                      <Text>{form.allowRovoInvites ? 'Enabled' : 'Disabled'}</Text>
                    </Stack>
                  </Box>
                </Inline>
                <SectionMessage appearance="info" title="Message composition">
                  <Text>
                    The composer supports @nick mentions and smart values for channel context. Supported values:
                    {' {{channel}}, {{nick}}, {{server}}, {{agent}}, {{date}}, and {{time}}.'}
                  </Text>
                </SectionMessage>
              </Box>
            </Stack>
          </TabPanel>
        </Tabs>
      </Stack>
    </Box>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
