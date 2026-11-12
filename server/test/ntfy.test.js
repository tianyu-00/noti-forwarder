import { describe, it, expect } from 'vitest';
import { createNtfyNotifier, ntfyFromEnv } from '../src/ntfy.js';

const TOPIC = 'k3f9x2m7q1w8z5v4b6n0c2xx'; // long enough to be unguessable

function message(overrides = {}) {
  return {
    id: 'id',
    type: 'notification',
    app: 'com.bank',
    sender: 'Bank',
    body: 'Your balance is low',
    code: null,
    ...overrides,
  };
}

// A fake fetch that records every request and answers with the given status.
function setup(options = {}, { status = 200, throws = null } = {}) {
  const calls = [];
  const logs = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, ...init, json: JSON.parse(init.body) });
    if (throws) throw throws;
    return { ok: status >= 200 && status < 300, status };
  };
  const notifier = createNtfyNotifier({
    url: 'https://ntfy.example.com',
    topic: TOPIC,
    fetchImpl,
    logger: { warn: (line) => logs.push(line) },
    ...options,
  });
  return { notifier, calls, logs };
}

describe('createNtfyNotifier', () => {
  it('publishes JSON to the base URL and keeps Chinese text and emoji intact', async () => {
    const { notifier, calls } = setup();

    await notifier.notify([message({ app: 'com.tencent.mm', sender: '微信', body: '你好 👋' })], 'Kitchen phone');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://ntfy.example.com');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers['Content-Type']).toBe('application/json');
    expect(calls[0].json).toMatchObject({ topic: TOPIC, message: '你好 👋', priority: 3 });
    expect(calls[0].json.title).toContain('Kitchen phone');
    expect(calls[0].json.title).toContain('微信');
  });

  it('puts the 2FA code in the title and raises the priority', async () => {
    const { notifier, calls } = setup();

    await notifier.notify([message({ type: 'sms', app: 'sms', sender: '+447700900123', body: 'Your code is 482913', code: '482913' })], 'Phone');

    expect(calls[0].json.title).toMatch(/^🔑 482913/);
    expect(calls[0].json.priority).toBe(4);
    expect(calls[0].json.tags).toContain('key');
    expect(calls[0].json.title).toContain('SMS from +447700900123');
  });

  it('sends every message by default, or only codes in codes mode', async () => {
    const all = setup();
    await all.notifier.notify([message(), message({ code: '123456' })], 'Phone');
    expect(all.calls).toHaveLength(2);

    const codes = setup({ mode: 'codes' });
    await codes.notifier.notify([message(), message({ code: '123456' })], 'Phone');
    expect(codes.calls).toHaveLength(1);
    expect(codes.calls[0].json.title).toContain('123456');
  });

  it('can be limited to sms or to notifications', async () => {
    const smsOnly = setup({ types: ['sms'] });
    await smsOnly.notifier.notify([message(), message({ type: 'sms', app: 'sms' })], 'Phone');
    expect(smsOnly.calls.map((c) => c.json.title)).toEqual([expect.stringContaining('SMS')]);
  });

  it('never pushes for blocked apps', async () => {
    const { notifier, calls } = setup({ blockedApps: ['com.game', 'com.news'] });

    await notifier.notify([message({ app: 'com.game' }), message({ app: 'com.news' }), message({ app: 'com.bank' })], 'Phone');

    expect(calls).toHaveLength(1);
    expect(calls[0].json.title).toContain('com.bank');
  });

  it('can leave the message text, sender, app and code out entirely', async () => {
    const { notifier, calls } = setup({ includeBody: false });

    await notifier.notify([message({ body: 'Your code is 482913', code: '482913', sender: 'Bank' })], 'Phone');

    const text = JSON.stringify(calls[0].json);
    expect(text).not.toContain('482913');
    expect(text).not.toContain('Bank');
    expect(text).not.toContain('com.bank');
    expect(calls[0].json.message).toBe('New message');
  });

  it('authenticates with a token only when one is configured', async () => {
    const withToken = setup({ token: 'tk_secret' });
    await withToken.notifier.notify([message()], 'Phone');
    expect(withToken.calls[0].headers.Authorization).toBe('Bearer tk_secret');

    const without = setup();
    await without.notifier.notify([message()], 'Phone');
    expect(without.calls[0].headers.Authorization).toBeUndefined();
  });

  it('never throws, and never writes message text into the logs, when ntfy fails', async () => {
    const secret = 'Your code is 482913';
    for (const failure of [{ throws: new Error('connect ECONNREFUSED') }, { status: 500 }, { status: 429 }]) {
      const { notifier, logs } = setup({}, failure);

      await expect(notifier.notify([message({ body: secret, code: '482913' })], 'Phone')).resolves.toBeDefined();

      expect(logs.length).toBeGreaterThan(0);
      expect(logs.join('\n')).not.toContain('482913');
      expect(logs.join('\n')).not.toContain(secret);
    }
  });

  it('gives up on a push that hangs', async () => {
    const logs = [];
    const notifier = createNtfyNotifier({
      url: 'https://ntfy.example.com',
      topic: TOPIC,
      timeoutMs: 30,
      logger: { warn: (l) => logs.push(l) },
      fetchImpl: (url, init) =>
        new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
    });

    await notifier.notify([message()], 'Phone');

    expect(logs.join('\n')).toMatch(/failed/);
  });

  it('caps a burst at 5 pushes plus one summary', async () => {
    const { notifier, calls } = setup();
    const burst = Array.from({ length: 12 }, (_, i) => message({ body: `message ${i}` }));

    await notifier.notify(burst, 'Kitchen phone');

    expect(calls).toHaveLength(6);
    expect(calls[5].json.title).toContain('Kitchen phone');
    expect(calls[5].json.message).toMatch(/7 more/);
  });

  it('shortens very long text', async () => {
    const { notifier, calls } = setup();

    await notifier.notify([message({ body: 'x'.repeat(5000) })], 'Phone');

    expect(calls[0].json.message.length).toBeLessThanOrEqual(1001);
  });

  it('does nothing for an empty list', async () => {
    const { notifier, calls } = setup();
    await notifier.notify([], 'Phone');
    expect(calls).toHaveLength(0);
  });
});

describe('ntfyFromEnv', () => {
  it('is off when no topic is configured', () => {
    expect(ntfyFromEnv({})).toBeNull();
    expect(ntfyFromEnv({ NTFY_URL: 'https://ntfy.example.com' })).toBeNull();
  });

  it('turns on with sensible defaults', async () => {
    const calls = [];
    const notifier = ntfyFromEnv({ NTFY_URL: 'https://ntfy.example.com', NTFY_TOPIC: TOPIC }, { fetchImpl: async (u, i) => (calls.push(JSON.parse(i.body)), { ok: true, status: 200 }) });

    await notifier.notify([message(), message({ type: 'sms', app: 'sms' })], 'Phone');

    expect(calls).toHaveLength(2); // all messages, both types
    expect(calls[0].message).toBe('Your balance is low'); // text included
  });

  it('defaults to ntfy.sh', () => {
    expect(() => ntfyFromEnv({ NTFY_TOPIC: TOPIC })).not.toThrow();
  });

  it('refuses a guessable topic on the public ntfy.sh', () => {
    expect(() => ntfyFromEnv({ NTFY_TOPIC: 'alerts' })).toThrow(/topic.*random/i);
    expect(() => ntfyFromEnv({ NTFY_URL: 'https://ntfy.sh', NTFY_TOPIC: 'short-topic-1' })).toThrow(/topic/i);
  });

  it('allows a short topic on your own ntfy server', () => {
    expect(() => ntfyFromEnv({ NTFY_URL: 'https://ntfy.example.com', NTFY_TOPIC: 'alerts' })).not.toThrow();
  });

  it('refuses plain http except for a local server', () => {
    expect(() => ntfyFromEnv({ NTFY_URL: 'http://ntfy.example.com', NTFY_TOPIC: TOPIC })).toThrow(/https/i);
    expect(() => ntfyFromEnv({ NTFY_URL: 'http://localhost:8080', NTFY_TOPIC: 'alerts' })).not.toThrow();
    expect(() => ntfyFromEnv({ NTFY_URL: 'http://ntfy:80', NTFY_TOPIC: 'alerts' })).not.toThrow(); // a Docker service name
  });

  it('rejects settings it does not understand instead of ignoring them', () => {
    const base = { NTFY_URL: 'https://ntfy.example.com', NTFY_TOPIC: TOPIC };
    expect(() => ntfyFromEnv({ ...base, NTFY_MODE: 'sometimes' })).toThrow(/NTFY_MODE/);
    expect(() => ntfyFromEnv({ ...base, NTFY_TYPES: 'sms,email' })).toThrow(/NTFY_TYPES/);
    expect(() => ntfyFromEnv({ ...base, NTFY_INCLUDE_BODY: 'maybe' })).toThrow(/NTFY_INCLUDE_BODY/);
    expect(() => ntfyFromEnv({ ...base, NTFY_URL: 'not a url' })).toThrow(/NTFY_URL/);
  });

  it('treats blank settings, as found in a .env file, as not set', async () => {
    const calls = [];
    const notifier = ntfyFromEnv(
      {
        NTFY_URL: '',
        NTFY_TOPIC: TOPIC,
        NTFY_TOKEN: '',
        NTFY_MODE: '',
        NTFY_TYPES: '',
        NTFY_APPS_BLOCK: '',
        NTFY_INCLUDE_BODY: '',
      },
      { fetchImpl: async (u, i) => (calls.push({ url: u, headers: i.headers, json: JSON.parse(i.body) }), { ok: true, status: 200 }) },
    );

    await notifier.notify([message(), message({ type: 'sms', app: 'sms' })], 'Phone');

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('https://ntfy.sh');
    expect(calls[0].json.message).toBe('Your balance is low');
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it('reads the filters from the environment, tolerating spaces', async () => {
    const calls = [];
    const notifier = ntfyFromEnv(
      {
        NTFY_URL: 'https://ntfy.example.com',
        NTFY_TOPIC: TOPIC,
        NTFY_MODE: 'all',
        NTFY_TYPES: ' sms , notification ',
        NTFY_APPS_BLOCK: ' com.game , com.news ',
        NTFY_INCLUDE_BODY: 'false',
        NTFY_TOKEN: 'tk_1',
      },
      { fetchImpl: async (u, i) => (calls.push({ headers: i.headers, json: JSON.parse(i.body) }), { ok: true, status: 200 }) },
    );

    await notifier.notify([message({ app: 'com.game' }), message({ app: 'com.bank' })], 'Phone');

    expect(calls).toHaveLength(1);
    expect(calls[0].json.message).toBe('New message');
    expect(calls[0].headers.Authorization).toBe('Bearer tk_1');
  });
});
