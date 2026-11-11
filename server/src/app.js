import express from 'express';
import helmet from 'helmet';

export function createApp({ version, commit, buildTime }) {
  const app = express();
  app.use(helmet());

  app.get('/api/v1/health', (req, res) => {
    res.json({ version, commit, buildTime });
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  return app;
}
