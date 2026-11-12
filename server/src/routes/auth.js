import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { hashToken } from '../auth/tokens.js';
import { createSession, deleteSession, requireCsrf, SESSION_COOKIE, SESSION_TTL_MS } from '../auth/sessions.js';
import { rateLimit } from '../rate-limit.js';
import { plainSecretBox } from '../auth/secret-box.js';
import { verifySecondFactor } from '../auth/second-factor.js';
import { totpRouter } from './totp.js';

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(500),
  code: z.string().max(30).optional(),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(500),
  newPassword: z.string().min(12).max(500),
});

// Verified against when the user does not exist, so timing does not reveal it.
const dummyHash = await hashPassword('dummy-password-for-timing');

export function authRouter({
  db,
  requireViewer,
  cookieSecure = true,
  loginRateLimit = { limit: 20, windowMs: 15 * 60 * 1000 },
  now = Date.now,
  secretBox = plainSecretBox,
}) {
  const router = Router();
  const perIp = rateLimit({ ...loginRateLimit, key: (req) => req.ip });
  router.use(totpRouter({ db, requireViewer, limiter: perIp, now, secretBox }));

  router.post('/auth/login', perIp, express.json({ limit: '10kb' }), async (req, res, next) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'invalid_payload' });
      const { username, password, code } = parsed.data;

      const { rows } = await db.query(
        'SELECT id, password_hash, locked_until, totp_secret, totp_enabled_at, totp_last_step FROM users WHERE username = $1',
        [username],
      );
      const user = rows[0];

      if (user?.locked_until && user.locked_until > new Date()) {
        await audit(db, { event: 'login_locked', actor: username, ip: req.ip });
        return res.status(429).json({ error: 'locked' });
      }

      let ok = await verifyPassword(user ? user.password_hash : dummyHash, password);
      if (ok && user.totp_enabled_at) {
        // Only after a correct password, so a wrong password never reveals that 2FA is on.
        if (code === undefined || code === '') return res.status(401).json({ error: 'totp_required' });
        ok = await verifySecondFactor(db, user, code, now(), secretBox);
      }
      if (!user || !ok) {
        if (user) {
          await db.query(
            `UPDATE users
                SET failed_logins = CASE WHEN locked_until IS NOT NULL AND locked_until <= now()
                                         THEN 1 ELSE failed_logins + 1 END,
                    locked_until = CASE WHEN (CASE WHEN locked_until IS NOT NULL AND locked_until <= now()
                                                   THEN 1 ELSE failed_logins + 1 END) >= $2
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

  router.get('/auth/me', requireViewer, async (req, res, next) => {
    try {
      const { rows } = await db.query('SELECT totp_enabled_at FROM users WHERE username = $1', [req.session.username]);
      res.json({
        username: req.session.username,
        csrfToken: req.session.csrfToken,
        totpEnabled: Boolean(rows[0]?.totp_enabled_at),
      });
    } catch (err) {
      next(err);
    }
  });

  // Changing the password ends every other session, so a stolen session or an old browser
  // cannot stay signed in. This session stays.
  router.post('/auth/password', perIp, requireViewer, requireCsrf, express.json({ limit: '10kb' }), async (req, res, next) => {
    try {
      const parsed = passwordSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'invalid_payload' });
      const { rows } = await db.query('SELECT id, password_hash FROM users WHERE username = $1', [req.session.username]);
      const user = rows[0];
      if (!user || !(await verifyPassword(user.password_hash, parsed.data.currentPassword))) {
        await audit(db, { event: 'password_change_failed', actor: req.session.username, ip: req.ip });
        return res.status(400).json({ error: 'wrong_password' });
      }
      const hash = await hashPassword(parsed.data.newPassword);
      await db.query('UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL WHERE id = $1', [user.id, hash]);
      await db.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [user.id, hashToken(req.session.token)]);
      await audit(db, { event: 'password_change', actor: req.session.username, ip: req.ip });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
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
