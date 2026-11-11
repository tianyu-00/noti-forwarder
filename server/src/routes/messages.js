import { Router } from 'express';
import express from 'express';
import { authenticateDevice } from '../auth/device-auth.js';
import { dedupeHash } from '../dedupe.js';
import { postMessagesSchema } from '../schemas.js';

export function messagesRouter({ db }) {
  const router = Router();

  router.post('/messages', authenticateDevice({ db }), express.json(), async (req, res, next) => {
    try {
      const parsed = postMessagesSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'invalid_payload' });
      }
      const incoming = parsed.data.messages;
      let stored = 0;
      // ON CONFLICT DO NOTHING covers both a retried id and a repeated dedupe_hash.
      for (const m of incoming) {
        const hash = dedupeHash({
          deviceId: req.deviceId,
          app: m.app,
          sender: m.sender,
          body: m.body,
          receivedAt: m.receivedAt,
        });
        const result = await db.query(
          `INSERT INTO messages (id, device_id, type, app, sender, body, received_at, dedupe_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT DO NOTHING`,
          [m.id, req.deviceId, m.type, m.app, m.sender, m.body, m.receivedAt, hash],
        );
        stored += result.rowCount;
      }
      res.status(201).json({ stored, duplicates: incoming.length - stored });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
