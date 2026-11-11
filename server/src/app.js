import express from 'express';
import helmet from 'helmet';
import { messagesRouter } from './routes/messages.js';

export function createApp({ version, commit, buildTime, db }) {
  const app = express();
  app.use(helmet());

  app.get('/api/v1/health', (req, res) => {
    res.json({ version, commit, buildTime });
  });

  if (db) app.use('/api/v1', messagesRouter({ db }));

  app.use((req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  return app;
}
