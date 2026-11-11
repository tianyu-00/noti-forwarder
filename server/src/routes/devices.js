import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { requireCsrf } from '../auth/sessions.js';

const renameSchema = z.object({ name: z.string().min(1).max(100) });

function toApi(row) {
  return {
    deviceId: row.device_id,
    name: row.name,
    model: row.model,
    appVersion: row.app_version,
    pairedAt: row.paired_at.toISOString(),
    lastSeen: row.last_seen ? row.last_seen.toISOString() : null,
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
  };
}

// token_hash is never selected, so it cannot leak through this router.
const COLUMNS = 'device_id, name, model, app_version, paired_at, last_seen, revoked_at';

export function devicesRouter({ db, requireViewer }) {
  const router = Router();

  router.get('/devices', requireViewer, async (req, res, next) => {
    try {
      const { rows } = await db.query(`SELECT ${COLUMNS} FROM devices ORDER BY paired_at DESC`);
      res.json({ devices: rows.map(toApi) });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/devices/:id', requireViewer, requireCsrf, express.json({ limit: '10kb' }), async (req, res, next) => {
    try {
      const parsed = renameSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'invalid_payload' });
      const { rows } = await db.query(
        `UPDATE devices SET name = $2 WHERE device_id = $1 RETURNING ${COLUMNS}`,
        [req.params.id, parsed.data.name],
      );
      if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
      res.json(toApi(rows[0]));
    } catch (err) {
      next(err);
    }
  });

  // Revoking keeps the device row and its messages; only the token stops working.
  router.delete('/devices/:id', requireViewer, requireCsrf, async (req, res, next) => {
    try {
      const revoked = await db.query(
        'UPDATE devices SET revoked_at = now() WHERE device_id = $1 AND revoked_at IS NULL',
        [req.params.id],
      );
      if (revoked.rowCount === 1) {
        await audit(db, { event: 'revoke', actor: req.session.username, deviceId: req.params.id, ip: req.ip });
      } else {
        const exists = await db.query('SELECT 1 FROM devices WHERE device_id = $1', [req.params.id]);
        if (exists.rowCount === 0) return res.status(404).json({ error: 'not_found' });
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
