import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { requireCsrf } from '../auth/sessions.js';
import { getRetentionDays, setRetentionDays, purgeOldMessages } from '../retention.js';

const settingsSchema = z.object({
  retentionDays: z.number().int().min(1).max(3650).nullable(),
});

export function settingsRouter({ db, requireViewer }) {
  const router = Router();

  router.get('/settings', requireViewer, async (req, res, next) => {
    try {
      res.json({ retentionDays: await getRetentionDays(db) });
    } catch (err) {
      next(err);
    }
  });

  router.put('/settings', requireViewer, requireCsrf, express.json({ limit: '10kb' }), async (req, res, next) => {
    try {
      const parsed = settingsSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'invalid_payload' });
      await setRetentionDays(db, parsed.data.retentionDays);
      const purged = await purgeOldMessages(db);
      await audit(db, { event: 'settings', actor: req.session.username, ip: req.ip });
      res.json({ retentionDays: parsed.data.retentionDays, purged });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
