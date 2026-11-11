import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildTestApp, ADMIN, msg } from './helpers/app.js';
import { openStream } from './helpers/sse.js';
import { ensureAdminUser } from '../src/auth/users.js';

let ctx;
let agent;
let csrf;
let cookie;
beforeAll(async () => {
  ctx = await buildTestApp({ realAuth: true, pairRateLimit: { limit: 1000, windowMs: 60000 } });
  await ensureAdminUser(ctx.pool, ADMIN);
  agent = request.agent(ctx.app);
  const res = await agent.post('/api/v1/auth/login').send(ADMIN);
  csrf = res.body.csrfToken;
  cookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
});
afterAll(() => ctx.pool.end());

const send = (token, messages) =>
  request(ctx.app).post('/api/v1/messages').set('Authorization', `Bearer ${token}`).send({ messages });

describe('GET /api/v1/stream', () => {
  it('needs a session', async () => {
    const stream = await openStream(ctx.app);
    expect(stream.status).toBe(401);
  });

  it('opens an event stream and confirms the connection', async () => {
    const stream = await openStream(ctx.app, { cookie });
    expect(stream.status).toBe(200);
    expect(stream.headers['content-type']).toMatch(/text\/event-stream/);
    expect(await stream.next()).toEqual({ comment: 'connected' });
    stream.close();
  });

  it('pushes a stored message to viewers, but not a duplicate', async () => {
    const d = await ctx.addDevice();
    const stream = await openStream(ctx.app, { cookie });
    await stream.next(); // connected

    const m = msg({ body: 'live one' });
    await send(d.token, [m]);

    const event = await stream.next();
    expect(event.event).toBe('message');
    expect(event.data).toMatchObject({ id: m.id, deviceId: d.deviceId, body: 'live one', type: 'notification' });

    await send(d.token, [m]); // retry of the same id
    expect(await stream.quiet()).toBe(true);
    stream.close();
  });

  it('pushes device events when a phone pairs, is renamed and is revoked', async () => {
    const stream = await openStream(ctx.app, { cookie });
    await stream.next();

    const code = (await agent.post('/api/v1/pairing-codes').set('X-CSRF-Token', csrf)).body.code;
    const paired = await request(ctx.app).post('/api/v1/pair').send({ code, name: 'New phone' });
    expect(paired.status).toBe(201);
    const created = await stream.next();
    expect(created.event).toBe('device');
    expect(created.data).toMatchObject({ deviceId: paired.body.deviceId, name: 'New phone', revokedAt: null });
    expect(JSON.stringify(created.data)).not.toMatch(/token/i);

    const renamed = await agent.patch(`/api/v1/devices/${paired.body.deviceId}`).set('X-CSRF-Token', csrf).send({ name: 'Renamed' });
    expect(renamed.status).toBe(200);
    expect((await stream.next()).data.name).toBe('Renamed');

    const revoked = await agent.delete(`/api/v1/devices/${paired.body.deviceId}`).set('X-CSRF-Token', csrf);
    expect(revoked.status).toBe(204);
    expect((await stream.next()).data.revokedAt).toEqual(expect.any(String));
    stream.close();
  });
});
