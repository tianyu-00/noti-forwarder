import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildTestApp, ADMIN, msg } from './helpers/app.js';
import { ensureAdminUser } from '../src/auth/users.js';

let ctx;
let agent;
let csrf;
beforeAll(async () => {
  ctx = await buildTestApp({ realAuth: true });
  await ensureAdminUser(ctx.pool, ADMIN);
  agent = request.agent(ctx.app);
  csrf = (await agent.post('/api/v1/auth/login').send(ADMIN)).body.csrfToken;
});
afterAll(() => ctx.pool.end());

const send = (token, messages) =>
  request(ctx.app).post('/api/v1/messages').set('Authorization', `Bearer ${token}`).send({ messages });

describe('GET /api/v1/devices', () => {
  it('needs a session', async () => {
    expect((await request(ctx.app).get('/api/v1/devices')).status).toBe(401);
  });

  it('lists devices without exposing token hashes', async () => {
    const d = await ctx.addDevice();
    await send(d.token, []);

    const res = await agent.get('/api/v1/devices');

    expect(res.status).toBe(200);
    const found = res.body.devices.find((x) => x.deviceId === d.deviceId);
    expect(found).toEqual({
      deviceId: d.deviceId,
      name: 'Test phone',
      model: null,
      appVersion: null,
      pairedAt: expect.any(String),
      lastSeen: expect.any(String),
      revokedAt: null,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/token/i);
  });
});

describe('PATCH /api/v1/devices/:id', () => {
  it('renames a device, with a CSRF token', async () => {
    const d = await ctx.addDevice();
    const url = `/api/v1/devices/${d.deviceId}`;

    expect((await agent.patch(url).send({ name: 'Kitchen phone' })).status).toBe(403);

    const res = await agent.patch(url).set('X-CSRF-Token', csrf).send({ name: 'Kitchen phone' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Kitchen phone');
  });

  it('validates the name and 404s for unknown devices', async () => {
    const d = await ctx.addDevice();
    const bad = await agent.patch(`/api/v1/devices/${d.deviceId}`).set('X-CSRF-Token', csrf).send({ name: '' });
    expect(bad.status).toBe(400);

    const missing = await agent.patch('/api/v1/devices/nope').set('X-CSRF-Token', csrf).send({ name: 'x' });
    expect(missing.status).toBe(404);
  });
});

describe('DELETE /api/v1/devices/:id (revoke)', () => {
  it('needs a session and a CSRF token', async () => {
    const d = await ctx.addDevice();
    expect((await request(ctx.app).delete(`/api/v1/devices/${d.deviceId}`)).status).toBe(401);
    expect((await agent.delete(`/api/v1/devices/${d.deviceId}`)).status).toBe(403);
  });

  it('invalidates the token so the phone gets 401, and keeps its old messages', async () => {
    const d = await ctx.addDevice();
    await send(d.token, [msg({ body: 'keep me' })]);

    const res = await agent.delete(`/api/v1/devices/${d.deviceId}`).set('X-CSRF-Token', csrf);

    expect(res.status).toBe(204);
    expect((await send(d.token, [msg()])).status).toBe(401);
    const { rows } = await ctx.pool.query('SELECT body FROM messages WHERE device_id = $1', [d.deviceId]);
    expect(rows.map((r) => r.body)).toEqual(['keep me']);
    const list = await agent.get('/api/v1/devices');
    expect(list.body.devices.find((x) => x.deviceId === d.deviceId).revokedAt).toEqual(expect.any(String));
  });

  it('is idempotent, 404s for unknown devices and writes an audit entry', async () => {
    const d = await ctx.addDevice();
    const url = `/api/v1/devices/${d.deviceId}`;
    expect((await agent.delete(url).set('X-CSRF-Token', csrf)).status).toBe(204);
    expect((await agent.delete(url).set('X-CSRF-Token', csrf)).status).toBe(204);
    expect((await agent.delete('/api/v1/devices/nope').set('X-CSRF-Token', csrf)).status).toBe(404);

    const { rows } = await ctx.pool.query("SELECT actor FROM audit_log WHERE event = 'revoke' AND device_id = $1", [
      d.deviceId,
    ]);
    expect(rows).toEqual([{ actor: 'admin' }]);
  });
});
