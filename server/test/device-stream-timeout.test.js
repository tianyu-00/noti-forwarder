import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildTestApp, ADMIN } from './helpers/app.js';
import { openStream } from './helpers/sse.js';
import { ensureAdminUser } from '../src/auth/users.js';

let ctx;
let agent;
let cookie;
beforeAll(async () => {
  // Short timings so the test does not wait a minute: dropped after 300 ms of silence.
  ctx = await buildTestApp({ realAuth: true, presenceTimeoutMs: 300, presenceSweepMs: 40 });
  await ensureAdminUser(ctx.pool, ADMIN);
  agent = request.agent(ctx.app);
  const res = await agent.post('/api/v1/auth/login').send(ADMIN);
  cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
});
afterAll(() => ctx.pool.end());

const phoneStream = (token) =>
  openStream(ctx.app, { path: '/api/v1/device-stream', headers: { Authorization: `Bearer ${token}` } });
const connected = async (id) => (await agent.get('/api/v1/devices')).body.devices.find((d) => d.deviceId === id).connected;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const beat = (token) => request(ctx.app).post('/api/v1/heartbeat').set('Authorization', `Bearer ${token}`);

describe('a phone that vanishes without closing its connection', () => {
  it('is shown as offline once it stops checking in, and viewers are told', async () => {
    const d = await ctx.addDevice();
    const viewer = await openStream(ctx.app, { cookie });
    await viewer.next();
    const phone = await phoneStream(d.token);
    await phone.next();
    expect(await connected(d.deviceId)).toBe(true);

    await sleep(600); // the phone says nothing (airplane mode): the socket stays open on our side

    expect(await connected(d.deviceId)).toBe(false);
    const seen = viewer.events.filter((e) => e.event === 'device_presence').map((e) => e.data.connected);
    expect(seen).toEqual([true, false]);
    phone.close();
    viewer.close();
  });

  it('stays connected while it keeps checking in', async () => {
    const d = await ctx.addDevice();
    const phone = await phoneStream(d.token);
    await phone.next();

    for (let i = 0; i < 8; i++) {
      await sleep(100);
      await beat(d.token);
    }

    expect(await connected(d.deviceId)).toBe(true); // 800 ms alive, far past the 300 ms limit
    phone.close();
  });
});
