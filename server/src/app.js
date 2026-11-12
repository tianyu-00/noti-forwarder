import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { messagesRouter } from './routes/messages.js';
import { heartbeatRouter } from './routes/heartbeat.js';
import { deviceStreamRouter } from './routes/device-stream.js';
import { createPresence } from './presence.js';
import { authRouter } from './routes/auth.js';
import { pairingRouter } from './routes/pairing.js';
import { devicesRouter } from './routes/devices.js';
import { settingsRouter } from './routes/settings.js';
import { streamRouter } from './routes/stream.js';
import { createEventHub } from './events.js';
import { requireSession } from './auth/sessions.js';

export function createApp({
  version,
  commit,
  buildTime,
  db,
  requireViewer,
  messageRateLimit,
  preAuthRateLimit,
  notifier,
  loginRateLimit,
  now,
  cookieSecure,
  trustProxy,
  publicUrl,
  pairRateLimit,
  secretBox,
  silentAfterMinutes = 0,
  // A phone that loses its network never closes its connection, so it must check in (the app
  // does, every 25 s). Silent for this long means gone. The sweep runs often to notice it quickly.
  presenceTimeoutMs = 60000,
  presenceSweepMs = 10000,
}) {
  const app = express();
  if (trustProxy !== undefined) app.set('trust proxy', trustProxy);
  app.use(helmet());
  app.use(cookieParser());

  app.get('/api/v1/health', (req, res) => {
    res.json({ version, commit, buildTime });
  });

  if (db) {
    const viewer = requireViewer ?? requireSession({ db });
    const events = createEventHub();
    // Who holds a connection right now. Going on or offline refreshes "last seen" and tells open
    // dashboards, so the green dot is exact.
    const presence = createPresence({
      onChange: (deviceId, connected) => {
        db.query('UPDATE devices SET last_seen = now() WHERE device_id = $1 RETURNING last_seen', [deviceId])
          .then(({ rows }) => {
            if (rows[0]) events.publish('device_presence', { deviceId, connected, lastSeen: rows[0].last_seen.toISOString() });
          })
          .catch(() => {}); // never let a bookkeeping failure break a connection
      },
    });
    app.locals.presence = presence; // the silent-phone monitor reads it
    setInterval(() => presence.dropStale(presenceTimeoutMs), presenceSweepMs).unref();
    app.use('/api/v1', authRouter({ db, requireViewer: viewer, cookieSecure, loginRateLimit, now, secretBox }));
    app.use('/api/v1', pairingRouter({ db, requireViewer: viewer, events, publicUrl, pairRateLimit }));
    app.use('/api/v1', devicesRouter({ db, requireViewer: viewer, events, presence, silentAfterMinutes }));
    app.use('/api/v1', settingsRouter({ db, requireViewer: viewer }));
    app.use('/api/v1', messagesRouter({ db, requireViewer: viewer, events, notifier, messageRateLimit, preAuthRateLimit }));
    app.use('/api/v1', heartbeatRouter({ db, events, presence, preAuthRateLimit }));
    app.use('/api/v1', deviceStreamRouter({ db, events, presence, preAuthRateLimit }));
    app.use('/api/v1', streamRouter({ requireViewer: viewer, events }));
  }

  app.use((req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_payload' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
    // Never log request bodies: they contain private message content.
    console.error('unhandled error:', err.message);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
