import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildTestApp, ADMIN, msg } from './helpers/app.js';
import { ensureAdminUser } from '../src/auth/users.js';

const PUBLIC_URL = 'https://nf.example.com';

let ctx;
let agent;
let csrf;
beforeAll(async () => {
  // High limit here: this file makes many /pair calls; the limit has its own test.
  ctx = await buildTestApp({
    realAuth: true,
    publicUrl: PUBLIC_URL,
    pairRateLimit: { limit: 1000, windowMs: 60000 },
  });
  await ensureAdminUser(ctx.pool, ADMIN);
  agent = request.agent(ctx.app);
  csrf = (await agent.post('/api/v1/auth/login').send(ADMIN)).body.csrfToken;
});
afterAll(() => ctx.pool.end());

const createCode = () => agent.post('/api/v1/pairing-codes').set('X-CSRF-Token', csrf);
const pair = (body) => request(ctx.app).post('/api/v1/pair').send(body);
const phone = { name: 'OnePlus 7T Pro', model: 'HD1913', appVersion: '0.1.0' };

describe('POST /api/v1/pairing-codes', () => {
  it('needs a session and a CSRF token', async () => {
    expect((await request(ctx.app).post('/api/v1/pairing-codes')).status).toBe(401);
    expect((await agent.post('/api/v1/pairing-codes')).status).toBe(403);
  });

  it('creates a typeable code of at least 128 bits that expires in 10 minutes', async () => {
    const res = await createCode();
    expect(res.status).toBe(201);

    const raw = res.body.code.replace(/-/g, '');
    expect(raw).toMatch(/^[A-Z2-7]+$/);
    expect(raw.length * 5).toBeGreaterThanOrEqual(128);

    const ttl = new Date(res.body.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(9 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(10 * 60 * 1000);
    expect(JSON.parse(res.body.qrPayload)).toEqual({ u: PUBLIC_URL, c: res.body.code });
  });

  it('stores only a hash of the code', async () => {
    const { body } = await createCode();
    const { rows } = await ctx.pool.query('SELECT code_hash FROM pairing_codes');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.code_hash).not.toContain(body.code.replace(/-/g, ''));
  });
});

describe('POST /api/v1/pair', () => {
  it('exchanges a code for a device token that works for sending messages', async () => {
    const { body: code } = await createCode();

    const res = await pair({ code: code.code, ...phone });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ deviceId: expect.any(String), token: expect.any(String) });
    const { rows } = await ctx.pool.query('SELECT * FROM devices WHERE device_id = $1', [res.body.deviceId]);
    expect(rows[0]).toMatchObject({ name: phone.name, model: phone.model, app_version: phone.appVersion });
    expect(rows[0].token_hash).not.toBe(res.body.token);

    const sent = await request(ctx.app)
      .post('/api/v1/messages')
      .set('Authorization', `Bearer ${res.body.token}`)
      .send({ messages: [msg()] });
    expect(sent.body.stored).toBe(1);
  });

  it('accepts the code typed in lower case without dashes', async () => {
    const { body: code } = await createCode();
    const typed = code.code.replace(/-/g, '').toLowerCase();
    expect((await pair({ code: typed, ...phone })).status).toBe(201);
  });

  it('burns the code: a second use fails', async () => {
    const { body: code } = await createCode();
    expect((await pair({ code: code.code, ...phone })).status).toBe(201);
    const again = await pair({ code: code.code, ...phone });
    expect(again.status).toBe(400);
    expect(again.body).toEqual({ error: 'invalid_code' });
  });

  it('lets only one of two simultaneous requests win', async () => {
    const { body: code } = await createCode();
    const results = await Promise.all([pair({ code: code.code, ...phone }), pair({ code: code.code, ...phone })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
  });

  it('rejects unknown and expired codes with the same error', async () => {
    const { body: code } = await createCode();
    await ctx.pool.query("UPDATE pairing_codes SET expires_at = ts_add_ms(now(), -1000)");

    const expired = await pair({ code: code.code, ...phone });
    const unknown = await pair({ code: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG', ...phone });
    expect(expired.status).toBe(400);
    expect(expired.body).toEqual(unknown.body);
  });

  it('returns 400 for a malformed body', async () => {
    expect((await pair({ code: 'x' })).status).toBe(400);
    expect((await pair({})).status).toBe(400);
  });

  it('records the pairing in the audit log', async () => {
    const { body: code } = await createCode();
    const { body } = await pair({ code: code.code, ...phone });
    const { rows } = await ctx.pool.query("SELECT device_id FROM audit_log WHERE event = 'pair'");
    expect(rows.map((r) => r.device_id)).toContain(body.deviceId);
  });

  it('rate limits pairing attempts per IP', async () => {
    const local = await buildTestApp({ realAuth: true, pairRateLimit: { limit: 2, windowMs: 60000 } });
    const attempt = () =>
      request(local.app).post('/api/v1/pair').send({ code: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG', ...phone });
    await attempt();
    await attempt();
    expect((await attempt()).status).toBe(429);
    await local.pool.end();
  });
});

describe('POST /api/v1/pair marks the phone as seen', () => {
  it('sets last seen at pairing, so a new phone is not shown as "never connected"', async () => {
    const { body: code } = await createCode();

    const res = await pair({ code: code.code, ...phone });

    const { rows } = await ctx.pool.query(
      "SELECT last_seen > ts_add_ms(now(), -60000) AS fresh FROM devices WHERE device_id = $1",
      [res.body.deviceId],
    );
    expect(rows[0].fresh).toBe(1);
  });
});
