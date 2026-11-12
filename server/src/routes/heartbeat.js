import { Router } from 'express';
import { authenticateDevice } from '../auth/device-auth.js';
import { rateLimit } from '../rate-limit.js';

// A phone with nothing to send still checks in, so the dashboard can tell a quiet phone from a
// dead one. Authenticating already records "last seen" and the app version; nothing else is kept.
export function heartbeatRouter({ db, events, presence, preAuthRateLimit = { limit: 600, windowMs: 60000 } }) {
  const router = Router();
  const perIp = rateLimit({ ...preAuthRateLimit, key: (req) => req.ip });

  router.post('/heartbeat', perIp, authenticateDevice({ db }), (req, res) => {
    presence?.touch(req.deviceId); // proof of life for a phone that holds its connection
    // Open dashboards update the phone's "last seen" (and clear a "quiet" label) without a reload.
    events?.publish('device_seen', { deviceId: req.deviceId, lastSeen: new Date().toISOString() });
    res.status(204).end();
  });

  return router;
}
