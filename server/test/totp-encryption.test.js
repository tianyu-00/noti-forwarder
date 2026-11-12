import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { TOTP, Secret } from 'otpauth';
import { buildTestApp, ADMIN } from './helpers/app.js';
import { ensureAdminUser } from '../src/auth/users.js';
import { createSecretBox, plainSecretBox } from '../src/auth/secret-box.js';
import { sealExistingSecrets, assertSecretsReadable } from '../src/auth/secrets-at-rest.js';

const box = createSecretBox('k'.repeat(40));
const codeAt = (secret, ms) => new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate({ timestamp: ms });
const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);

let ctx;
beforeEach(async () => {
  ctx = await buildTestApp({ realAuth: true, now: () => NOW, secretBox: box });
  await ensureAdminUser(ctx.pool, ADMIN);
});
afterEach(() => ctx.pool.end());

const storedSecret = async () => (await ctx.pool.query('SELECT totp_secret FROM users')).rows[0].totp_secret;

describe('two-step secret at rest', () => {
  it('is stored encrypted, and signing in with a code still works', async () => {
    const agent = request.agent(ctx.app);
    const csrf = (await agent.post('/api/v1/auth/login').send(ADMIN)).body.csrfToken;
    const { secret } = (await agent.post('/api/v1/auth/totp/setup').set('X-CSRF-Token', csrf).send({})).body;

    expect(await storedSecret()).toMatch(/^enc:v1:/);
    expect(await storedSecret()).not.toContain(secret);

    const enable = await agent.post('/api/v1/auth/totp/enable').set('X-CSRF-Token', csrf).send({ code: codeAt(secret, NOW) });
    expect(enable.status).toBe(200);
    expect(await storedSecret()).toMatch(/^enc:v1:/);

    const login = await request(ctx.app).post('/api/v1/auth/login').send({ ...ADMIN, code: codeAt(secret, NOW + 30000) });
    expect(login.status).toBe(200);
  });
});

describe('sealExistingSecrets', () => {
  it('encrypts secrets saved before a key was set, once', async () => {
    await ctx.pool.query("UPDATE users SET totp_secret = 'JBSWY3DPEHPK3PXP'");

    expect(await sealExistingSecrets(ctx.pool, box)).toBe(1);
    expect(box.open(await storedSecret())).toBe('JBSWY3DPEHPK3PXP');
    expect(await sealExistingSecrets(ctx.pool, box)).toBe(0);
  });

  it('does nothing without a key', async () => {
    await ctx.pool.query("UPDATE users SET totp_secret = 'JBSWY3DPEHPK3PXP'");
    expect(await sealExistingSecrets(ctx.pool, plainSecretBox)).toBe(0);
    expect(await storedSecret()).toBe('JBSWY3DPEHPK3PXP');
  });
});

describe('assertSecretsReadable', () => {
  it('refuses to start when secrets are encrypted but there is no key', async () => {
    await ctx.pool.query('UPDATE users SET totp_secret = $1', [box.seal('JBSWY3DPEHPK3PXP')]);

    await expect(assertSecretsReadable(ctx.pool, plainSecretBox)).rejects.toThrow(/SECRET_KEY/);
    await expect(assertSecretsReadable(ctx.pool, createSecretBox('z'.repeat(40)))).rejects.toThrow(/SECRET_KEY/);
    await expect(assertSecretsReadable(ctx.pool, box)).resolves.toBeUndefined();
  });

  it('is fine with plain or missing secrets and no key', async () => {
    await expect(assertSecretsReadable(ctx.pool, plainSecretBox)).resolves.toBeUndefined();
    await ctx.pool.query("UPDATE users SET totp_secret = 'JBSWY3DPEHPK3PXP'");
    await expect(assertSecretsReadable(ctx.pool, plainSecretBox)).resolves.toBeUndefined();
  });
});
