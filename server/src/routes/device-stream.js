import { Router } from 'express';
import { audit } from '../audit.js';
import { authenticateDevice } from '../auth/device-auth.js';
import { rateLimit } from '../rate-limit.js';
import { DEVICE_COLUMNS, deviceToApi } from '../serializers.js';

// Comment frames keep the connection alive through proxies (Cloudflare drops silent ones
// after about 100 seconds) and let a dead socket be noticed.
const PING_MS = 25000;

/**
 * The phone's own connection to the server, like the dashboard's live stream. While it is open
 * the phone is "connected" (exact, not guessed from the last message), and the server can tell
 * the phone at once that it was revoked. The phone also unpairs itself here.
 */
export function deviceStreamRouter({ db, events, presence, preAuthRateLimit = { limit: 600, windowMs: 60000 } }) {
  const router = Router();
  const perIp = rateLimit({ ...preAuthRateLimit, key: (req) => req.ip });

  router.get('/device-stream', perIp, authenticateDevice({ db }), (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(': connected\n\n');

    const connection = {
      send: (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
      close: () => res.end(),
    };
    const release = presence.connect(req.deviceId, connection);
    const ping = setInterval(() => res.write(': ping\n\n'), PING_MS);
    res.on('close', () => {
      clearInterval(ping);
      release();
    });
  });

  // The phone's "Unpair" button: same effect as revoking it in the dashboard, but immediate.
  router.post('/unpair', perIp, authenticateDevice({ db }), async (req, res, next) => {
    try {
      const revoked = await db.query(
        `UPDATE devices SET revoked_at = now() WHERE device_id = $1 AND revoked_at IS NULL
         RETURNING ${DEVICE_COLUMNS}`,
        [req.deviceId],
      );
      if (revoked.rowCount === 1) {
        events.publish('device', deviceToApi(revoked.rows[0]));
        await audit(db, { event: 'unpair', actor: 'phone', deviceId: req.deviceId, ip: req.ip });
      }
      presence.revoke(req.deviceId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
