import { describe, it, expect } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import { newTotpSecret, otpauthUri, checkTotp, generateBackupCodes, hashBackupCode, normalizeBackupCode } from '../src/auth/totp.js';

const STEP_MS = 30000;
const at = (secret, ms) =>
  new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate({ timestamp: ms });

describe('TOTP codes', () => {
  const secret = newTotpSecret();
  const now = Date.UTC(2026, 10, 12, 12, 0, 10);

  it('makes a long random base32 secret each time', () => {
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(newTotpSecret()).not.toBe(secret);
  });

  it('builds the link an authenticator app scans, with the issuer and account', () => {
    const uri = otpauthUri(secret, 'admin');
    expect(uri).toMatch(/^otpauth:\/\/totp\/Notiforwarder:admin\?/);
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain('issuer=Notiforwarder');
  });

  it('accepts the current code and returns its step', () => {
    const result = checkTotp(secret, at(secret, now), { now, lastStep: null });
    expect(result).toEqual({ ok: true, step: Math.floor(now / STEP_MS) });
  });

  it('accepts one step either side for clock drift, but not two', () => {
    expect(checkTotp(secret, at(secret, now - STEP_MS), { now, lastStep: null }).ok).toBe(true);
    expect(checkTotp(secret, at(secret, now + STEP_MS), { now, lastStep: null }).ok).toBe(true);
    expect(checkTotp(secret, at(secret, now - 2 * STEP_MS), { now, lastStep: null }).ok).toBe(false);
  });

  it('rejects a wrong or malformed code', () => {
    expect(checkTotp(secret, '000000', { now, lastStep: null }).ok).toBe(false);
    expect(checkTotp(secret, 'abcdef', { now, lastStep: null }).ok).toBe(false);
    expect(checkTotp(secret, '', { now, lastStep: null }).ok).toBe(false);
  });

  it('refuses a code from a step that was already used (replay)', () => {
    const first = checkTotp(secret, at(secret, now), { now, lastStep: null });
    expect(checkTotp(secret, at(secret, now), { now, lastStep: first.step }).ok).toBe(false);
    // An older code is also refused once a newer step has been used.
    expect(checkTotp(secret, at(secret, now - STEP_MS), { now, lastStep: first.step }).ok).toBe(false);
  });
});

describe('backup codes', () => {
  it('makes 10 distinct codes that are easy to type', () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);
  });

  it('hashes codes, ignoring case, spaces and the dash', () => {
    expect(hashBackupCode('ab12c-de34f')).toBe(hashBackupCode(' AB12C DE34F '));
    expect(hashBackupCode('ab12c-de34f')).not.toBe(hashBackupCode('ab12c-de34g'));
    expect(hashBackupCode('ab12c-de34f')).not.toContain('ab12c');
    expect(normalizeBackupCode('AB12C-de34f')).toBe('ab12cde34f');
  });
});
