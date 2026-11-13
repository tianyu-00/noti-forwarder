import { randomBytes } from 'node:crypto';
import { hashToken } from './tokens.js';

export const SESSION_COOKIE = 'nf_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createSession(db, userId) {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(24).toString('base64url');
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at)
     VALUES ($1, $2, $3, ts_add_ms(now(), $4))`,
    [hashToken(token), userId, csrfToken, SESSION_TTL_MS],
  );
  return { token, csrfToken };
}

export function deleteSession(db, token) {
  return db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

// Dashboard guard: loads the session from the cookie and attaches req.session.
export function requireSession({ db }) {
  return async (req, res, next) => {
    try {
      const token = req.cookies?.[SESSION_COOKIE];
      if (!token) return res.status(401).json({ error: 'unauthorized' });
      const { rows } = await db.query(
        `SELECT u.username, s.csrf_token
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = $1 AND s.expires_at > now()`,
        [hashToken(token)],
      );
      if (rows.length === 0) return res.status(401).json({ error: 'unauthorized' });
      req.session = { token, username: rows[0].username, csrfToken: rows[0].csrf_token };
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Applies to state-changing dashboard requests (the cookie alone is not enough).
export function requireCsrf(req, res, next) {
  if (req.get('x-csrf-token') !== req.session?.csrfToken) {
    return res.status(403).json({ error: 'csrf' });
  }
  next();
}
