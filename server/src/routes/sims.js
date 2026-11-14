import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { authenticateDevice } from '../auth/device-auth.js';
import { rateLimit } from '../rate-limit.js';

const simsSchema = z.object({
  sims: z
    .array(
      z.object({
        id: z.number().int().min(0), // the phone's own number for the SIM (subscription id)
        slot: z.number().int().min(0).max(20),
        name: z.string().max(100), // carrier name, never a phone number
        allowed: z.boolean(), // whether the phone lets replies go out on this SIM
      }),
    )
    .max(8),
});

/** The phone lists its SIMs and which of them it allows for replies, so the dashboard can offer a choice. */
export function simsRouter({ db, events, preAuthRateLimit = { limit: 600, windowMs: 60000 } }) {
  const router = Router();
  const perIp = rateLimit({ ...preAuthRateLimit, key: (req) => req.ip });

  router.put('/sims', perIp, authenticateDevice({ db }), express.json({ limit: '10kb' }), async (req, res, next) => {
    try {
      const parsed = simsSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'invalid_payload' });
      const { sims } = parsed.data;
      await db.query('UPDATE devices SET sims = $2 WHERE device_id = $1', [req.deviceId, JSON.stringify(sims)]);
      events?.publish('device_sims', { deviceId: req.deviceId, sims });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
