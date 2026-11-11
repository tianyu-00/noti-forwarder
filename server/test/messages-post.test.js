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

async function post(token, body) {
  return request(ctx.app).post('/api/v1/messages').set('Authorization', `Bearer ${token}`).send(body);
}

describe('POST /api/v1/messages storing', () => {
  it('stores a valid batch under the authenticated device', async () => {
    const { token, deviceId } = await ctx.addDevice();
    const a = msg({ body: 'one' });
    const b = msg({ body: 'two', type: 'sms', app: 'sms' });

    const res = await post(token, { messages: [a, b] });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ stored: 2, duplicates: 0 });
    const { rows } = await ctx.pool.query('SELECT * FROM messages WHERE device_id=$1 ORDER BY body', [deviceId]);
    expect(rows.map((r) => r.body)).toEqual(['one', 'two']);
    expect(rows[1].type).toBe('sms');
    expect(rows[0].created_at).toBeInstanceOf(Date);
  });

  it('is idempotent when the phone retries the same ids', async () => {
    const { token, deviceId } = await ctx.addDevice();
    const batch = { messages: [msg({ body: 'retry me' })] };

    const first = await post(token, batch);
    const second = await post(token, batch);

    expect(first.body).toEqual({ stored: 1, duplicates: 0 });
    expect(second.status).toBe(201);
    expect(second.body).toEqual({ stored: 0, duplicates: 1 });
    const { rowCount } = await ctx.pool.query('SELECT 1 FROM messages WHERE device_id=$1', [deviceId]);
    expect(rowCount).toBe(1);
  });

  it('drops a repeat with a new id but the same content in the same minute', async () => {
    const { token, deviceId } = await ctx.addDevice();

    await post(token, { messages: [msg({ body: 'sms copy' })] });
    const res = await post(token, { messages: [msg({ body: 'sms copy', receivedAt: '2026-11-11T10:00:40Z' })] });

    expect(res.body).toEqual({ stored: 0, duplicates: 1 });
    const { rowCount } = await ctx.pool.query('SELECT 1 FROM messages WHERE device_id=$1', [deviceId]);
    expect(rowCount).toBe(1);
  });
});
