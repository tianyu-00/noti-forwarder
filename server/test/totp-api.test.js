import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { TOTP, Secret } from 'otpauth';
import { buildTestApp, ADMIN } from './helpers/app.js';
import { ensureAdminUser } from '../src/auth/users.js';

const STEP = 30000;
const codeAt = (secret, ms) => new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate({ timestamp: ms });

// A stack with a movable clock so each step can use a fresh code.
async function setup() {
  const clock = { t: Date.UTC(2026, 10, 12, 12, 0, 0) };
  const ctx = await buildTestApp({ realAuth: true, now: () => clock.t });
  await ensureAdminUser(ctx.pool, ADMIN);
  const advance = () => {
    clock.t += STEP;
  };
  const agent = request.agent(ctx.app);
  const login = await agent.post('/api/v1/auth/login').send(ADMIN);
  const csrf = login.body.csrfToken;
  const post = (path, body, token = csrf) => agent.post(`/api/v1/auth/totp/${path}`).set('X-CSRF-Token', token).send(body);

  // Turns 2FA on and returns what the user would hold.
  async function enable() {
    const { secret } = (await post('setup', {})).body;
    const res = await post('enable', { code: codeAt(secret, clock.t) });
    advance();
    return { secret, backupCodes: res.body.backupCodes };
  }
  const freshLogin = (body = ADMIN) => request(ctx.app).post('/api/v1/auth/login').send(body);
  return { ctx, clock, advance, agent, csrf, post, enable, freshLogin };
}

describe('setting up 2FA', () => {
  it('needs a session and a CSRF token', async () => {
    const s = await setup();
    expect((await request(s.ctx.app).post('/api/v1/auth/totp/setup').send({})).status).toBe(401);
    expect((await s.agent.post('/api/v1/auth/totp/setup').send({})).status).toBe(403);
    await s.ctx.pool.end();
  });

  it('hands out a secret and an authenticator link without turning 2FA on yet', async () => {
    const s = await setup();
    const res = await s.post('setup', {});
    expect(res.status).toBe(200);
    expect(res.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(res.body.otpauthUri).toContain(`secret=${res.body.secret}`);
    expect((await s.freshLogin()).status).toBe(200); // still no code needed
    expect((await s.agent.get('/api/v1/auth/me')).body.totpEnabled).toBe(false);
    await s.ctx.pool.end();
  });

  it('rejects a wrong code and leaves 2FA off', async () => {
    const s = await setup();
    await s.post('setup', {});
    expect((await s.post('enable', { code: '000000' })).status).toBe(400);
    expect((await s.freshLogin()).status).toBe(200);
    await s.ctx.pool.end();
  });

  it('turns on with a correct code and returns 10 backup codes once', async () => {
    const s = await setup();
    const { secret } = (await s.post('setup', {})).body;
    const res = await s.post('enable', { code: codeAt(secret, s.clock.t) });
    expect(res.status).toBe(200);
    expect(res.body.backupCodes).toHaveLength(10);
    expect((await s.agent.get('/api/v1/auth/me')).body.totpEnabled).toBe(true);
    const stored = await s.ctx.pool.query('SELECT code_hash FROM totp_backup_codes');
    expect(stored.rowCount).toBe(10);
    expect(JSON.stringify(stored.rows)).not.toContain(res.body.backupCodes[0]);
    await s.ctx.pool.end();
  });

  it('refuses a second setup while 2FA is on, and enabling without a pending setup', async () => {
    const s = await setup();
    expect((await s.post('enable', { code: '123456' })).status).toBe(400);
    await s.enable();
    expect((await s.post('setup', {})).status).toBe(409);
    await s.ctx.pool.end();
  });
});

describe('logging in with 2FA on', () => {
  let s;
  let held;
  beforeEach(async () => {
    s = await setup();
    held = await s.enable();
  });

  it('asks for a code after a correct password, and starts no session', async () => {
    const res = await s.freshLogin();
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'totp_required' });
    expect(res.headers['set-cookie']).toBeUndefined();
    await s.ctx.pool.end();
  });

  it('does not reveal that 2FA is on when the password is wrong', async () => {
    const res = await s.freshLogin({ username: 'admin', password: 'wrong wrong wrong' });
    expect(res.body).toEqual({ error: 'invalid_credentials' });
    await s.ctx.pool.end();
  });

  it('lets a correct code in', async () => {
    const res = await s.freshLogin({ ...ADMIN, code: codeAt(held.secret, s.clock.t) });
    expect(res.status).toBe(200);
    expect(res.body.csrfToken).toBeDefined();
    await s.ctx.pool.end();
  });

  it('refuses a wrong code and counts it towards the lockout', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await s.freshLogin({ ...ADMIN, code: '000000' })).status).toBe(401);
    }
    const locked = await s.freshLogin({ ...ADMIN, code: codeAt(held.secret, s.clock.t) });
    expect(locked.status).toBe(429);
    await s.ctx.pool.end();
  });

  it('refuses a code that was already used', async () => {
    const code = codeAt(held.secret, s.clock.t);
    expect((await s.freshLogin({ ...ADMIN, code })).status).toBe(200);
    expect((await s.freshLogin({ ...ADMIN, code })).status).toBe(401);
    await s.ctx.pool.end();
  });

  it('accepts a backup code once, in any case and with or without the dash', async () => {
    const [first] = held.backupCodes;
    expect((await s.freshLogin({ ...ADMIN, code: first.toUpperCase() })).status).toBe(200);
    expect((await s.freshLogin({ ...ADMIN, code: first })).status).toBe(401);
    expect((await s.freshLogin({ ...ADMIN, code: held.backupCodes[1].replace('-', '') })).status).toBe(200);
    await s.ctx.pool.end();
  });
});

describe('turning 2FA off', () => {
  it('needs the password and a current code, then clears everything', async () => {
    const s = await setup();
    const held = await s.enable();
    const bad = await s.post('disable', { password: 'wrong wrong wrong', code: codeAt(held.secret, s.clock.t) });
    expect(bad.status).toBe(403);
    const noCode = await s.post('disable', { password: ADMIN.password, code: '000000' });
    expect(noCode.status).toBe(403);

    const ok = await s.post('disable', { password: ADMIN.password, code: codeAt(held.secret, s.clock.t) });
    expect(ok.status).toBe(204);
    expect((await s.freshLogin()).status).toBe(200);
    expect((await s.ctx.pool.query('SELECT 1 FROM totp_backup_codes')).rowCount).toBe(0);
    const { rows } = await s.ctx.pool.query('SELECT totp_secret, totp_enabled_at FROM users');
    expect(rows).toEqual([{ totp_secret: null, totp_enabled_at: null }]);
    await s.ctx.pool.end();
  });

  it('writes audit entries for enabling and disabling', async () => {
    const s = await setup();
    const held = await s.enable();
    await s.post('disable', { password: ADMIN.password, code: codeAt(held.secret, s.clock.t) });
    const { rows } = await s.ctx.pool.query("SELECT event FROM audit_log WHERE event LIKE 'totp%' ORDER BY id");
    expect(rows.map((r) => r.event)).toEqual(['totp_enabled', 'totp_disabled']);
    await s.ctx.pool.end();
  });
});

describe('resetting 2FA from the server (lost phone and backup codes)', () => {
  it('removes 2FA for a user so the password alone works again, and reports unknown users', async () => {
    const { resetTotp } = await import('../src/auth/users.js');
    const s = await setup();
    await s.enable();
    expect((await s.freshLogin()).body).toEqual({ error: 'totp_required' });

    expect(await resetTotp(s.ctx.pool, 'admin')).toBe(true);

    expect((await s.freshLogin()).status).toBe(200);
    expect((await s.ctx.pool.query('SELECT 1 FROM totp_backup_codes')).rowCount).toBe(0);
    expect(await resetTotp(s.ctx.pool, 'nobody')).toBe(false);
    const { rows } = await s.ctx.pool.query("SELECT actor FROM audit_log WHERE event = 'totp_reset'");
    expect(rows).toEqual([{ actor: 'admin' }]);
    await s.ctx.pool.end();
  });
});
