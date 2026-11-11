import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createTestPool } from './db.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createApp } from '../../src/app.js';
import { hashToken } from '../../src/auth/tokens.js';

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));

export const ADMIN = { username: 'admin', password: 'correct horse battery staple' };

// By default viewers are let through so message tests stay focused; pass
// realAuth: true to exercise the real session guard.
export async function buildTestApp({ realAuth = false, ...options } = {}) {
  const pool = await createTestPool();
  await runMigrations(pool, migrationsDir);
  const app = createApp({
    db: pool,
    ...(realAuth ? { cookieSecure: false } : { requireViewer: (req, res, next) => next() }),
    ...options,
  });

  async function addDevice({ revoked = false } = {}) {
    const token = randomBytes(32).toString('base64url');
    const deviceId = randomUUID();
    await pool.query(
      'INSERT INTO devices (device_id, name, token_hash, revoked_at) VALUES ($1, $2, $3, $4)',
      [deviceId, 'Test phone', hashToken(token), revoked ? new Date() : null],
    );
    return { deviceId, token };
  }

  return { app, pool, addDevice };
}

export function msg(overrides = {}) {
  return {
    id: randomUUID(),
    type: 'notification',
    app: 'com.bank',
    sender: 'Bank',
    body: 'Your code is 123456',
    receivedAt: '2026-11-11T10:00:05Z',
    ...overrides,
  };
}
