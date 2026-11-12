import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { TOTP, Secret } from 'otpauth';

const ISSUER = 'Notiforwarder';
const PERIOD = 30; // seconds, the standard authenticator-app step
const DRIFT_STEPS = 1; // accept one step either side for clock drift
const BACKUP_COUNT = 10;
const BACKUP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes (0/o, 1/l/i)

const totpFor = (base32) => new TOTP({ issuer: ISSUER, secret: Secret.fromBase32(base32), digits: 6, period: PERIOD });

export function newTotpSecret() {
  return new Secret({ size: 20 }).base32;
}

export function otpauthUri(secret, username) {
  const t = totpFor(secret);
  t.label = username;
  return t.toString();
}

function sameCode(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Checks a 6-digit code. `lastStep` is the newest step already used for this user; a code
 * from that step or an older one is refused, so a code cannot be used twice.
 * Returns { ok: true, step } or { ok: false }.
 */
export function checkTotp(secret, code, { now = Date.now(), lastStep = null } = {}) {
  if (!/^\d{6}$/.test(String(code))) return { ok: false };
  const totp = totpFor(secret);
  const current = Math.floor(now / 1000 / PERIOD);
  for (let step = current - DRIFT_STEPS; step <= current + DRIFT_STEPS; step++) {
    if (lastStep !== null && step <= lastStep) continue;
    if (sameCode(totp.generate({ timestamp: step * PERIOD * 1000 }), String(code))) return { ok: true, step };
  }
  return { ok: false };
}

function randomBackupPart() {
  const bytes = randomBytes(5);
  return Array.from(bytes, (b) => BACKUP_ALPHABET[b % BACKUP_ALPHABET.length]).join('');
}

export function generateBackupCodes() {
  const codes = new Set();
  while (codes.size < BACKUP_COUNT) codes.add(`${randomBackupPart()}-${randomBackupPart()}`);
  return [...codes];
}

export function normalizeBackupCode(code) {
  return String(code).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function hashBackupCode(code) {
  return createHash('sha256').update(normalizeBackupCode(code)).digest('hex');
}
