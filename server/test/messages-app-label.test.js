import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildTestApp, msg } from './helpers/app.js';

let ctx;
beforeAll(async () => {
  ctx = await buildTestApp();
});
afterAll(() => ctx.pool.end());

const send = (token, messages) =>
  request(ctx.app).post('/api/v1/messages').set('Authorization', `Bearer ${token}`).send({ messages });
const list = (deviceId) => request(ctx.app).get(`/api/v1/messages?device=${deviceId}`);

// The phone knows an app's real name (Gmail); the server only gets "com.google.android.gm".
// The name rides along as an optional field so phones that do not send it keep working.
describe('app label', () => {
  it('stores the name the phone sends and returns it as appLabel', async () => {
    const d = await ctx.addDevice();

    const res = await send(d.token, [msg({ app: 'com.google.android.gm', appLabel: 'Gmail' })]);

    expect(res.status).toBe(201);
    const { body } = await list(d.deviceId);
    expect(body.messages[0].app).toBe('com.google.android.gm');
    expect(body.messages[0].appLabel).toBe('Gmail');
  });

  it('is null for a message from a phone that sends no name', async () => {
    const d = await ctx.addDevice();

    await send(d.token, [msg()]);

    const { body } = await list(d.deviceId);
    expect(body.messages[0].appLabel).toBeNull();
  });

  it('finds a message when searching for the app\'s real name', async () => {
    const d = await ctx.addDevice();
    await send(d.token, [
      msg({ app: 'com.google.android.gm', appLabel: 'Gmail', body: 'Run failed' }),
      msg({ app: 'com.other', appLabel: 'Weather', body: 'Rain later' }),
    ]);

    const { body } = await request(ctx.app).get(`/api/v1/messages?device=${d.deviceId}&q=gmail`);

    expect(body.messages.map((m) => m.app)).toEqual(['com.google.android.gm']);
  });

  it('refuses a name that is far too long', async () => {
    const d = await ctx.addDevice();

    const res = await send(d.token, [msg({ appLabel: 'x'.repeat(300) })]);

    expect(res.status).toBe(400);
  });

  it('does not change what counts as a duplicate', async () => {
    const d = await ctx.addDevice();
    const first = msg({ body: 'same', receivedAt: '2026-11-11T10:00:00.000Z' });

    await send(d.token, [first]);
    const again = await send(d.token, [{ ...first, id: crypto.randomUUID(), appLabel: 'Late name' }]);

    expect(again.body).toEqual({ stored: 0, duplicates: 1 });
  });
});
