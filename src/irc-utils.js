const SECRET_PATTERNS = [
  /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
  /\b([A-Za-z0-9_=-]{20,}\.[A-Za-z0-9_=-]{10,}\.[A-Za-z0-9_=-]{10,})\b/g,
  /\b((?:api|access|auth|bot|client|refresh)?_?token)\s*[:=]\s*([^\s,;]+)/gi,
  /\b(password|passwd|pwd|secret)\s*[:=]\s*([^\s,;]+)/gi
];

function redactSecrets(text) {
  return SECRET_PATTERNS.reduce((current, pattern) => current.replace(pattern, (match, label) => {
    if (label && /token|password|passwd|pwd|secret/i.test(label)) {
      return `${label}=<redacted>`;
    }
    return '<redacted>';
  }), String(text || ''));
}

function isChannel(target) {
  return /^[#&][A-Za-z0-9._-]{1,80}$/.test(String(target || ''));
}

function normalizeChannels(value, fallback = ['#a9superchat', '#atlassian']) {
  const channels = Array.isArray(value) ? value : String(value || '').split(',');
  const normalized = channels.map((channel) => String(channel).trim()).filter(isChannel);
  return normalized.length ? normalized : fallback;
}

module.exports = {
  isChannel,
  normalizeChannels,
  redactSecrets
};
