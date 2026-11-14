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
  // Whether the phone takes replies: the switch is on, it may send texts, and practice mode (which
  // receives and checks replies but never sends). Optional: older phones report SIMs only.
  replies: z.object({ on: z.boolean(), permission: z.boolean(), practice: z.boolean() }).optional(),
});

/** The phone lists its SIMs (and which it allows for replies) and whether it takes replies at all, so the dashboard can offer a choice or say why not. */
export function simsRouter({ db, events, preAuthRateLimit = { limit: 600, windowMs: 60000 } }) {
  const router = Router();
  const perIp = rateLimit({ ...preAuthRateLimit, key: (req) => req.ip });

  router.put('/sims', perIp, authenticateDevice({ db }), express.json({ limit: '10kb' }), async (req, res, next) => {
    try {
      const parsed = simsSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'invalid_payload' });
      const { sims, replies = null } = parsed.data;
      await db.query('UPDATE devices SET sims = $2 WHERE device_id = $1', [req.deviceId, JSON.stringify({ sims, replies })]);
      events?.publish('device_sims', { deviceId: req.deviceId, sims, replies });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
