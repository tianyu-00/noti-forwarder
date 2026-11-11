import express from 'express';
import helmet from 'helmet';
import { messagesRouter } from './routes/messages.js';

export function createApp({ version, commit, buildTime, db, messageRateLimit }) {
  const app = express();
  app.use(helmet());

  app.get('/api/v1/health', (req, res) => {
    res.json({ version, commit, buildTime });
  });

  if (db) app.use('/api/v1', messagesRouter({ db, messageRateLimit }));

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
