import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildTestApp, ADMIN } from './helpers/app.js';
import { openStream } from './helpers/sse.js';
import { ensureAdminUser } from '../src/auth/users.js';

let ctx;
let agent;
let csrf;
let cookie;
beforeAll(async () => {
  ctx = await buildTestApp({ realAuth: true });
  await ensureAdminUser(ctx.pool, ADMIN);
  agent = request.agent(ctx.app);
  const res = await agent.post('/api/v1/auth/login').send(ADMIN);
  csrf = res.body.csrfToken;
  cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
});
afterAll(() => ctx.pool.end());

const phoneStream = (token) =>
  openStream(ctx.app, { path: '/api/v1/device-stream', headers: { Authorization: `Bearer ${token}` } });
const dashboardStream = () => openStream(ctx.app, { cookie });
const nextOfType = async (stream, type) => {
  for (let i = 0; i < 10; i++) {
    const e = await stream.next();
    if (e.event === type) return e;
  }
  throw new Error(`no ${type} event`);
};
const deviceRow = async (id) => (await agent.get('/api/v1/devices')).body.devices.find((d) => d.deviceId === id);

describe('GET /api/v1/device-stream (the phone\'s connection)', () => {
  it('needs a device token, and refuses a revoked phone', async () => {
    const revoked = await ctx.addDevice({ revoked: true });

    expect((await openStream(ctx.app, { path: '/api/v1/device-stream' })).status).toBe(401);
    expect((await phoneStream('wrong')).status).toBe(401);
    expect((await phoneStream(revoked.token)).status).toBe(401);
  });

  it('shows the phone as connected while the connection is open, and as gone when it closes', async () => {
    const d = await ctx.addDevice();
    const viewer = await dashboardStream();
    await viewer.next(); // connected

    const phone = await phoneStream(d.token);
    expect(phone.status).toBe(200);
    expect(phone.headers['content-type']).toMatch(/text\/event-stream/);
    expect(await phone.next()).toEqual({ comment: 'connected' });

    const on = await nextOfType(viewer, 'device_presence');
    expect(on.data).toEqual({ deviceId: d.deviceId, connected: true, lastSeen: expect.any(String) });
    expect((await deviceRow(d.deviceId)).connected).toBe(true);

    phone.close();
    const off = await nextOfType(viewer, 'device_presence');
    expect(off.data).toEqual({ deviceId: d.deviceId, connected: false, lastSeen: expect.any(String) });
    expect((await deviceRow(d.deviceId)).connected).toBe(false);
    viewer.close();
  });

  it('tells the phone at once when it is revoked in the dashboard', async () => {
    const d = await ctx.addDevice();
    const phone = await phoneStream(d.token);
    await phone.next();

    await agent.delete(`/api/v1/devices/${d.deviceId}`).set('X-CSRF-Token', csrf);

    const event = await phone.next();
    expect(event.event).toBe('revoked');
    expect((await deviceRow(d.deviceId)).connected).toBe(false);
    phone.close();
  });

  it('lets a newer connection replace the old one', async () => {
    const d = await ctx.addDevice();
    const first = await phoneStream(d.token);
    await first.next();

    const second = await phoneStream(d.token);
    await second.next();

    expect((await deviceRow(d.deviceId)).connected).toBe(true);
    second.close();
    first.close();
  });
});

describe('POST /api/v1/unpair (the phone unpairs itself)', () => {
  it('needs a device token', async () => {
    expect((await request(ctx.app).post('/api/v1/unpair')).status).toBe(401);
  });

  it('revokes the phone, tells open dashboards at once and writes an audit entry', async () => {
    const d = await ctx.addDevice();
    const viewer = await dashboardStream();
    await viewer.next();

    const res = await request(ctx.app).post('/api/v1/unpair').set('Authorization', `Bearer ${d.token}`);

    expect(res.status).toBe(204);
    const event = await nextOfType(viewer, 'device');
    expect(event.data).toMatchObject({ deviceId: d.deviceId, revokedAt: expect.any(String) });
    expect((await request(ctx.app).post('/api/v1/heartbeat').set('Authorization', `Bearer ${d.token}`)).status).toBe(401);
    const { rows } = await ctx.pool.query("SELECT event FROM audit_log WHERE device_id = $1 AND event = 'unpair'", [d.deviceId]);
    expect(rows).toHaveLength(1);
    viewer.close();
  });
});
