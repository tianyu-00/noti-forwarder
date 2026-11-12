import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildTestApp, msg } from './helpers/app.js';

const calls = [];
let behaviour = async () => ({ sent: 1, failed: 0 });
const notifier = {
  notify: (messages, deviceName) => {
    calls.push({ messages, deviceName });
    return behaviour(messages, deviceName);
  },
};

let ctx;
beforeAll(async () => {
  ctx = await buildTestApp({ notifier });
});
afterAll(() => ctx.pool.end());

const post = (token, messages) =>
  request(ctx.app).post('/api/v1/messages').set('Authorization', `Bearer ${token}`).send({ messages });

describe('push notifications on stored messages', () => {
  it('hands newly stored messages to the notifier, with the phone name and the 2FA code', async () => {
    calls.length = 0;
    const { token, deviceId } = await ctx.addDevice();

    await post(token, [msg({ body: 'Your code is 482913' })]);

    expect(calls).toHaveLength(1);
    expect(calls[0].deviceName).toBe('Test phone');
    expect(calls[0].messages).toHaveLength(1);
    expect(calls[0].messages[0]).toMatchObject({ deviceId, body: 'Your code is 482913', code: '482913' });
  });

  it('does not push duplicates, so a retry or a repeated delivery never alerts twice', async () => {
    calls.length = 0;
    const { token } = await ctx.addDevice();
    const m = msg({ body: 'once only' });

    await post(token, [m]);
    await post(token, [m]); // retry with the same id

    expect(calls).toHaveLength(1);
  });

  it('pushes only the new messages from a batch that also holds a duplicate', async () => {
    calls.length = 0;
    const { token } = await ctx.addDevice();
    const old = msg({ body: 'already stored' });
    await post(token, [old]);
    calls.length = 0;

    await post(token, [old, msg({ body: 'brand new' })]);

    expect(calls).toHaveLength(1);
    expect(calls[0].messages.map((m) => m.body)).toEqual(['brand new']);
  });

  it('does not push for an invalid payload or an empty batch', async () => {
    calls.length = 0;
    const { token } = await ctx.addDevice();

    await post(token, [{ ...msg(), body: undefined }]);
    await post(token, []);

    expect(calls).toHaveLength(0);
  });

  it('a failing notifier never changes what the phone is told', async () => {
    const { token, deviceId } = await ctx.addDevice();
    for (const failing of [
      async () => {
        throw new Error('ntfy exploded');
      },
      () => {
        throw new Error('synchronous failure');
      },
    ]) {
      behaviour = failing;
      const res = await post(token, [msg({ body: `survives ${Math.random()}` })]);
      expect(res.status).toBe(201);
      expect(res.body.stored).toBe(1);
    }
    behaviour = async () => ({ sent: 1, failed: 0 });
    const { rowCount } = await ctx.pool.query('SELECT 1 FROM messages WHERE device_id = $1', [deviceId]);
    expect(rowCount).toBe(2);
  });

  it('does not make the phone wait for a slow notifier', async () => {
    const { token } = await ctx.addDevice();
    behaviour = () => new Promise(() => {}); // never answers
    const started = Date.now();

    const res = await post(token, [msg({ body: 'hurry' })]);

    behaviour = async () => ({ sent: 1, failed: 0 });
    expect(res.status).toBe(201);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

describe('without a notifier', () => {
  it('stores messages exactly as before', async () => {
    const plain = await buildTestApp();
    const { token } = await plain.addDevice();

    const res = await request(plain.app)
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ messages: [msg()] });

    expect(res.body).toEqual({ stored: 1, duplicates: 0 });
    await plain.pool.end();
  });
});
