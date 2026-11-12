import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { buildTestApp, ADMIN, msg } from './helpers/app.js';
import { ensureAdminUser } from '../src/auth/users.js';
import { purgeOldMessages } from '../src/retention.js';

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
beforeEach(async () => {
  await ctx.pool.query("DELETE FROM settings WHERE key = 'retention_days'");
  await ctx.pool.query('DELETE FROM messages');
});

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const put = (body, token = csrf) => agent.put('/api/v1/settings').set('X-CSRF-Token', token).send(body);

async function addMessage(deviceId, receivedAt) {
  const m = msg({ receivedAt });
  await ctx.pool.query(
    `INSERT INTO messages (id, device_id, type, app, sender, body, received_at, dedupe_hash)
     VALUES ($1, $2, 'notification', 'x', 'y', 'b', $3, $4)`,
    [m.id, deviceId, receivedAt, m.id],
  );
  return m.id;
}

describe('GET /api/v1/settings', () => {
  it('needs a session', async () => {
    expect((await request(ctx.app).get('/api/v1/settings')).status).toBe(401);
  });

  it('keeps messages forever until a limit is set', async () => {
    const res = await agent.get('/api/v1/settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ retentionDays: null });
  });
});

describe('PUT /api/v1/settings', () => {
  it('needs a session and a CSRF token', async () => {
    expect((await request(ctx.app).put('/api/v1/settings').send({ retentionDays: 30 })).status).toBe(401);
    expect((await agent.put('/api/v1/settings').send({ retentionDays: 30 })).status).toBe(403);
  });

  it.each([0, -5, 1.5, '30', 3651, undefined])('rejects retentionDays %s', async (value) => {
    expect((await put({ retentionDays: value })).status).toBe(400);
  });

  it('stores the limit, returns it and writes an audit entry', async () => {
    const res = await put({ retentionDays: 90 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ retentionDays: 90, purged: 0 });
    expect((await agent.get('/api/v1/settings')).body).toEqual({ retentionDays: 90 });
    const { rows } = await ctx.pool.query("SELECT actor FROM audit_log WHERE event = 'settings' ORDER BY id DESC LIMIT 1");
    expect(rows).toEqual([{ actor: 'admin' }]);
  });

  it('accepts null to keep everything again', async () => {
    await put({ retentionDays: 30 });
    expect((await put({ retentionDays: null })).body).toEqual({ retentionDays: null, purged: 0 });
    expect((await agent.get('/api/v1/settings')).body).toEqual({ retentionDays: null });
  });

  it('deletes messages older than the limit as soon as it is saved, and reports how many', async () => {
    const d = await ctx.addDevice();
    await addMessage(d.deviceId, daysAgo(40));
    await addMessage(d.deviceId, daysAgo(31));
    const recent = await addMessage(d.deviceId, daysAgo(5));

    const res = await put({ retentionDays: 30 });

    expect(res.body).toEqual({ retentionDays: 30, purged: 2 });
    const { rows } = await ctx.pool.query('SELECT id FROM messages');
    expect(rows).toEqual([{ id: recent }]);
  });
});

describe('purgeOldMessages', () => {
  it('does nothing while no limit is set', async () => {
    const d = await ctx.addDevice();
    await addMessage(d.deviceId, daysAgo(4000));
    expect(await purgeOldMessages(ctx.pool)).toBe(0);
    expect((await ctx.pool.query('SELECT 1 FROM messages')).rowCount).toBe(1);
  });

  it('applies the stored limit', async () => {
    const d = await ctx.addDevice();
    await ctx.pool.query("INSERT INTO settings (key, value) VALUES ('retention_days', '7')");
    await addMessage(d.deviceId, daysAgo(8));
    await addMessage(d.deviceId, daysAgo(2));
    expect(await purgeOldMessages(ctx.pool)).toBe(1);
  });
});
