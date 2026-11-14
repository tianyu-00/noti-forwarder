import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { buildTestApp, ADMIN } from './helpers/app.js';
import { openStream } from './helpers/sse.js';
import { ensureAdminUser } from '../src/auth/users.js';

// A reply typed on the dashboard waits in the outbox until its phone sends it as an SMS.
let ctx;
let agent;
let csrf;
let cookie;
beforeAll(async () => {
  ctx = await buildTestApp({ realAuth: true, outboxRateLimit: { limit: 50, windowMs: 60000 }, outboxMaxAgeMs: 60 * 60 * 1000 });
  await ensureAdminUser(ctx.pool, ADMIN);
  agent = request.agent(ctx.app);
  const res = await agent.post('/api/v1/auth/login').send(ADMIN);
  csrf = res.body.csrfToken;
  cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
});
afterAll(() => ctx.pool.end());

const reply = (deviceId, extra = {}) =>
  agent.post('/api/v1/outbox').set('X-CSRF-Token', csrf).send({ deviceId, to: '+15551234567', body: 'On my way', ...extra });
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const phoneStream = (token) => openStream(ctx.app, { path: '/api/v1/device-stream', headers: bearer(token) });
const dashboardStream = () => openStream(ctx.app, { cookie });
const nextOfType = async (stream, type) => {
  for (let i = 0; i < 10; i++) {
    const e = await stream.next();
    if (e.event === type) return e;
  }
  throw new Error(`no ${type} event`);
};

describe('POST /api/v1/outbox (the dashboard queues a reply)', () => {
  it('needs a session and a CSRF token', async () => {
    const d = await ctx.addDevice();

    const noSession = await request(ctx.app).post('/api/v1/outbox').send({ deviceId: d.deviceId, to: '+15551234567', body: 'hi' });
    const noCsrf = await agent.post('/api/v1/outbox').send({ deviceId: d.deviceId, to: '+15551234567', body: 'hi' });

    expect(noSession.status).toBe(401);
    expect(noCsrf.status).toBe(403);
  });

  it('stores the reply as queued and returns it', async () => {
    const d = await ctx.addDevice();

    const res = await reply(d.deviceId);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      deviceId: d.deviceId,
      to: '+15551234567',
      body: 'On my way',
      status: 'queued',
      error: null,
      sim: null,
      createdAt: expect.any(String),
      sentAt: null,
    });
  });

  it('refuses bad input: a bad number, empty or oversized text, junk fields', async () => {
    const d = await ctx.addDevice();

    for (const extra of [{ to: 'call me' }, { to: '' }, { body: '' }, { body: 'x'.repeat(1601) }, { deviceId: 'nope' }, { body: 5 }]) {
      expect((await reply(d.deviceId, extra)).status).toBe(400);
    }
  });

  it('accepts a number and text that the browser encrypted, which the server cannot read', async () => {
    const d = await ctx.addDevice();
    const sealed = (n) => `e2e:v1:${'A'.repeat(n)}`;

    const res = await reply(d.deviceId, { to: sealed(40), body: sealed(300) });

    expect(res.status).toBe(201);
    expect(res.body.to).toBe(sealed(40));
  });

  it('refuses an unknown phone (404) and a revoked one (409)', async () => {
    const revoked = await ctx.addDevice({ revoked: true });

    expect((await reply(randomUUID())).status).toBe(404);
    expect((await reply(revoked.deviceId)).status).toBe(409);
  });

  it('is rate limited', async () => {
    const limited = await buildTestApp({ realAuth: true, outboxRateLimit: { limit: 2, windowMs: 60000 } });
    await ensureAdminUser(limited.pool, ADMIN);
    const a = request.agent(limited.app);
    const token = (await a.post('/api/v1/auth/login').send(ADMIN)).body.csrfToken;
    const d = await limited.addDevice();
    const post = () => a.post('/api/v1/outbox').set('X-CSRF-Token', token).send({ deviceId: d.deviceId, to: '+15551234567', body: 'hi' });

    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(429);
    await limited.pool.end();
  });

  it('writes an audit entry that holds no text and no number', async () => {
    const d = await ctx.addDevice();
    await reply(d.deviceId, { to: '+15559998888', body: 'secret words' });

    const { rows } = await ctx.pool.query("SELECT * FROM audit_log WHERE event = 'reply' AND device_id = $1", [d.deviceId]);

    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toMatch(/secret words|5559998888/);
  });

  it('tells the dashboards, and tells only that phone if it is connected', async () => {
    const d = await ctx.addDevice();
    const other = await ctx.addDevice();
    const phone = await phoneStream(d.token);
    const otherPhone = await phoneStream(other.token);
    const dash = await dashboardStream();

    const res = await reply(d.deviceId);

    const onPhone = await nextOfType(phone, 'outbox');
    expect(onPhone.data.id).toBe(res.body.id);
    expect((await nextOfType(dash, 'outbox')).data).toEqual(res.body);
    expect(await otherPhone.quiet(200)).toBe(true);
    phone.close();
    otherPhone.close();
    dash.close();
  });
});

describe('GET /api/v1/outbox (the dashboard lists replies)', () => {
  it('needs a session', async () => {
    expect((await request(ctx.app).get('/api/v1/outbox')).status).toBe(401);
  });

  it('lists newest first, and only one phone when asked', async () => {
    const a = await ctx.addDevice();
    const b = await ctx.addDevice();
    const first = (await reply(a.deviceId, { body: 'one' })).body;
    await reply(b.deviceId, { body: 'elsewhere' });
    const second = (await reply(a.deviceId, { body: 'two' })).body;

    const res = await agent.get(`/api/v1/outbox?device=${a.deviceId}`);

    expect(res.status).toBe(200);
    expect(res.body.replies.map((r) => r.id)).toEqual([second.id, first.id]);
  });
});

describe('GET /api/v1/outbox/pending (the phone asks what to send)', () => {
  it('needs a valid device token', async () => {
    const revoked = await ctx.addDevice({ revoked: true });

    expect((await request(ctx.app).get('/api/v1/outbox/pending')).status).toBe(401);
    expect((await request(ctx.app).get('/api/v1/outbox/pending').set(bearer(revoked.token))).status).toBe(401);
  });

  it('gives that phone its queued replies, oldest first, and nothing else', async () => {
    const a = await ctx.addDevice();
    const b = await ctx.addDevice();
    const one = (await reply(a.deviceId, { body: 'one' })).body;
    await reply(b.deviceId, { body: 'not for a' });
    const two = (await reply(a.deviceId, { body: 'two' })).body;
    await request(ctx.app).post(`/api/v1/outbox/${one.id}/result`).set(bearer(a.token)).send({ status: 'sent' });

    const res = await request(ctx.app).get('/api/v1/outbox/pending').set(bearer(a.token));

    expect(res.status).toBe(200);
    expect(res.body.replies.map((r) => ({ id: r.id, to: r.to, body: r.body }))).toEqual([
      { id: two.id, to: '+15551234567', body: 'two' },
    ]);
  });

  it('does not send a stale reply: past the age limit it fails as expired instead', async () => {
    const d = await ctx.addDevice();
    const old = (await reply(d.deviceId, { body: 'too late now' })).body;
    await ctx.pool.query('UPDATE outbox SET created_at = $2 WHERE id = $1', [old.id, new Date(Date.now() - 2 * 60 * 60 * 1000)]);
    const dash = await dashboardStream();

    const res = await request(ctx.app).get('/api/v1/outbox/pending').set(bearer(d.token));

    expect(res.body.replies).toEqual([]);
    const seen = (await agent.get(`/api/v1/outbox?device=${d.deviceId}`)).body.replies[0];
    expect(seen).toMatchObject({ id: old.id, status: 'failed', error: 'expired' });
    expect((await nextOfType(dash, 'outbox')).data).toMatchObject({ id: old.id, status: 'failed', error: 'expired' });
    dash.close();
  });
});

describe('POST /api/v1/outbox/:id/result (the phone reports)', () => {
  const result = (token, id, body) => request(ctx.app).post(`/api/v1/outbox/${id}/result`).set(bearer(token)).send(body);

  it('needs a valid device token', async () => {
    const d = await ctx.addDevice();
    const r = (await reply(d.deviceId)).body;

    expect((await request(ctx.app).post(`/api/v1/outbox/${r.id}/result`).send({ status: 'sent' })).status).toBe(401);
  });

  it('marks a reply sent, with the time, and tells the dashboards', async () => {
    const d = await ctx.addDevice();
    const r = (await reply(d.deviceId)).body;
    const dash = await dashboardStream();

    const res = await result(d.token, r.id, { status: 'sent' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: r.id, status: 'sent', error: null, sentAt: expect.any(String) });
    expect((await nextOfType(dash, 'outbox')).data).toMatchObject({ id: r.id, status: 'sent' });
    dash.close();
  });

  it('marks a reply failed with a short reason code', async () => {
    const d = await ctx.addDevice();
    const r = (await reply(d.deviceId)).body;

    const res = await result(d.token, r.id, { status: 'failed', error: 'no_permission' });

    expect(res.body).toMatchObject({ status: 'failed', error: 'no_permission', sentAt: null });
  });

  it('is harmless to report twice: the first answer stands', async () => {
    const d = await ctx.addDevice();
    const r = (await reply(d.deviceId)).body;
    await result(d.token, r.id, { status: 'sent' });

    const again = await result(d.token, r.id, { status: 'failed', error: 'generic' });

    expect(again.status).toBe(200);
    expect(again.body.status).toBe('sent');
  });

  it("will not touch another phone's reply, and refuses a bad status", async () => {
    const a = await ctx.addDevice();
    const b = await ctx.addDevice();
    const r = (await reply(a.deviceId)).body;

    expect((await result(b.token, r.id, { status: 'sent' })).status).toBe(404);
    expect((await result(a.token, r.id, { status: 'maybe' })).status).toBe(400);
    expect((await result(a.token, r.id, { status: 'failed', error: 'a long message with the text in it '.repeat(5) })).status).toBe(400);
  });
});

describe('cleanup', () => {
  it("clearing a phone's messages also clears its replies", async () => {
    const d = await ctx.addDevice();
    await reply(d.deviceId);

    await agent.delete(`/api/v1/devices/${d.deviceId}/messages`).set('X-CSRF-Token', csrf);

    expect((await agent.get(`/api/v1/outbox?device=${d.deviceId}`)).body.replies).toEqual([]);
  });

  it('clearing every message also clears every reply', async () => {
    const d = await ctx.addDevice();
    await reply(d.deviceId);

    await agent.delete('/api/v1/messages').set('X-CSRF-Token', csrf);

    expect((await agent.get('/api/v1/outbox')).body.replies).toEqual([]);
  });

  it('erasing a revoked phone removes its replies', async () => {
    const d = await ctx.addDevice();
    await reply(d.deviceId);
    await agent.delete(`/api/v1/devices/${d.deviceId}`).set('X-CSRF-Token', csrf);

    const res = await agent.delete(`/api/v1/devices/${d.deviceId}/permanent`).set('X-CSRF-Token', csrf);

    expect(res.status).toBe(204);
    const { rows } = await ctx.pool.query('SELECT 1 FROM outbox WHERE device_id = $1', [d.deviceId]);
    expect(rows).toEqual([]);
  });
});
