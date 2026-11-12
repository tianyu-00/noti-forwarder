import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildTestApp, ADMIN } from './helpers/app.js';
import { ensureAdminUser } from '../src/auth/users.js';

let ctx;
beforeAll(async () => {
  ctx = await buildTestApp({ realAuth: true });
  await ensureAdminUser(ctx.pool, ADMIN);
});
afterAll(() => ctx.pool.end());

const login = (agent, body = ADMIN) => agent.post('/api/v1/auth/login').send(body);

describe('ensureAdminUser', () => {
  it('creates the admin once and never overwrites it', async () => {
    const pool = (await buildTestApp()).pool;
    expect(await ensureAdminUser(pool, ADMIN)).toBe(true);
    expect(await ensureAdminUser(pool, { username: 'other', password: 'another long password' })).toBe(false);

    const { rows } = await pool.query('SELECT username, password_hash FROM users');
    expect(rows).toHaveLength(1);
    expect(rows[0].username).toBe('admin');
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(rows[0].password_hash).not.toContain(ADMIN.password);
    await pool.end();
  });
});

describe('POST /api/v1/auth/login', () => {
  it('logs in and returns the username and a CSRF token', async () => {
    const res = await login(request(ctx.app));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ username: 'admin', csrfToken: expect.any(String) });
  });

  it('sets an httpOnly, Secure, SameSite session cookie by default', async () => {
    const secureApp = await buildTestApp({ requireViewer: undefined });
    await ensureAdminUser(secureApp.pool, ADMIN);
    const res = await login(request(secureApp.app));
    const cookie = res.headers['set-cookie'].join(';');
    expect(cookie).toMatch(/nf_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    await secureApp.pool.end();
  });

  it('gives the same 401 for a wrong password and an unknown user', async () => {
    const wrong = await login(request(ctx.app), { username: 'admin', password: 'nope nope nope nope' });
    const unknown = await login(request(ctx.app), { username: 'ghost', password: 'nope nope nope nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('returns 400 for a malformed body', async () => {
    const res = await request(ctx.app).post('/api/v1/auth/login').send({ username: 5 });
    expect(res.status).toBe(400);
  });
});

describe('sessions', () => {
  it('GET /auth/me needs a session', async () => {
    expect((await request(ctx.app).get('/api/v1/auth/me')).status).toBe(401);

    const agent = request.agent(ctx.app);
    const { body } = await login(agent);
    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ username: 'admin', csrfToken: body.csrfToken, totpEnabled: false });
  });

  it('logout needs the CSRF token, then ends the session', async () => {
    const agent = request.agent(ctx.app);
    const { body } = await login(agent);

    expect((await agent.post('/api/v1/auth/logout')).status).toBe(403);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200);

    expect((await agent.post('/api/v1/auth/logout').set('X-CSRF-Token', body.csrfToken)).status).toBe(204);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('rejects an expired session', async () => {
    const agent = request.agent(ctx.app);
    await login(agent);
    await ctx.pool.query("UPDATE sessions SET expires_at = now() - interval '1 minute'");
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('protects GET /messages with the session guard', async () => {
    expect((await request(ctx.app).get('/api/v1/messages')).status).toBe(401);
    const agent = request.agent(ctx.app);
    await login(agent);
    expect((await agent.get('/api/v1/messages')).status).toBe(200);
  });
});

describe('login protection and audit', () => {
  it('locks the account after repeated failures, even for the right password', async () => {
    const local = await buildTestApp({ realAuth: true });
    await ensureAdminUser(local.pool, ADMIN);
    for (let i = 0; i < 5; i++) {
      expect((await login(request(local.app), { username: 'admin', password: 'bad bad bad bad' })).status).toBe(401);
    }
    const res = await login(request(local.app));
    expect(res.status).toBe(429);
    await local.pool.end();
  });

  it('starts counting from zero once a lock has expired, so one typo does not lock again', async () => {
    const local = await buildTestApp({ realAuth: true });
    await ensureAdminUser(local.pool, ADMIN);
    await local.pool.query("UPDATE users SET failed_logins = 5, locked_until = now() - interval '1 minute'");
    const bad = { username: 'admin', password: 'bad bad bad bad' };
    expect((await login(request(local.app), bad)).status).toBe(401);
    // Not locked: the right password still works.
    expect((await login(request(local.app))).status).toBe(200);
    await local.pool.end();
  });

  it('rate limits login attempts per IP', async () => {
    const local = await buildTestApp({ realAuth: true, loginRateLimit: { limit: 3, windowMs: 60000 } });
    for (let i = 0; i < 3; i++) await login(request(local.app), { username: 'x', password: 'bad bad bad bad' });
    expect((await login(request(local.app), { username: 'x', password: 'bad bad bad bad' })).status).toBe(429);
    await local.pool.end();
  });

  it('writes login events to the audit log without secrets', async () => {
    const local = await buildTestApp({ realAuth: true });
    await ensureAdminUser(local.pool, ADMIN);
    await login(request(local.app), { username: 'admin', password: 'bad bad bad bad' });
    await login(request(local.app));

    const { rows } = await local.pool.query('SELECT event, actor FROM audit_log ORDER BY id');
    expect(rows).toEqual([
      { event: 'login_failed', actor: 'admin' },
      { event: 'login', actor: 'admin' },
    ]);
    expect(JSON.stringify(rows)).not.toContain('bad bad');
    await local.pool.end();
  });
});
