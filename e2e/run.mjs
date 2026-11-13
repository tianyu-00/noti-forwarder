// End-to-end check against the real stack (nginx + server + SQLite), with no dependencies.
// Walks the whole path: log in, pair a phone, send a message, see it arrive live and in the list.
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';

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

// The phone checks in without a message; open dashboards hear about it.
const beat = await fetch(`${BASE}/api/v1/heartbeat`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
assert.equal(beat.status, 204, 'heartbeat is accepted');
for (let i = 0; i < 50 && !streamText.includes('device_seen'); i++) await new Promise((r) => setTimeout(r, 100));
assert.ok(streamText.includes('event: device_seen') && streamText.includes(deviceId), 'heartbeat reaches the live stream');
step('heartbeat accepted and announced live');

// The phone opens its own connection: the dashboard sees it as connected right away.
const phoneAbort = new AbortController();
const phoneStream = await fetch(`${BASE}/api/v1/device-stream`, {
  headers: { Authorization: `Bearer ${token}` },
  signal: phoneAbort.signal,
});
assert.equal(phoneStream.status, 200, 'the phone connection opens through nginx');
let phoneText = '';
const phoneReading = (async () => {
  try {
    for await (const chunk of phoneStream.body) phoneText += decoder.decode(chunk, { stream: true });
  } catch {
    // aborted at the end
  }
})();
for (let i = 0; i < 50 && !streamText.includes('"connected":true'); i++) await new Promise((r) => setTimeout(r, 100));
assert.ok(streamText.includes('event: device_presence') && streamText.includes('"connected":true'), 'dashboard sees the phone connect');
const devices = await (await fetch(`${BASE}/api/v1/devices`, { headers: { cookie } })).json();
assert.equal(devices.devices.find((d) => d.deviceId === deviceId).connected, true, 'the device list says connected');
step('phone connection is open and the dashboard shows it connected');

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

// End-to-end encryption: the phone encrypts, the server stores scrambled text it cannot read,
// and only the holder of the key gets the text back. Same byte format as the phone and dashboard.
const e2eKey = randomBytes(32);
const seal = (field, text) => {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', e2eKey, nonce);
  cipher.setAAD(Buffer.from(`nf-e2e-v1:${field}`));
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `e2e:v1:${Buffer.concat([nonce, body, cipher.getAuthTag()]).toString('base64url')}`;
};
const open = (field, blob) => {
  const raw = Buffer.from(blob.slice('e2e:v1:'.length), 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', e2eKey, raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(`nf-e2e-v1:${field}`));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString('utf8');
};
const secret = {
  id: randomUUID(),
  type: 'sms',
  app: 'sms',
  sender: seal('sender', 'Secret Bank'),
  body: seal('body', 'Your verification code is 661122. Keep it safe.'),
  receivedAt: new Date().toISOString(),
};
const sendSecret = await fetch(`${BASE}/api/v1/messages`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ messages: [secret] }),
});
assert.equal(sendSecret.status, 201, 'encrypted message is accepted');
const rawList = await (await fetch(`${BASE}/api/v1/messages`, { headers: { cookie } })).text();
assert.ok(!rawList.includes('661122') && !rawList.includes('Secret Bank'), 'the server returns no readable text');
const storedSecret = JSON.parse(rawList).messages.find((m) => m.id === secret.id);
assert.equal(storedSecret.code, null, 'the server finds no code in encrypted text');
assert.equal(open('body', storedSecret.body), 'Your verification code is 661122. Keep it safe.');
assert.equal(open('sender', storedSecret.sender), 'Secret Bank');
step('encrypted message is stored unreadable and decrypts with the key');

// Revoking cuts the phone off.
const revoke = await fetch(`${BASE}/api/v1/devices/${deviceId}`, { method: 'DELETE', headers: session() });
assert.equal(revoke.status, 204);
for (let i = 0; i < 50 && !phoneText.includes('event: revoked'); i++) await new Promise((r) => setTimeout(r, 100));
assert.ok(phoneText.includes('event: revoked'), 'the connected phone is told at once that it was revoked');
assert.equal((await send()).status, 401, 'revoked phone is rejected');
step('revoked phone is told at once and rejected');

// A phone that unpairs itself tells the dashboard at once.
const code2 = (await (await fetch(`${BASE}/api/v1/pairing-codes`, { method: 'POST', headers: session() })).json()).code;
const second = await (
  await fetch(`${BASE}/api/v1/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code2, name: 'Second phone', model: 'test', appVersion: '0.0.0', hardwareId: randomUUID() }),
  })
).json();
const unpair = await fetch(`${BASE}/api/v1/unpair`, { method: 'POST', headers: { Authorization: `Bearer ${second.token}` } });
assert.equal(unpair.status, 204);
for (let i = 0; i < 50 && !streamText.includes(`"deviceId":"${second.deviceId}"`) ; i++) await new Promise((r) => setTimeout(r, 100));
assert.match(streamText, new RegExp(`"deviceId":"${second.deviceId}"[^}]*"revokedAt":"`), 'dashboard hears the phone unpaired');
step('a phone that unpairs itself is shown as revoked at once');

streamAbort.abort();
phoneAbort.abort();
await reading;
await phoneReading;
console.log('end-to-end test passed');
