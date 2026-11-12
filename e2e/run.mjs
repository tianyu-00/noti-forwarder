// End-to-end check against the real stack (nginx + server + Postgres), with no dependencies.
// Walks the whole path: log in, pair a phone, send a message, see it arrive live and in the list.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:3100';
const ADMIN = { username: 'e2e-admin', password: 'e2e-test-password-123' };

async function waitForHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/api/v1/health`);
      if (res.ok) return await res.json();
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('stack did not become healthy in 2 minutes');
}

function step(name) {
  console.log(`- ${name}`);
}

const health = await waitForHealth();
step(`stack is up (version ${health.version})`);

// The dashboard itself is served by nginx.
const page = await (await fetch(`${BASE}/`)).text();
assert.match(page, /<div id="root"/, 'dashboard page is served');
step('dashboard page is served');

// Log in. The cookie is Secure, so it is sent by hand over plain http here.
const loginRes = await fetch(`${BASE}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(ADMIN),
});
assert.equal(loginRes.status, 200, 'login works');
const { csrfToken } = await loginRes.json();
const cookie = loginRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const session = (extra = {}) => ({ cookie, 'X-CSRF-Token': csrfToken, ...extra });
step('logged in');

// Open the live stream first, so the message can be seen arriving.
const streamAbort = new AbortController();
const stream = await fetch(`${BASE}/api/v1/stream`, { headers: { cookie }, signal: streamAbort.signal });
assert.equal(stream.status, 200, 'stream opens through nginx');
const decoder = new TextDecoder();
let streamText = '';
const reading = (async () => {
  try {
    for await (const chunk of stream.body) streamText += decoder.decode(chunk, { stream: true });
  } catch {
    // aborted at the end
  }
})();
step('live stream opened');

// Pair a phone.
const codeRes = await fetch(`${BASE}/api/v1/pairing-codes`, { method: 'POST', headers: session() });
assert.equal(codeRes.status, 201);
const { code } = await codeRes.json();
const pairRes = await fetch(`${BASE}/api/v1/pair`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code, name: 'E2E phone', model: 'test', appVersion: '0.0.0', hardwareId: randomUUID() }),
});
assert.equal(pairRes.status, 201, 'phone pairs');
const { token, deviceId } = await pairRes.json();
step('phone paired');

// Send a message like the phone does.
const message = {
  id: randomUUID(),
  type: 'sms',
  app: 'sms',
  sender: '+10000000000',
  body: 'Your code is 482913. Do not share it.',
  receivedAt: new Date().toISOString(),
};
const send = () =>
  fetch(`${BASE}/api/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: [message] }),
  });
const first = await send();
assert.equal(first.status, 201);
assert.deepEqual(await first.json(), { stored: 1, duplicates: 0 });
step('message accepted');

// It must arrive live...
for (let i = 0; i < 50 && !streamText.includes(message.id); i++) await new Promise((r) => setTimeout(r, 100));
assert.ok(streamText.includes(message.id), 'message arrives on the live stream');
assert.ok(streamText.includes('"code":"482913"'), 'the 2FA code is detected');
step('message arrived live with its code');

// ...and in the list the dashboard loads.
const list = await (await fetch(`${BASE}/api/v1/messages`, { headers: { cookie } })).json();
const found = list.messages.find((m) => m.id === message.id);
assert.ok(found, 'message is in the list');
assert.equal(found.body, message.body);
assert.equal(found.code, '482913');
step('message is in the list');

// A retry is harmless.
assert.deepEqual(await (await send()).json(), { stored: 0, duplicates: 1 });
step('a retry is not stored twice');

// Revoking cuts the phone off.
const revoke = await fetch(`${BASE}/api/v1/devices/${deviceId}`, { method: 'DELETE', headers: session() });
assert.equal(revoke.status, 204);
assert.equal((await send()).status, 401, 'revoked phone is rejected');
step('revoked phone is rejected');

streamAbort.abort();
await reading;
console.log('end-to-end test passed');
