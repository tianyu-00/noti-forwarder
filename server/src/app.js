import express from 'express';

export function createApp({ version, commit, buildTime }) {
  const app = express();

  app.get('/api/v1/health', (req, res) => {
    res.json({ version, commit, buildTime });
  });

  return app;
}
