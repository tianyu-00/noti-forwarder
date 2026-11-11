import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildTestApp, msg } from './helpers/app.js';
import { createApp } from '../src/app.js';

let ctx;
let dev;
beforeAll(async () => {
  ctx = await buildTestApp();
  dev = await ctx.addDevice();
});
afterAll(() => ctx.pool.end());

const send = (token, messages) =>
  request(ctx.app).post('/api/v1/messages').set('Authorization', `Bearer ${token}`).send({ messages });
const get = (query = '') => request(ctx.app).get(`/api/v1/messages${query}`);

describe('GET /api/v1/messages', () => {
  it('denies access unless a viewer guard allows it', async () => {
    const locked = createApp({ db: ctx.pool });
    const res = await request(locked).get('/api/v1/messages');
    expect(res.status).toBe(401);
  });

  it('lists messages newest first with the camelCase shape', async () => {
    const d = await ctx.addDevice();
    await send(d.token, [
      msg({ body: 'oldest', receivedAt: '2026-01-01T10:00:00Z' }),
      msg({ body: 'newest', receivedAt: '2026-01-03T10:00:00Z' }),
      msg({ body: 'middle', receivedAt: '2026-01-02T10:00:00Z' }),
    ]);

    const res = await get(`?device=${d.deviceId}`);

    expect(res.status).toBe(200);
    expect(res.body.messages.map((m) => m.body)).toEqual(['newest', 'middle', 'oldest']);
    expect(res.body.messages[0]).toEqual({
      id: expect.any(String),
      deviceId: d.deviceId,
      type: 'notification',
      app: 'com.bank',
      sender: 'Bank',
      body: 'newest',
      receivedAt: '2026-01-03T10:00:00.000Z',
      createdAt: expect.any(String),
    });
  });
});
