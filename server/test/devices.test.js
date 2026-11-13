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
      connected: false,
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

describe('DELETE /api/v1/devices/:id/permanent (erase)', () => {
  const erase = (id, token = csrf) => agent.delete(`/api/v1/devices/${id}/permanent`).set('X-CSRF-Token', token);
  const revoke = (id) => agent.delete(`/api/v1/devices/${id}`).set('X-CSRF-Token', csrf);

  it('needs a session and a CSRF token', async () => {
    const d = await ctx.addDevice({ revoked: true });
    expect((await request(ctx.app).delete(`/api/v1/devices/${d.deviceId}/permanent`)).status).toBe(401);
    expect((await agent.delete(`/api/v1/devices/${d.deviceId}/permanent`)).status).toBe(403);
  });

  it('erases a revoked phone and its messages, and leaves other phones alone', async () => {
    const gone = await ctx.addDevice();
    const kept = await ctx.addDevice();
    await send(gone.token, [msg()]);
    await send(kept.token, [msg()]);
    await revoke(gone.deviceId);

    expect((await erase(gone.deviceId)).status).toBe(204);

    const list = await agent.get('/api/v1/devices');
    expect(list.body.devices.some((x) => x.deviceId === gone.deviceId)).toBe(false);
    const rows = await ctx.pool.query('SELECT device_id FROM messages WHERE device_id IN (SELECT value FROM json_each($1))', [
      JSON.stringify([gone.deviceId, kept.deviceId]),
    ]);
    expect(rows.rows).toEqual([{ device_id: kept.deviceId }]);
  });

  it('refuses to erase a phone that is still active', async () => {
    const d = await ctx.addDevice();
    await send(d.token, [msg()]);
    expect((await erase(d.deviceId)).status).toBe(409);
    const { rows } = await ctx.pool.query('SELECT 1 FROM messages WHERE device_id = $1', [d.deviceId]);
    expect(rows).toHaveLength(1);
  });

  it('404s for an unknown phone and writes an audit entry when it erases', async () => {
    expect((await erase('nope')).status).toBe(404);
    const d = await ctx.addDevice({ revoked: true });
    await erase(d.deviceId);
    const { rows } = await ctx.pool.query(
      "SELECT actor FROM audit_log WHERE event = 'erase' AND device_id = $1",
      [d.deviceId],
    );
    expect(rows).toEqual([{ actor: 'admin' }]);
  });
});

describe('DELETE /api/v1/devices/:id/messages (clear messages, phone stays)', () => {
  const clear = (id, token = csrf) => agent.delete(`/api/v1/devices/${id}/messages`).set('X-CSRF-Token', token);

  it('needs a session and a CSRF token', async () => {
    const d = await ctx.addDevice();
    expect((await request(ctx.app).delete(`/api/v1/devices/${d.deviceId}/messages`)).status).toBe(401);
    expect((await agent.delete(`/api/v1/devices/${d.deviceId}/messages`)).status).toBe(403);
  });

  it('deletes an active phone\'s messages without revoking it, and leaves other phones alone', async () => {
    const cleared = await ctx.addDevice();
    const other = await ctx.addDevice();
    await send(cleared.token, [msg({ body: 'first' }), msg({ body: 'second' })]);
    await send(other.token, [msg()]);

    const res = await clear(cleared.deviceId);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 2 });
    const rows = await ctx.pool.query('SELECT device_id FROM messages WHERE device_id IN (SELECT value FROM json_each($1))', [
      JSON.stringify([cleared.deviceId, other.deviceId]),
    ]);
    expect(rows.rows).toEqual([{ device_id: other.deviceId }]);
    // Still paired and still sending.
    const list = await agent.get('/api/v1/devices');
    expect(list.body.devices.find((x) => x.deviceId === cleared.deviceId).revokedAt).toBeNull();
    expect((await send(cleared.token, [msg()])).status).toBe(201);
  });

  it('works on a phone with no messages, 404s for an unknown phone and writes an audit entry', async () => {
    const d = await ctx.addDevice();
    expect((await clear(d.deviceId)).body).toEqual({ deleted: 0 });
    expect((await clear('nope')).status).toBe(404);
    const { rows } = await ctx.pool.query(
      "SELECT actor FROM audit_log WHERE event = 'clear_messages' AND device_id = $1",
      [d.deviceId],
    );
    expect(rows).toEqual([{ actor: 'admin' }]);
  });
});

describe('DELETE /api/v1/messages (clear every phone\'s messages)', () => {
  const clearAll = (token = csrf) => agent.delete('/api/v1/messages').set('X-CSRF-Token', token);

  it('needs a session and a CSRF token', async () => {
    expect((await request(ctx.app).delete('/api/v1/messages')).status).toBe(401);
    expect((await agent.delete('/api/v1/messages')).status).toBe(403);
  });

  it('deletes all messages of all phones, keeps the phones paired and writes an audit entry', async () => {
    const a = await ctx.addDevice();
    const b = await ctx.addDevice();
    await send(a.token, [msg({ body: 'one' }), msg({ body: 'two' })]);
    await send(b.token, [msg({ body: 'three' })]);
    const before = (await ctx.pool.query('SELECT count(*) AS n FROM messages')).rows[0].n;

    const res = await clearAll();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: before });
    expect((await ctx.pool.query('SELECT count(*) AS n FROM messages')).rows[0].n).toBe(0);
    const list = await agent.get('/api/v1/devices');
    expect(list.body.devices.find((x) => x.deviceId === a.deviceId).revokedAt).toBeNull();
    expect((await send(b.token, [msg()])).status).toBe(201);
    const { rows } = await ctx.pool.query("SELECT actor, device_id FROM audit_log WHERE event = 'clear_all_messages'");
    expect(rows).toEqual([{ actor: ADMIN.username, device_id: null }]);
  });
});
