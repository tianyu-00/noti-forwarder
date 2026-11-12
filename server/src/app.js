import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { messagesRouter } from './routes/messages.js';
import { authRouter } from './routes/auth.js';
import { pairingRouter } from './routes/pairing.js';
import { devicesRouter } from './routes/devices.js';
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
  notifier,
  loginRateLimit,
  cookieSecure,
  trustProxy,
  publicUrl,
  pairRateLimit,
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
    app.use('/api/v1', authRouter({ db, requireViewer: viewer, cookieSecure, loginRateLimit }));
    app.use('/api/v1', pairingRouter({ db, requireViewer: viewer, events, publicUrl, pairRateLimit }));
    app.use('/api/v1', devicesRouter({ db, requireViewer: viewer, events }));
    app.use('/api/v1', messagesRouter({ db, requireViewer: viewer, events, notifier, messageRateLimit }));
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
