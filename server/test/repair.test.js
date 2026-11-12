import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildTestApp, ADMIN, msg } from './helpers/app.js';
import { openStream } from './helpers/sse.js';
import { ensureAdminUser } from '../src/auth/users.js';

let ctx;
let agent;
let csrf;
let cookie;
beforeAll(async () => {
  ctx = await buildTestApp({ realAuth: true, pairRateLimit: { limit: 1000, windowMs: 60000 } });
  await ensureAdminUser(ctx.pool, ADMIN);
  agent = request.agent(ctx.app);
  const res = await agent.post('/api/v1/auth/login').send(ADMIN);
  csrf = res.body.csrfToken;
  cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
});
afterAll(() => ctx.pool.end());

const newCode = async () => (await agent.post('/api/v1/pairing-codes').set('X-CSRF-Token', csrf)).body.code;
const pair = async (body) => request(ctx.app).post('/api/v1/pair').send({ code: await newCode(), ...body });
const send = (token, messages) =>
  request(ctx.app).post('/api/v1/messages').set('Authorization', `Bearer ${token}`).send({ messages });
const count = async (where = 'true', params = []) =>
  (await ctx.pool.query(`SELECT count(*)::int AS n FROM devices WHERE ${where}`, params)).rows[0].n;

describe('pairing the same phone again', () => {
  it('stores the hardware id when a phone pairs', async () => {
    const res = await pair({ name: 'Phone', hardwareId: 'hw-store' });
    expect(res.status).toBe(201);
    const { rows } = await ctx.pool.query('SELECT hardware_id FROM devices WHERE device_id = $1', [res.body.deviceId]);
    expect(rows[0].hardware_id).toBe('hw-store');
  });

  it('reuses the existing device, keeping its name, and issues a new token', async () => {
    const first = await pair({ name: 'Kitchen phone', model: 'A', appVersion: '0.1.0', hardwareId: 'hw-reuse' });
    await agent.patch(`/api/v1/devices/${first.body.deviceId}`).set('X-CSRF-Token', csrf).send({ name: 'Renamed by me' });

    const second = await pair({ name: 'OnePlus HD1913', model: 'B', appVersion: '0.2.0', hardwareId: 'hw-reuse' });

    expect(second.status).toBe(201);
    expect(second.body.deviceId).toBe(first.body.deviceId);
    expect(second.body.token).not.toBe(first.body.token);
    expect(await count('hardware_id = $1', ['hw-reuse'])).toBe(1);
    const { rows } = await ctx.pool.query('SELECT name, model, app_version FROM devices WHERE hardware_id = $1', ['hw-reuse']);
    expect(rows[0]).toEqual({ name: 'Renamed by me', model: 'B', app_version: '0.2.0' });
  });

  it('kills the old token and accepts the new one', async () => {
    const first = await pair({ name: 'Phone', hardwareId: 'hw-token' });
    const second = await pair({ name: 'Phone', hardwareId: 'hw-token' });

    expect((await send(first.body.token, [msg()])).status).toBe(401);
    expect((await send(second.body.token, [msg()])).status).toBe(201);
  });

  it('keeps the messages the phone already sent', async () => {
    const first = await pair({ name: 'Phone', hardwareId: 'hw-history' });
    await send(first.body.token, [msg({ body: 'before re-pairing' })]);

    const second = await pair({ name: 'Phone', hardwareId: 'hw-history' });
    await send(second.body.token, [msg({ body: 'after re-pairing', receivedAt: '2026-11-11T11:00:00Z' })]);

    const { body } = await agent.get(`/api/v1/messages?device=${first.body.deviceId}`);
    expect(body.messages.map((m) => m.body).sort()).toEqual(['after re-pairing', 'before re-pairing']);
  });

  it('brings a revoked phone back when it is paired again', async () => {
    const first = await pair({ name: 'Phone', hardwareId: 'hw-revoked' });
    await agent.delete(`/api/v1/devices/${first.body.deviceId}`).set('X-CSRF-Token', csrf);
    expect((await send(first.body.token, [msg()])).status).toBe(401);

    const second = await pair({ name: 'Phone', hardwareId: 'hw-revoked' });

    expect(second.body.deviceId).toBe(first.body.deviceId);
    const { rows } = await ctx.pool.query('SELECT revoked_at FROM devices WHERE device_id = $1', [first.body.deviceId]);
    expect(rows[0].revoked_at).toBeNull();
    expect((await send(second.body.token, [msg()])).status).toBe(201);
  });

  it('treats different hardware ids, and phones without one, as different phones', async () => {
    const a = await pair({ name: 'A', hardwareId: 'hw-a' });
    const b = await pair({ name: 'B', hardwareId: 'hw-b' });
    const old1 = await pair({ name: 'Old app' });
    const old2 = await pair({ name: 'Old app' });

    expect(new Set([a.body.deviceId, b.body.deviceId, old1.body.deviceId, old2.body.deviceId]).size).toBe(4);
  });

  it('lets only one of two simultaneous pairings create the device', async () => {
    const [c1, c2] = [await newCode(), await newCode()];
    const attempt = (code) => request(ctx.app).post('/api/v1/pair').send({ code, name: 'Race', hardwareId: 'hw-race' });

    const results = await Promise.all([attempt(c1), attempt(c2)]);

    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(await count('hardware_id = $1', ['hw-race'])).toBe(1);
  });

  it('audits a re-pairing as repair and a first pairing as pair', async () => {
    const first = await pair({ name: 'Phone', hardwareId: 'hw-audit' });
    await pair({ name: 'Phone', hardwareId: 'hw-audit' });

    const { rows } = await ctx.pool.query('SELECT event FROM audit_log WHERE device_id = $1 ORDER BY id', [first.body.deviceId]);
    expect(rows.map((r) => r.event)).toEqual(['pair', 'repair']);
  });

  it('pushes the reused device to the dashboard', async () => {
    const first = await pair({ name: 'Phone', hardwareId: 'hw-push' });
    const stream = await openStream(ctx.app, { cookie });
    await stream.next();

    await pair({ name: 'Phone', hardwareId: 'hw-push' });

    const event = await stream.next();
    expect(event.event).toBe('device');
    expect(event.data).toMatchObject({ deviceId: first.body.deviceId, revokedAt: null });
    stream.close();
  });

  it('rejects an oversized or empty hardware id', async () => {
    expect((await pair({ name: 'Phone', hardwareId: 'x'.repeat(101) })).status).toBe(400);
    expect((await pair({ name: 'Phone', hardwareId: '' })).status).toBe(400);
  });
});
