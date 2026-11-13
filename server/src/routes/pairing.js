import { Router } from 'express';
import express from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { audit } from '../audit.js';
import { generatePairingCode, hashCode, PAIRING_TTL_MS } from '../auth/pairing.js';
import { requireCsrf } from '../auth/sessions.js';
import { hashToken } from '../auth/tokens.js';
import { rateLimit } from '../rate-limit.js';
import { deviceToApi, DEVICE_COLUMNS } from '../serializers.js';

const pairSchema = z.object({
  code: z.string().min(8).max(100),
  name: z.string().min(1).max(100),
  model: z.string().max(100).optional(),
  appVersion: z.string().max(50).optional(),
  // Stable per-phone id (Android's ANDROID_ID). Optional so older app versions still pair.
  hardwareId: z.string().min(1).max(100).optional(),
});

export function pairingRouter({
  db,
  requireViewer,
  events,
  publicUrl = '',
  pairRateLimit = { limit: 10, windowMs: 15 * 60 * 1000 },
}) {
  const router = Router();
  const perIp = rateLimit({ ...pairRateLimit, key: (req) => req.ip });

  router.post('/pairing-codes', requireViewer, requireCsrf, async (req, res, next) => {
    try {
      const code = generatePairingCode();
      // Both timestamps come from the database clock, the same one that stamps paired_at,
      // so the dashboard can compare them reliably.
      const { rows } = await db.query(
        `INSERT INTO pairing_codes (code_hash, expires_at)
         VALUES ($1, ts_add_ms(now(), $2))
         RETURNING created_at, expires_at`,
        [hashCode(code), PAIRING_TTL_MS],
      );
      res.status(201).json({
        code,
        createdAt: rows[0].created_at.toISOString(),
        expiresAt: rows[0].expires_at.toISOString(),
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
    const { code, name, model, appVersion, hardwareId } = parsed.data;

    try {
      const paired = await db.transaction(async (client) => {
        // The code is burned in the same transaction as the device is made, and transactions run one
        // at a time, so two requests with one code cannot both win.
        const burned = await client.query(
          `UPDATE pairing_codes SET used_at = now()
            WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
          RETURNING code_hash`,
          [hashCode(code)],
        );
        if (burned.rowCount === 0) return null;

        const token = randomBytes(32).toString('base64url');
        // A returning phone (same hardware id) keeps its id, name and messages, gets a new token (the
        // old one stops working) and is un-revoked. Two simultaneous pairings of one phone cannot make
        // two rows, because of the transaction and the unique index.
        const known = hardwareId
          ? await client.query('SELECT 1 FROM devices WHERE hardware_id = $1', [hardwareId])
          : { rowCount: 0 };
        const upserted = await client.query(
          `INSERT INTO devices (device_id, name, model, app_version, token_hash, hardware_id, last_seen)
           VALUES ($1, $2, $3, $4, $5, $6, now())
           ON CONFLICT (hardware_id) WHERE hardware_id IS NOT NULL
           DO UPDATE SET token_hash = EXCLUDED.token_hash,
                         model = COALESCE(EXCLUDED.model, devices.model),
                         app_version = COALESCE(EXCLUDED.app_version, devices.app_version),
                         revoked_at = NULL,
                         paired_at = now(),
                         last_seen = now()
           RETURNING device_id`,
          [randomUUID(), name, model ?? null, appVersion ?? null, hashToken(token), hardwareId ?? null],
        );
        const deviceId = upserted.rows[0].device_id;
        await client.query('UPDATE pairing_codes SET device_id = $2 WHERE code_hash = $1', [hashCode(code), deviceId]);
        return { deviceId, token, inserted: known.rowCount === 0 };
      });
      if (!paired) return res.status(400).json({ error: 'invalid_code' });

      const { deviceId, token, inserted } = paired;
      await audit(db, { event: inserted ? 'pair' : 'repair', deviceId, ip: req.ip });
      const created = await db.query(`SELECT ${DEVICE_COLUMNS} FROM devices WHERE device_id = $1`, [deviceId]);
      events.publish('device', deviceToApi(created.rows[0]));
      res.status(201).json({ deviceId, token });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
