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

  it('drops the same notification delivered twice: new id, same content, same phone timestamp', async () => {
    const { token, deviceId } = await ctx.addDevice();

    await post(token, { messages: [msg({ body: 'delivered twice' })] });
    const res = await post(token, { messages: [msg({ body: 'delivered twice' })] }); // same default timestamp

    expect(res.body).toEqual({ stored: 0, duplicates: 1 });
    const { rowCount } = await ctx.pool.query('SELECT 1 FROM messages WHERE device_id=$1', [deviceId]);
    expect(rowCount).toBe(1);
  });

  it('keeps a repeat of the same text that arrives later, even within the same minute', async () => {
    const { token, deviceId } = await ctx.addDevice();

    await post(token, { messages: [msg({ body: 'Your code is 123456' })] });
    const second = await post(token, {
      messages: [msg({ body: 'Your code is 123456', receivedAt: '2026-11-11T10:00:40Z' })],
    });

    expect(second.body).toEqual({ stored: 1, duplicates: 0 });
    const { rowCount } = await ctx.pool.query('SELECT 1 FROM messages WHERE device_id=$1', [deviceId]);
    expect(rowCount).toBe(2);
  });
});

describe('POST /api/v1/messages validation', () => {
  const cases = {
    'missing messages array': {},
    'messages is not an array': { messages: 'nope' },
    'non-uuid id': { messages: [msg({ id: 'abc' })] },
    'unknown type': { messages: [msg({ type: 'email' })] },
    'missing body': { messages: [{ ...msg(), body: undefined }] },
    'non-string body': { messages: [msg({ body: 42 })] },
    'invalid receivedAt': { messages: [msg({ receivedAt: 'yesterday' })] },
    'oversized body': { messages: [msg({ body: 'x'.repeat(20001) })] },
    'too many messages': { messages: Array.from({ length: 501 }, () => msg()) },
  };

  for (const [name, payload] of Object.entries(cases)) {
    it(`returns 400 for ${name} and stores nothing`, async () => {
      const { token, deviceId } = await ctx.addDevice();
      const res = await post(token, payload);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_payload');
      const { rowCount } = await ctx.pool.query('SELECT 1 FROM messages WHERE device_id=$1', [deviceId]);
      expect(rowCount).toBe(0);
    });
  }

  it('returns 400 for malformed JSON', async () => {
    const { token } = await ctx.addDevice();
    const res = await request(ctx.app)
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send('{not json');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/messages size limits', () => {
  it('accepts a large but legitimate batch', async () => {
    const { token } = await ctx.addDevice();
    const messages = Array.from({ length: 100 }, (_, i) => msg({ body: `${i} ${'y'.repeat(5000)}` }));
    const res = await post(token, { messages });
    expect(res.status).toBe(201);
    expect(res.body.stored).toBe(100);
  });

  it('rejects a body over 2 MB with 413', async () => {
    const { token } = await ctx.addDevice();
    const res = await post(token, { messages: [msg({ body: 'z'.repeat(2.5 * 1024 * 1024) })] });
    expect(res.status).toBe(413);
  });
});

describe('POST /api/v1/messages rate limiting', () => {
  it('returns 429 once a device exceeds its limit, without affecting other devices', async () => {
    const limited = await buildTestApp({ messageRateLimit: { limit: 2, windowMs: 60000 } });
    const d1 = await limited.addDevice();
    const d2 = await limited.addDevice();
    const send = (token) =>
      request(limited.app).post('/api/v1/messages').set('Authorization', `Bearer ${token}`).send({ messages: [] });

    expect((await send(d1.token)).status).toBe(201);
    expect((await send(d1.token)).status).toBe(201);
    expect((await send(d1.token)).status).toBe(429);
    expect((await send(d2.token)).status).toBe(201);
    await limited.pool.end();
  });
});

describe('POST /api/v1/messages before authentication', () => {
  it('limits bad-token attempts per IP so guessing cannot flood the database', async () => {
    const local = await buildTestApp({ preAuthRateLimit: { limit: 3, windowMs: 60000 } });
    const attempt = () =>
      request(local.app).post('/api/v1/messages').set('Authorization', 'Bearer nope').send({ messages: [] });
    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    await local.pool.end();
  });
});
