import express, { Router } from 'express';
import { z } from 'zod';
import { authenticateDevice } from '../auth/device-auth.js';
import { rateLimit } from '../rate-limit.js';

// The phone may say how full its battery is. Older versions of the app send no body at all.
const bodySchema = z.object({
  battery: z.object({ percent: z.number().int().min(0).max(100), charging: z.boolean() }).optional(),
});

// A phone with nothing to send still checks in, so the dashboard can tell a quiet phone from a
// dead one. Authenticating already records "last seen" and the app version; the battery level, when the
// phone sends one, is the only other thing kept.
export function heartbeatRouter({ db, events, presence, battery, preAuthRateLimit = { limit: 600, windowMs: 60000 } }) {
  const router = Router();
  const perIp = rateLimit({ ...preAuthRateLimit, key: (req) => req.ip });

  router.post('/heartbeat', perIp, authenticateDevice({ db }), express.json({ limit: '1kb' }), async (req, res, next) => {
    try {
      const parsed = bodySchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: 'invalid_payload' });
      const level = parsed.data.battery;

      if (level) {
        await db.query('UPDATE devices SET battery_percent = $2, battery_charging = $3 WHERE device_id = $1', [
          req.deviceId,
          level.percent,
          level.charging ? 1 : 0,
        ]);
        battery?.observe({ deviceId: req.deviceId, deviceName: req.deviceName, ...level });
      }
      presence?.touch(req.deviceId); // proof of life for a phone that holds its connection
      // Open dashboards update the phone's "last seen" (and clear a "quiet" label) without a reload.
      events?.publish('device_seen', { deviceId: req.deviceId, lastSeen: new Date().toISOString(), ...(level ? { battery: level } : {}) });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
