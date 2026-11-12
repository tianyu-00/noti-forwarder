// Push alerts to the main phone through ntfy (https://ntfy.sh, or your own ntfy server).
// A push must never block or fail a stored message, and must never put message text in a log.

import { isEncrypted } from './e2e.js';

const MAX_PER_BATCH = 5; // a burst becomes five alerts plus one summary
const MAX_TEXT = 1000;

function sourceLabel(m) {
  if (m.type === 'sms') return `SMS from ${m.sender || 'unknown number'}`;
  return m.sender ? `${m.app}: ${m.sender}` : m.app;
}

function buildPush(m, deviceName, includeBody) {
  // Encrypted text cannot be shown (the server has no key), so these pushes carry no text.
  if (!includeBody || isEncrypted(m.body) || isEncrypted(m.sender)) {
    return { title: `${deviceName} · new message`, message: 'New message', priority: 3, tags: ['bell'] };
  }
  const text = m.body.length > MAX_TEXT ? `${m.body.slice(0, MAX_TEXT)}…` : m.body;
  return {
    title: `${m.code ? `🔑 ${m.code} · ` : ''}${deviceName} · ${sourceLabel(m)}`,
    message: text,
    priority: m.code ? 4 : 3,
    tags: [m.code ? 'key' : m.type === 'sms' ? 'speech_balloon' : 'bell'],
  };
}

export function createNtfyNotifier({
  url,
  topic,
  token,
  mode = 'all',
  types = ['sms', 'notification'],
  blockedApps = [],
  includeBody = true,
  fetchImpl = fetch,
  timeoutMs = 5000,
  logger = console,
}) {
  async function publish(push) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ topic, ...push }),
        signal: controller.signal,
      });
      if (!res.ok) throw Object.assign(new Error('bad response'), { code: `HTTP ${res.status}` });
      return true;
    } catch (err) {
      // Only an error class or status: the text, the topic and the URL stay out of the log.
      logger.warn(`ntfy push failed: ${err.code || err.name}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    /** messages use the API shape (with `code`). Never throws. Returns how many pushes went out. */
    async notify(messages, deviceName) {
      const wanted = messages.filter(
        (m) => types.includes(m.type) && !blockedApps.includes(m.app) && (mode === 'all' || m.code),
      );
      const shown = wanted.slice(0, MAX_PER_BATCH).map((m) => buildPush(m, deviceName, includeBody));
      if (wanted.length > MAX_PER_BATCH) {
        shown.push({
          title: deviceName,
          message: `+${wanted.length - MAX_PER_BATCH} more messages`,
          priority: 3,
          tags: ['bell'],
        });
      }
      let sent = 0;
      for (const push of shown) if (await publish(push)) sent += 1;
      return { sent, failed: shown.length - sent };
    },
  };
}

function list(value) {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isLocalHost(hostname) {
  // A name with no dot is a Docker service name, e.g. http://ntfy:80.
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || !hostname.includes('.');
}

/** Builds the notifier from environment settings. Returns null when push is not configured. */
export function ntfyFromEnv(env, deps = {}) {
  if (!env.NTFY_TOPIC) return null;

  let parsed;
  try {
    parsed = new URL(env.NTFY_URL || 'https://ntfy.sh');
  } catch {
    throw new Error('NTFY_URL is not a valid URL');
  }
  // Messages hold private data such as 2FA codes, so plain http is only for a local server.
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalHost(parsed.hostname))) {
    throw new Error('NTFY_URL must use https (plain http is only allowed for a local server)');
  }

  const topic = env.NTFY_TOPIC;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(topic)) {
    throw new Error('NTFY_TOPIC may only contain letters, digits, - and _ (up to 64 characters)');
  }
  const publicNtfy = parsed.hostname === 'ntfy.sh' || parsed.hostname.endsWith('.ntfy.sh');
  if (publicNtfy && topic.length < 20) {
    throw new Error('NTFY_TOPIC is too guessable for the public ntfy.sh: use a long random topic (20+ characters)');
  }

  const mode = env.NTFY_MODE || 'all';
  if (!['all', 'codes'].includes(mode)) throw new Error('NTFY_MODE must be "all" or "codes"');

  const types = env.NTFY_TYPES ? list(env.NTFY_TYPES) : ['sms', 'notification'];
  if (types.length === 0 || !types.every((t) => ['sms', 'notification'].includes(t))) {
    throw new Error('NTFY_TYPES must be a comma list of "sms" and/or "notification"');
  }

  const includeBodyRaw = env.NTFY_INCLUDE_BODY || 'true'; // blank counts as not set
  if (!['true', 'false'].includes(includeBodyRaw)) throw new Error('NTFY_INCLUDE_BODY must be "true" or "false"');

  return createNtfyNotifier({
    url: parsed.origin + parsed.pathname.replace(/\/+$/, ''),
    topic,
    token: env.NTFY_TOKEN || undefined,
    mode,
    types,
    blockedApps: env.NTFY_APPS_BLOCK ? list(env.NTFY_APPS_BLOCK) : [],
    includeBody: includeBodyRaw === 'true',
    ...deps,
  });
}
