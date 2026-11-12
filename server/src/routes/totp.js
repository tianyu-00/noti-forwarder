import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { plainSecretBox } from '../auth/secret-box.js';
import { verifyPassword } from '../auth/password.js';
import { requireCsrf } from '../auth/sessions.js';
import { verifySecondFactor } from '../auth/second-factor.js';
import { checkTotp, newTotpSecret, otpauthUri, generateBackupCodes, hashBackupCode } from '../auth/totp.js';

const enableSchema = z.object({ code: z.string().min(1).max(20) });
const disableSchema = z.object({ password: z.string().min(1).max(500), code: z.string().min(1).max(30) });

const USER_COLUMNS = 'id, username, password_hash, totp_secret, totp_enabled_at, totp_last_step';

export function totpRouter({ db, requireViewer, limiter, now, secretBox = plainSecretBox }) {
  const router = Router();
  const guard = [limiter, requireViewer, requireCsrf, express.json({ limit: '10kb' })];

  async function currentUser(req) {
    const { rows } = await db.query(`SELECT ${USER_COLUMNS} FROM users WHERE username = $1`, [req.session.username]);
    return rows[0];
  }

  // Step 1: make a secret. 2FA stays off until the user proves their app works (step 2).
  router.post('/auth/totp/setup', ...guard, async (req, res, next) => {
    try {
      const user = await currentUser(req);
      if (user.totp_enabled_at) return res.status(409).json({ error: 'already_enabled' });
      const secret = newTotpSecret();
      await db.query('UPDATE users SET totp_secret = $2, totp_last_step = NULL WHERE id = $1', [user.id, secretBox.seal(secret)]);
      res.json({ secret, otpauthUri: otpauthUri(secret, user.username) });
    } catch (err) {
      next(err);
    }
  });

  // Step 2: a correct code turns it on and returns the backup codes, shown only this once.
  router.post('/auth/totp/enable', ...guard, async (req, res, next) => {
    const client = await db.connect();
    try {
      const parsed = enableSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'invalid_payload' });
      const user = await currentUser(req);
      if (!user.totp_secret || user.totp_enabled_at) return res.status(400).json({ error: 'no_pending_setup' });
      const check = checkTotp(secretBox.open(user.totp_secret), parsed.data.code.trim(), { now: now(), lastStep: null });
      if (!check.ok) return res.status(400).json({ error: 'invalid_code' });

      const backupCodes = generateBackupCodes();
      await client.query('BEGIN');
      await client.query('UPDATE users SET totp_enabled_at = now(), totp_last_step = $2 WHERE id = $1', [user.id, check.step]);
      await client.query('DELETE FROM totp_backup_codes WHERE user_id = $1', [user.id]);
      for (const c of backupCodes) {
        await client.query('INSERT INTO totp_backup_codes (code_hash, user_id) VALUES ($1, $2)', [hashBackupCode(c), user.id]);
      }
      await audit(client, { event: 'totp_enabled', actor: user.username, ip: req.ip });
      await client.query('COMMIT');
      res.json({ backupCodes });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      next(err);
    } finally {
      client.release();
    }
  });

  // Turning it off needs the password and a code, so a stolen session alone cannot remove it.
  router.post('/auth/totp/disable', ...guard, async (req, res, next) => {
    try {
      const parsed = disableSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'invalid_payload' });
      const user = await currentUser(req);
      if (!user.totp_enabled_at) return res.status(400).json({ error: 'not_enabled' });
      const passwordOk = await verifyPassword(user.password_hash, parsed.data.password);
      const codeOk = passwordOk && (await verifySecondFactor(db, user, parsed.data.code, now(), secretBox));
      if (!passwordOk || !codeOk) return res.status(403).json({ error: 'invalid_credentials' });

      await db.query(
        'UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = $1',
        [user.id],
      );
      await db.query('DELETE FROM totp_backup_codes WHERE user_id = $1', [user.id]);
      await audit(db, { event: 'totp_disabled', actor: user.username, ip: req.ip });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
