import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildTestApp, msg, ADMIN } from './helpers/app.js';
import { openStream } from './helpers/sse.js';
import { ensureAdminUser } from '../src/auth/users.js';

// A phone can have two SIMs. The phone says which ones it allows for replies, each text says which SIM
// received it, and a reply says which SIM should send it (chosen on the dashboard).
let ctx;
let agent;
let csrf;
let cookie;
beforeAll(async () => {
  ctx = await buildTestApp({ realAuth: true, outboxRateLimit: { limit: 50, windowMs: 60000 } });
  await ensureAdminUser(ctx.pool, ADMIN);
  agent = request.agent(ctx.app);
  const res = await agent.post('/api/v1/auth/login').send(ADMIN);
  csrf = res.body.csrfToken;
  cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
});
afterAll(() => ctx.pool.end());

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const putSims = (token, sims, replies) =>
  request(ctx.app).put('/api/v1/sims').set(bearer(token)).send(replies === undefined ? { sims } : { sims, replies });
const device = async (id) => (await agent.get('/api/v1/devices')).body.devices.find((d) => d.deviceId === id);
const SIMS = [
  { id: 3, slot: 1, name: 'China Mobile', allowed: false },
  { id: 5, slot: 2, name: 'Three UK', allowed: true },
];

describe('PUT /api/v1/sims (the phone lists its SIMs)', () => {
  it('needs a device token', async () => {
    expect((await request(ctx.app).put('/api/v1/sims').send({ sims: SIMS })).status).toBe(401);
  });

  it('is stored and shown with the phone on the dashboard', async () => {
    const d = await ctx.addDevice();
    expect((await device(d.deviceId)).sims).toBeNull(); // never reported

    const res = await putSims(d.token, SIMS);

    expect(res.status).toBe(204);
    expect((await device(d.deviceId)).sims).toEqual(SIMS);
  });

  it('replaces the earlier list', async () => {
    const d = await ctx.addDevice();
    await putSims(d.token, SIMS);

    await putSims(d.token, [SIMS[1]]);

    expect((await device(d.deviceId)).sims).toEqual([SIMS[1]]);
  });

  it('an empty list means the phone has none to offer, which is different from never reported', async () => {
    const d = await ctx.addDevice();

    await putSims(d.token, []);

    expect((await device(d.deviceId)).sims).toEqual([]);
  });

  it('tells open dashboards at once', async () => {
    const d = await ctx.addDevice();
    const stream = await openStream(ctx.app, { cookie });

    await putSims(d.token, SIMS);

    let event;
    for (let i = 0; i < 10 && event?.event !== 'device_sims'; i++) event = await stream.next();
    expect(event.event).toBe('device_sims');
    expect(event.data).toEqual({ deviceId: d.deviceId, sims: SIMS, replies: null });
    stream.close();
  });

  it('refuses junk: not a list, too many, missing or wrong fields, a huge name', async () => {
    const d = await ctx.addDevice();
    const bad = [
      'x',
      Array.from({ length: 9 }, (_, i) => ({ id: i, slot: 1, name: 'A', allowed: true })),
      [{ id: 1, slot: 1, allowed: true }],
      [{ id: 'a', slot: 1, name: 'A', allowed: true }],
      [{ id: 1, slot: 1, name: 'x'.repeat(101), allowed: true }],
      [{ id: 1, slot: 1, name: 'A', allowed: 'yes' }],
    ];
    for (const sims of bad) expect((await putSims(d.token, sims)).status).toBe(400);
  });
});

describe('the phone also says whether it accepts replies', () => {
  const REPLIES = { on: true, permission: true, practice: false };

  it('is null until the phone reports, and also for a phone that reports SIMs only', async () => {
    const d = await ctx.addDevice();
    expect((await device(d.deviceId)).replies).toBeNull();

    await putSims(d.token, SIMS);

    expect((await device(d.deviceId)).replies).toBeNull();
  });

  it('is stored and shown with the phone, next to its SIMs', async () => {
    const d = await ctx.addDevice();

    expect((await putSims(d.token, SIMS, REPLIES)).status).toBe(204);

    const shown = await device(d.deviceId);
    expect(shown.replies).toEqual(REPLIES);
    expect(shown.sims).toEqual(SIMS);
  });

  it('follows the latest report', async () => {
    const d = await ctx.addDevice();
    await putSims(d.token, SIMS, REPLIES);

    await putSims(d.token, SIMS, { on: false, permission: true, practice: true });

    expect((await device(d.deviceId)).replies).toEqual({ on: false, permission: true, practice: true });
  });

  it('is sent to open dashboards with the SIMs', async () => {
    const d = await ctx.addDevice();
    const stream = await openStream(ctx.app, { cookie });

    await putSims(d.token, SIMS, REPLIES);

    let event;
    for (let i = 0; i < 10 && event?.event !== 'device_sims'; i++) event = await stream.next();
    expect(event.data).toEqual({ deviceId: d.deviceId, sims: SIMS, replies: REPLIES });
    stream.close();
  });

  it('still reads a SIM list stored before replies were reported', async () => {
    const d = await ctx.addDevice();
    await ctx.pool.query('UPDATE devices SET sims = $2 WHERE device_id = $1', [d.deviceId, JSON.stringify(SIMS)]);

    const shown = await device(d.deviceId);

    expect(shown.sims).toEqual(SIMS);
    expect(shown.replies).toBeNull();
  });

  it('refuses a malformed report', async () => {
    const d = await ctx.addDevice();
    for (const replies of [{ on: true }, { on: 'yes', permission: true, practice: false }, 'on', []]) {
      expect((await putSims(d.token, SIMS, replies)).status).toBe(400);
    }
  });
});

describe('which SIM received a text', () => {
  const send = (token, messages) => request(ctx.app).post('/api/v1/messages').set(bearer(token)).send({ messages });
  const list = (deviceId) => agent.get(`/api/v1/messages?device=${deviceId}`);

  it('is stored when the phone sends it and returned as sim', async () => {
    const d = await ctx.addDevice();

    expect((await send(d.token, [msg({ type: 'sms', app: 'sms', sim: 5 })])).status).toBe(201);

    expect((await list(d.deviceId)).body.messages[0].sim).toBe(5);
  });

  it('is null for a text from a phone that does not say (older phones, notifications)', async () => {
    const d = await ctx.addDevice();

    await send(d.token, [msg()]);

    expect((await list(d.deviceId)).body.messages[0].sim).toBeNull();
  });

  it('refuses a SIM that is not a whole number', async () => {
    const d = await ctx.addDevice();

    expect((await send(d.token, [msg({ sim: 'two' })])).status).toBe(400);
    expect((await send(d.token, [msg({ sim: 1.5 })])).status).toBe(400);
  });
});

describe('which SIM a reply goes out on', () => {
  const reply = (deviceId, extra = {}) =>
    agent.post('/api/v1/outbox').set('X-CSRF-Token', csrf).send({ deviceId, to: '+15551234567', body: 'On my way', ...extra });

  it('is stored with the reply and shown to the dashboard and to the phone', async () => {
    const d = await ctx.addDevice();

    const res = await reply(d.deviceId, { sim: 5 });

    expect(res.status).toBe(201);
    expect(res.body.sim).toBe(5);
    const pending = await request(ctx.app).get('/api/v1/outbox/pending').set(bearer(d.token));
    expect(pending.body.replies[0].sim).toBe(5);
    expect((await agent.get(`/api/v1/outbox?device=${d.deviceId}`)).body.replies[0].sim).toBe(5);
  });

  it('is null when the dashboard does not choose one', async () => {
    const d = await ctx.addDevice();

    expect((await reply(d.deviceId)).body.sim).toBeNull();
  });

  it('refuses a SIM that is not a whole number', async () => {
    const d = await ctx.addDevice();

    expect((await reply(d.deviceId, { sim: 'a' })).status).toBe(400);
    expect((await reply(d.deviceId, { sim: -2 })).status).toBe(400);
  });
});
