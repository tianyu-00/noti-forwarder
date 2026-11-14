import { Router } from 'express';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { audit } from '../audit.js';
import { requireCsrf } from '../auth/sessions.js';
import { authenticateDevice } from '../auth/device-auth.js';
import { rateLimit } from '../rate-limit.js';
import { isEncrypted } from '../e2e.js';
import { outboxToApi } from '../serializers.js';

const PHONE_NUMBER = /^\+?[0-9][0-9 ()\-.]{2,31}$/;
const MAX_TEXT = 1600; // plain text; an encrypted value is longer than its text, so only its size is capped
const MAX_SEALED = 4000;

const createSchema = z.object({
  deviceId: z.string().uuid(),
  // Which of the phone's SIMs sends it (chosen on the dashboard). Optional: the phone decides without one.
  sim: z.number().int().min(0).optional(),
  to: z.string().max(300).refine((v) => isEncrypted(v) || PHONE_NUMBER.test(v)),
  body: z
    .string()
    .min(1)
    .max(MAX_SEALED)
    .refine((v) => isEncrypted(v) || v.length <= MAX_TEXT),
});
const resultSchema = z.object({
  status: z.enum(['sent', 'failed']),
  // A short code such as "no_permission", never text.
  error: z.string().regex(/^[a-z_]{1,40}$/).optional(),
});

/**
 * Replies from the dashboard. The dashboard queues one; the phone fetches what is waiting (and is
 * told at once while connected), sends the SMS, and reports back. The server only stores and
 * forwards: it never logs a number or text.
 */
export function outboxRouter({
  db,
  requireViewer,
  events,
  presence,
  outboxRateLimit = { limit: 30, windowMs: 60000 },
  // A reply the phone could not collect in this time is not sent late: it fails as "expired".
  outboxMaxAgeMs = 60 * 60 * 1000,
  preAuthRateLimit = { limit: 600, windowMs: 60000 },
}) {
  const router = Router();
  const perViewer = rateLimit({ ...outboxRateLimit, key: (req) => req.session?.username ?? req.ip });
  const perIp = rateLimit({ ...preAuthRateLimit, key: (req) => req.ip });

  async function expireStale() {
    const { rows } = await db.query(
      `UPDATE outbox SET status = 'failed', error = 'expired'
        WHERE status = 'queued' AND created_at < $1
      RETURNING *`,
      [new Date(Date.now() - outboxMaxAgeMs)],
    );
    for (const row of rows) events.publish('outbox', outboxToApi(row));
  }

  router.post('/outbox', requireViewer, requireCsrf, perViewer, express.json({ limit: '20kb' }), async (req, res, next) => {
    try {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'invalid_payload' });
      const { deviceId, to, body, sim } = parsed.data;
      const device = await db.query('SELECT revoked_at FROM devices WHERE device_id = $1', [deviceId]);
      if (device.rowCount === 0) return res.status(404).json({ error: 'not_found' });
      if (device.rows[0].revoked_at) return res.status(409).json({ error: 'device_revoked' });

      const { rows } = await db.query(
        'INSERT INTO outbox (id, device_id, recipient, body, sim) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [randomUUID(), deviceId, to, body, sim ?? null],
      );
      const item = outboxToApi(rows[0]);
      await audit(db, { event: 'reply', actor: req.session.username, deviceId, ip: req.ip });
      events.publish('outbox', item);
      presence.send(deviceId, 'outbox', item); // a phone that is offline asks again when it is back
      res.status(201).json(item);
    } catch (err) {
      next(err);
    }
  });

  router.get('/outbox', requireViewer, async (req, res, next) => {
    try {
      await expireStale();
      const device = typeof req.query.device === 'string' ? req.query.device : null;
      const { rows } = await db.query(
        `SELECT * FROM outbox ${device ? 'WHERE device_id = $1' : ''} ORDER BY created_at DESC, id DESC LIMIT 500`,
        device ? [device] : [],
      );
      res.json({ replies: rows.map(outboxToApi) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/outbox/pending', perIp, authenticateDevice({ db }), async (req, res, next) => {
    try {
      await expireStale();
      const { rows } = await db.query(
        "SELECT * FROM outbox WHERE device_id = $1 AND status = 'queued' ORDER BY created_at, id",
        [req.deviceId],
      );
      res.json({ replies: rows.map(outboxToApi) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/outbox/:id/result', perIp, authenticateDevice({ db }), express.json({ limit: '2kb' }), async (req, res, next) => {
    try {
      const parsed = resultSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'invalid_payload' });
      const { status, error } = parsed.data;
      const found = await db.query('SELECT * FROM outbox WHERE id = $1 AND device_id = $2', [req.params.id.toLowerCase(), req.deviceId]);
      if (found.rowCount === 0) return res.status(404).json({ error: 'not_found' });

      // Only a queued reply changes; a repeated report is answered with what already stands.
      const updated = await db.query(
        `UPDATE outbox SET status = $2, error = $3, sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE NULL END
          WHERE id = $1 AND status = 'queued'
        RETURNING *`,
        [found.rows[0].id, status, status === 'failed' ? (error ?? 'failed') : null],
      );
      if (updated.rowCount === 0) return res.json(outboxToApi(found.rows[0]));
      const item = outboxToApi(updated.rows[0]);
      events.publish('outbox', item);
      res.json(item);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
