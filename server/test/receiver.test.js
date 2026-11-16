import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { buildTestApp, msg, ADMIN } from './helpers/app.js';
import { openStream } from './helpers/sse.js';
import { ensureAdminUser } from '../src/auth/users.js';

// A receiver is the main phone: it gets the messages (still encrypted) and shows them. It has its own
// limited token, made from a pairing code that was created for a receiver.
let ctx;
let agent;
let csrf;
beforeAll(async () => {
  ctx = await buildTestApp({ realAuth: true, publicUrl: 'https://nf.example.com' });
  await ensureAdminUser(ctx.pool, ADMIN);
  agent = request.agent(ctx.app);
  const res = await agent.post('/api/v1/auth/login').send(ADMIN);
  csrf = res.body.csrfToken;
});
afterAll(() => ctx.pool.end());

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const newCode = (body) => agent.post('/api/v1/pairing-codes').set('X-CSRF-Token', csrf).send(body);
const pair = (code, extra = {}) =>
  request(ctx.app).post('/api/v1/pair').send({ code, name: 'Main phone', ...extra });
const devices = async () => (await agent.get('/api/v1/devices')).body.devices;
const send = (token, messages) => request(ctx.app).post('/api/v1/messages').set(bearer(token)).send({ messages });
const receiverStream = (token) => openStream(ctx.app, { path: '/api/v1/receiver/stream', headers: bearer(token) });
const nextOfType = async (stream, type) => {
  for (let i = 0; i < 10; i++) {
    const e = await stream.next();
    if (e.event === type) return e;
  }
  throw new Error(`no ${type} event`);
};

describe('pairing a receiver', () => {
  it('a pairing code is for a sender unless the dashboard says receiver, so older dashboards and apps work as before', async () => {
    const res = await newCode();

    expect(res.status).toBe(201);
    const paired = await pair(res.body.code);
    expect(paired.status).toBe(201);
    expect(paired.body.role).toBe('sender');
  });

  it('a receiver code makes a receiver, shown with its role on the dashboard', async () => {
    const code = (await newCode({ role: 'receiver' })).body.code;

    const paired = await pair(code);

    expect(paired.body.role).toBe('receiver');
    const mine = (await devices()).find((d) => d.deviceId === paired.body.deviceId);
    expect(mine.role).toBe('receiver');
  });

  it('refuses a role that is neither sender nor receiver', async () => {
    expect((await newCode({ role: 'admin' })).status).toBe(400);
  });

  it('a phone pairing again with the other kind of code switches its role', async () => {
    const hardwareId = `hw-${randomUUID()}`;
    await pair((await newCode({ role: 'sender' })).body.code, { hardwareId });

    const again = await pair((await newCode({ role: 'receiver' })).body.code, { hardwareId });

    expect(again.body.role).toBe('receiver');
    expect((await devices()).filter((d) => d.deviceId === again.body.deviceId)).toHaveLength(1);
  });

  it('lists sender devices as senders', async () => {
    const d = await ctx.addDevice();

    expect((await devices()).find((x) => x.deviceId === d.deviceId).role).toBe('sender');
  });
});

describe('a receiver can read but never send', () => {
  it('cannot post messages: its token is not a sender token', async () => {
    const r = await ctx.addDevice({ role: 'receiver' });

    const res = await send(r.token, [msg()]);

    expect(res.status).toBe(403);
  });

  it('a sender still can', async () => {
    const s = await ctx.addDevice();

    expect((await send(s.token, [msg()])).status).toBe(201);
  });
});

describe('GET /api/v1/receiver/messages (the recent messages, still encrypted)', () => {
  const list = (token, query = '') =>
    request(ctx.app).get(`/api/v1/receiver/messages${query}`).set(token ? bearer(token) : {});

  it('needs a receiver token: nothing without one, and not a sender token', async () => {
    const s = await ctx.addDevice();

    expect((await list(null)).status).toBe(401);
    expect((await list(s.token)).status).toBe(403);
  });

  it('gives the newest messages first, exactly as stored, so decrypting stays on the phone', async () => {
    const s = await ctx.addDevice();
    const r = await ctx.addDevice({ role: 'receiver' });
    await send(s.token, [
      msg({ id: randomUUID(), body: 'e2e:v1:AAAA', sender: 'e2e:v1:BBBB', receivedAt: '2026-11-11T10:00:00Z', type: 'sms', app: 'sms' }),
      msg({ id: randomUUID(), body: 'e2e:v1:CCCC', sender: '', receivedAt: '2026-11-11T11:00:00Z' }),
    ]);

    const res = await list(r.token, `?limit=100`);

    expect(res.status).toBe(200);
    const mine = res.body.messages.filter((m) => m.deviceId === s.deviceId);
    expect(mine.map((m) => m.body)).toEqual(['e2e:v1:CCCC', 'e2e:v1:AAAA']);
    expect(mine[1].sender).toBe('e2e:v1:BBBB');
    expect(mine[0].code).toBeNull();
  });

  it("names the phone each message came from, so an alert can say 'Kitchen phone'", async () => {
    const s = await ctx.addDevice();
    const r = await ctx.addDevice({ role: 'receiver' });
    await send(s.token, [msg({ body: 'e2e:v1:NAME' })]);

    const res = await list(r.token, '?limit=100');

    const mine = res.body.messages.find((m) => m.body === 'e2e:v1:NAME');
    expect(mine.deviceName).toBe('Test phone');
  });

  it('can be limited, and refuses a nonsense limit', async () => {
    const r = await ctx.addDevice({ role: 'receiver' });

    expect((await list(r.token, '?limit=1')).body.messages.length).toBeLessThanOrEqual(1);
    expect((await list(r.token, '?limit=abc')).status).toBe(400);
    expect((await list(r.token, '?limit=100000')).status).toBe(400);
  });

  it('a revoked receiver is turned away', async () => {
    const r = await ctx.addDevice({ role: 'receiver', revoked: true });

    expect((await list(r.token)).status).toBe(401);
  });
});

describe('GET /api/v1/receiver/stream (live updates for the receiver)', () => {
  it('needs a receiver token', async () => {
    const s = await ctx.addDevice();

    const none = await openStream(ctx.app, { path: '/api/v1/receiver/stream' });
    const sender = await receiverStream(s.token);

    expect(none.status).toBe(401);
    expect(sender.status).toBe(403);
    none.close();
    sender.close();
  });

  it('pushes each new message as it arrives', async () => {
    const s = await ctx.addDevice();
    const r = await ctx.addDevice({ role: 'receiver' });
    const stream = await receiverStream(r.token);

    await send(s.token, [msg({ body: 'e2e:v1:ZZZZ' })]);

    const event = await nextOfType(stream, 'message');
    expect(event.data.body).toBe('e2e:v1:ZZZZ');
    expect(event.data.deviceId).toBe(s.deviceId);
    expect(event.data.deviceName).toBe('Test phone');
    stream.close();
  });

  it("tells it when a phone's messages, or all messages, are cleared on the dashboard", async () => {
    const s = await ctx.addDevice();
    const r = await ctx.addDevice({ role: 'receiver' });
    const stream = await receiverStream(r.token);

    await agent.delete(`/api/v1/devices/${s.deviceId}/messages`).set('X-CSRF-Token', csrf);
    const one = await nextOfType(stream, 'messages_cleared');
    await agent.delete('/api/v1/messages').set('X-CSRF-Token', csrf);
    const all = await nextOfType(stream, 'messages_cleared_all');

    expect(one.data).toEqual({ deviceId: s.deviceId });
    expect(all.data).toEqual({});
    stream.close();
  });

  it('tells it when an erased phone takes its messages with it', async () => {
    const s = await ctx.addDevice({ revoked: true });
    const r = await ctx.addDevice({ role: 'receiver' });
    const stream = await receiverStream(r.token);

    await agent.delete(`/api/v1/devices/${s.deviceId}/permanent`).set('X-CSRF-Token', csrf);

    expect((await nextOfType(stream, 'device_deleted')).data).toEqual({ deviceId: s.deviceId });
    stream.close();
  });

  it('tells it when the retention limit deletes old messages', async () => {
    const s = await ctx.addDevice();
    const r = await ctx.addDevice({ role: 'receiver' });
    await send(s.token, [msg({ receivedAt: '2020-01-01T00:00:00Z' })]);
    const stream = await receiverStream(r.token);

    await agent.put('/api/v1/settings').set('X-CSRF-Token', csrf).send({ retentionDays: 30 });

    await nextOfType(stream, 'messages_purged');
    await agent.put('/api/v1/settings').set('X-CSRF-Token', csrf).send({ retentionDays: null });
    stream.close();
  });

  it('tells it when a sender phone goes quiet and when it is back, by name and never with message text', async () => {
    const r = await ctx.addDevice({ role: 'receiver' });
    const stream = await receiverStream(r.token);

    ctx.app.locals.events.publish('device_quiet', { deviceId: 'k1', deviceName: 'Kitchen phone', minutes: 180 });
    ctx.app.locals.events.publish('device_back', { deviceId: 'k1', deviceName: 'Kitchen phone' });

    expect((await nextOfType(stream, 'device_quiet')).data).toEqual({ deviceId: 'k1', deviceName: 'Kitchen phone', minutes: 180 });
    expect((await nextOfType(stream, 'device_back')).data).toEqual({ deviceId: 'k1', deviceName: 'Kitchen phone' });
    stream.close();
  });

  it('does not leak dashboard-only news, such as which phones are online or their replies and SIMs', async () => {
    const s = await ctx.addDevice();
    const r = await ctx.addDevice({ role: 'receiver' });
    const stream = await receiverStream(r.token);

    await request(ctx.app).post('/api/v1/heartbeat').set(bearer(s.token));
    await request(ctx.app).put('/api/v1/sims').set(bearer(s.token)).send({ sims: [] });

    expect(await stream.quiet(400)).toBe(true);
    const types = stream.events.map((e) => e.event);
    expect(types).not.toContain('device_seen');
    expect(types).not.toContain('device_sims');
    stream.close();
  });

  it('is told when it is revoked, then hung up on', async () => {
    const r = await ctx.addDevice({ role: 'receiver' });
    const stream = await receiverStream(r.token);

    await agent.delete(`/api/v1/devices/${r.deviceId}`).set('X-CSRF-Token', csrf);

    await nextOfType(stream, 'revoked');
    stream.close();
  });
});
