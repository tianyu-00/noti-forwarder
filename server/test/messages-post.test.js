import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildTestApp, msg } from './helpers/app.js';

let ctx;
beforeAll(async () => {
  ctx = await buildTestApp();
});
afterAll(() => ctx.pool.end());

describe('POST /api/v1/messages auth', () => {
  it('rejects requests without a device token', async () => {
    const res = await request(ctx.app).post('/api/v1/messages').send({ messages: [msg()] });
    expect(res.status).toBe(401);
  });

  it('rejects an unknown token', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/messages')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ messages: [msg()] });
    expect(res.status).toBe(401);
  });

  it('rejects a revoked device', async () => {
    const { token } = await ctx.addDevice({ revoked: true });
    const res = await request(ctx.app)
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ messages: [msg()] });
    expect(res.status).toBe(401);
  });

  it('accepts a valid token, records last_seen and the app version', async () => {
    const { token, deviceId } = await ctx.addDevice();
    const res = await request(ctx.app)
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${token}`)
      .set('X-App-Version', '0.3.1')
      .send({ messages: [] });
    expect(res.status).not.toBe(401);
    const { rows } = await ctx.pool.query('SELECT last_seen, app_version FROM devices WHERE device_id=$1', [deviceId]);
    expect(rows[0].last_seen).not.toBeNull();
    expect(rows[0].app_version).toBe('0.3.1');
  });
});
