import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { createSession, deleteSession, requireCsrf, SESSION_COOKIE, SESSION_TTL_MS } from '../auth/sessions.js';
import { rateLimit } from '../rate-limit.js';

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(500),
});

// Verified against when the user does not exist, so timing does not reveal it.
const dummyHash = await hashPassword('dummy-password-for-timing');

export function authRouter({
  db,
  requireViewer,
  cookieSecure = true,
  loginRateLimit = { limit: 20, windowMs: 15 * 60 * 1000 },
}) {
  const router = Router();
  const perIp = rateLimit({ ...loginRateLimit, key: (req) => req.ip });

  router.post('/auth/login', perIp, express.json({ limit: '10kb' }), async (req, res, next) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'invalid_payload' });
      const { username, password } = parsed.data;

      const { rows } = await db.query(
        'SELECT id, password_hash, locked_until FROM users WHERE username = $1',
        [username],
      );
      const user = rows[0];

      if (user?.locked_until && user.locked_until > new Date()) {
        await audit(db, { event: 'login_locked', actor: username, ip: req.ip });
        return res.status(429).json({ error: 'locked' });
      }

      const ok = await verifyPassword(user ? user.password_hash : dummyHash, password);
      if (!user || !ok) {
        if (user) {
          await db.query(
            `UPDATE users
                SET failed_logins = failed_logins + 1,
                    locked_until = CASE WHEN failed_logins + 1 >= $2
                                        THEN now() + ($3 || ' minutes')::interval END
              WHERE id = $1`,
            [user.id, MAX_FAILURES, String(LOCK_MINUTES)],
          );
        }
        await audit(db, { event: 'login_failed', actor: username, ip: req.ip });
        return res.status(401).json({ error: 'invalid_credentials' });
      }

      await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [user.id]);
      const session = await createSession(db, user.id);
      await audit(db, { event: 'login', actor: username, ip: req.ip });
      res.cookie(SESSION_COOKIE, session.token, {
        httpOnly: true,
        secure: cookieSecure,
        sameSite: 'strict',
        maxAge: SESSION_TTL_MS,
        path: '/',
      });
      res.json({ username, csrfToken: session.csrfToken });
    } catch (err) {
      next(err);
    }
  });

  router.get('/auth/me', requireViewer, (req, res) => {
    res.json({ username: req.session.username, csrfToken: req.session.csrfToken });
  });

  router.post('/auth/logout', requireViewer, requireCsrf, async (req, res, next) => {
    try {
      await deleteSession(db, req.session.token);
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
