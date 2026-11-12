import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './helpers/app.js';

let ctx;
beforeAll(async () => {
  ctx = await buildTestApp();
});
afterAll(() => ctx.pool.end());

const beat = (token, headers = {}) =>
  request(ctx.app).post('/api/v1/heartbeat').set(token ? { Authorization: `Bearer ${token}` } : {}).set(headers);

describe('POST /api/v1/heartbeat', () => {
  it('needs a device token and refuses a revoked phone', async () => {
    const revoked = await ctx.addDevice({ revoked: true });

    expect((await beat(null)).status).toBe(401);
    expect((await beat('wrong-token')).status).toBe(401);
    expect((await beat(revoked.token)).status).toBe(401);
  });

  it('marks the phone as seen and records its app version, without needing a message', async () => {
    const d = await ctx.addDevice();
    await ctx.pool.query("UPDATE devices SET last_seen = now() - interval '5 hours' WHERE device_id = $1", [d.deviceId]);

    const res = await beat(d.token, { 'X-App-Version': '0.1.77' });

    expect(res.status).toBe(204);
    const { rows } = await ctx.pool.query(
      "SELECT app_version, last_seen > now() - interval '1 minute' AS fresh FROM devices WHERE device_id = $1",
      [d.deviceId],
    );
    expect(rows[0]).toEqual({ app_version: '0.1.77', fresh: true });
    const messages = await ctx.pool.query('SELECT 1 FROM messages WHERE device_id = $1', [d.deviceId]);
    expect(messages.rowCount).toBe(0);
  });
});
