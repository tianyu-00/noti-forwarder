import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildTestApp, msg } from './helpers/app.js';
import { createApp } from '../src/app.js';

let ctx;
beforeAll(async () => {
  ctx = await buildTestApp();
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

describe('GET /api/v1/messages pagination', () => {
  it('pages with limit and the before cursor until exhausted', async () => {
    const d = await ctx.addDevice();
    await send(
      d.token,
      [1, 2, 3, 4, 5].map((n) => msg({ body: `m${n}`, receivedAt: `2026-02-0${n}T10:00:00Z` })),
    );

    const p1 = await get(`?device=${d.deviceId}&limit=2`);
    expect(p1.body.messages.map((m) => m.body)).toEqual(['m5', 'm4']);
    expect(p1.body.nextBefore).toEqual(expect.any(String));

    const p2 = await get(`?device=${d.deviceId}&limit=2&before=${encodeURIComponent(p1.body.nextBefore)}`);
    expect(p2.body.messages.map((m) => m.body)).toEqual(['m3', 'm2']);

    const p3 = await get(`?device=${d.deviceId}&limit=2&before=${encodeURIComponent(p2.body.nextBefore)}`);
    expect(p3.body.messages.map((m) => m.body)).toEqual(['m1']);
    expect(p3.body.nextBefore).toBeNull();
  });

  it('does not skip or repeat messages that share a received time', async () => {
    const d = await ctx.addDevice();
    await send(d.token, ['a', 'b', 'c'].map((b) => msg({ body: b, receivedAt: '2026-03-01T10:00:00Z' })));

    const p1 = await get(`?device=${d.deviceId}&limit=2`);
    const p2 = await get(`?device=${d.deviceId}&limit=2&before=${encodeURIComponent(p1.body.nextBefore)}`);

    const seen = [...p1.body.messages, ...p2.body.messages].map((m) => m.body).sort();
    expect(seen).toEqual(['a', 'b', 'c']);
  });
});

describe('GET /api/v1/messages filters', () => {
  it('filters by device, so other phones are hidden', async () => {
    const a = await ctx.addDevice();
    const b = await ctx.addDevice();
    await send(a.token, [msg({ body: 'from a' })]);
    await send(b.token, [msg({ body: 'from b' })]);

    const res = await get(`?device=${b.deviceId}`);
    expect(res.body.messages.map((m) => m.body)).toEqual(['from b']);
  });

  it('filters by type and by app', async () => {
    const d = await ctx.addDevice();
    await send(d.token, [
      msg({ body: 'text', type: 'sms', app: 'sms' }),
      msg({ body: 'ping', type: 'notification', app: 'com.chat' }),
      msg({ body: 'bank', type: 'notification', app: 'com.bank' }),
    ]);

    const sms = await get(`?device=${d.deviceId}&type=sms`);
    expect(sms.body.messages.map((m) => m.body)).toEqual(['text']);

    const chat = await get(`?device=${d.deviceId}&app=com.chat`);
    expect(chat.body.messages.map((m) => m.body)).toEqual(['ping']);
  });

  it('searches body, sender and app case-insensitively', async () => {
    const d = await ctx.addDevice();
    await send(d.token, [
      msg({ body: 'Your Parcel is out', sender: 'Courier', app: 'com.post' }),
      msg({ body: 'hello', sender: 'Alice', app: 'com.chat' }),
    ]);

    expect((await get(`?device=${d.deviceId}&q=parcel`)).body.messages).toHaveLength(1);
    expect((await get(`?device=${d.deviceId}&q=ALICE`)).body.messages[0].body).toBe('hello');
    expect((await get(`?device=${d.deviceId}&q=com.post`)).body.messages[0].body).toBe('Your Parcel is out');
  });

  it('treats % and _ in the search as literal characters', async () => {
    const d = await ctx.addDevice();
    await send(d.token, [msg({ body: 'saved 50% today' }), msg({ body: 'nothing special' })]);

    const res = await get(`?device=${d.deviceId}&q=${encodeURIComponent('50%')}`);
    expect(res.body.messages.map((m) => m.body)).toEqual(['saved 50% today']);
  });

  it('returns 400 for invalid query parameters', async () => {
    for (const q of ['type=email', 'limit=0', 'limit=1000', 'before=garbage']) {
      const res = await get(`?${q}`);
      expect(res.status, q).toBe(400);
      expect(res.body.error).toBe('invalid_query');
    }
  });
});
