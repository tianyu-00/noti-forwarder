import { Router } from 'express';
import express from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { audit } from '../audit.js';
import { generatePairingCode, hashCode, PAIRING_TTL_MS } from '../auth/pairing.js';
import { requireCsrf } from '../auth/sessions.js';
import { hashToken } from '../auth/tokens.js';
import { rateLimit } from '../rate-limit.js';

const pairSchema = z.object({
  code: z.string().min(8).max(100),
  name: z.string().min(1).max(100),
  model: z.string().max(100).optional(),
  appVersion: z.string().max(50).optional(),
});

export function pairingRouter({
  db,
  requireViewer,
  publicUrl = '',
  pairRateLimit = { limit: 10, windowMs: 15 * 60 * 1000 },
}) {
  const router = Router();
  const perIp = rateLimit({ ...pairRateLimit, key: (req) => req.ip });

  router.post('/pairing-codes', requireViewer, requireCsrf, async (req, res, next) => {
    try {
      const code = generatePairingCode();
      const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
      await db.query('INSERT INTO pairing_codes (code_hash, expires_at) VALUES ($1, $2)', [
        hashCode(code),
        expiresAt,
      ]);
      res.status(201).json({
        code,
        expiresAt: expiresAt.toISOString(),
        qrPayload: JSON.stringify({ u: publicUrl, c: code }),
      });
    } catch (err) {
      next(err);
    }
  });

  // No auth: the single-use, short-lived code is the credential.
  router.post('/pair', perIp, express.json({ limit: '10kb' }), async (req, res, next) => {
    const parsed = pairSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_payload' });
    const { code, name, model, appVersion } = parsed.data;

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      // The row lock makes the burn atomic, so concurrent requests cannot both win.
      const burned = await client.query(
        `UPDATE pairing_codes SET used_at = now()
          WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
        RETURNING code_hash`,
        [hashCode(code)],
      );
      if (burned.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'invalid_code' });
      }

      const deviceId = randomUUID();
      const token = randomBytes(32).toString('base64url');
      await client.query(
        `INSERT INTO devices (device_id, name, model, app_version, token_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [deviceId, name, model ?? null, appVersion ?? null, hashToken(token)],
      );
      await client.query('UPDATE pairing_codes SET device_id = $2 WHERE code_hash = $1', [
        hashCode(code),
        deviceId,
      ]);
      await client.query('COMMIT');

      await audit(db, { event: 'pair', deviceId, ip: req.ip });
      res.status(201).json({ deviceId, token });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      next(err);
    } finally {
      client.release();
    }
  });

  return router;
}
