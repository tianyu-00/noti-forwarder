import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { buildTestApp, ADMIN } from './helpers/app.js';
import { ensureAdminUser } from '../src/auth/users.js';

const NEW_PASSWORD = 'a brand new passphrase 123';
let ctx;
let agent;
let csrf;

beforeEach(async () => {
  ctx = await buildTestApp({ realAuth: true });
  await ensureAdminUser(ctx.pool, ADMIN);
  agent = request.agent(ctx.app);
  csrf = (await agent.post('/api/v1/auth/login').send(ADMIN)).body.csrfToken;
});
afterEach(() => ctx.pool.end());

const change = (body, token = csrf) => agent.post('/api/v1/auth/password').set('X-CSRF-Token', token).send(body);
const loginWith = (password) => request(ctx.app).post('/api/v1/auth/login').send({ username: ADMIN.username, password });

describe('POST /api/v1/auth/password', () => {
  it('needs a session and a CSRF token', async () => {
    const body = { currentPassword: ADMIN.password, newPassword: NEW_PASSWORD };
    expect((await request(ctx.app).post('/api/v1/auth/password').send(body)).status).toBe(401);
    expect((await agent.post('/api/v1/auth/password').send(body)).status).toBe(403);
  });

  it('refuses a wrong current password and changes nothing', async () => {
    const res = await change({ currentPassword: 'not the password', newPassword: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'wrong_password' });
    expect((await loginWith(ADMIN.password)).status).toBe(200);
    expect((await loginWith(NEW_PASSWORD)).status).toBe(401);
  });

  it('refuses a new password shorter than 12 characters', async () => {
    const res = await change({ currentPassword: ADMIN.password, newPassword: 'short' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_payload' });
    expect((await loginWith(ADMIN.password)).status).toBe(200);
  });

  it('switches to the new password, ends other sessions, keeps this one and audits without secrets', async () => {
    const other = request.agent(ctx.app);
    await other.post('/api/v1/auth/login').send(ADMIN);
    expect((await other.get('/api/v1/auth/me')).status).toBe(200);

    const res = await change({ currentPassword: ADMIN.password, newPassword: NEW_PASSWORD });

    expect(res.status).toBe(204);
    expect((await loginWith(ADMIN.password)).status).toBe(401);
    expect((await loginWith(NEW_PASSWORD)).status).toBe(200);
    expect((await other.get('/api/v1/auth/me')).status).toBe(401);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
    const { rows } = await ctx.pool.query("SELECT actor FROM audit_log WHERE event = 'password_change'");
    expect(rows).toEqual([{ actor: ADMIN.username }]);
    expect(JSON.stringify((await ctx.pool.query('SELECT * FROM audit_log')).rows)).not.toContain(NEW_PASSWORD);
  });
});
