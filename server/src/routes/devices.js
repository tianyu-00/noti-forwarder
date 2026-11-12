import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { audit } from '../audit.js';
import { requireCsrf } from '../auth/sessions.js';
import { deviceToApi, DEVICE_COLUMNS } from '../serializers.js';

const renameSchema = z.object({ name: z.string().min(1).max(100) });

const toApi = deviceToApi;
const COLUMNS = DEVICE_COLUMNS;

export function devicesRouter({ db, requireViewer, events }) {
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
      events.publish('device', toApi(rows[0]));
      res.json(toApi(rows[0]));
    } catch (err) {
      next(err);
    }
  });

  // Revoking keeps the device row and its messages; only the token stops working.
  router.delete('/devices/:id', requireViewer, requireCsrf, async (req, res, next) => {
    try {
      const revoked = await db.query(
        `UPDATE devices SET revoked_at = now()
          WHERE device_id = $1 AND revoked_at IS NULL
        RETURNING ${COLUMNS}`,
        [req.params.id],
      );
      if (revoked.rowCount === 1) {
        events.publish('device', toApi(revoked.rows[0]));
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

  // Clearing removes a phone's messages but leaves the phone paired and sending, so it works
  // without revoking. The audit log records the count, never any text.
  router.delete('/devices/:id/messages', requireViewer, requireCsrf, async (req, res, next) => {
    try {
      const exists = await db.query('SELECT 1 FROM devices WHERE device_id = $1', [req.params.id]);
      if (exists.rowCount === 0) return res.status(404).json({ error: 'not_found' });
      const result = await db.query('DELETE FROM messages WHERE device_id = $1', [req.params.id]);
      await audit(db, { event: 'clear_messages', actor: req.session.username, deviceId: req.params.id, ip: req.ip });
      events.publish('messages_cleared', { deviceId: req.params.id });
      res.json({ deleted: result.rowCount });
    } catch (err) {
      next(err);
    }
  });

  // Erasing removes a revoked phone and every message it sent. Irreversible, so the phone
  // must be revoked first (it can no longer be sending). The audit log keeps the record.
  router.delete('/devices/:id/permanent', requireViewer, requireCsrf, async (req, res, next) => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query('SELECT revoked_at FROM devices WHERE device_id = $1 FOR UPDATE', [req.params.id]);
      if (found.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'not_found' });
      }
      if (!found.rows[0].revoked_at) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'not_revoked' });
      }
      await client.query('DELETE FROM messages WHERE device_id = $1', [req.params.id]);
      await client.query('DELETE FROM pairing_codes WHERE device_id = $1', [req.params.id]);
      await client.query('DELETE FROM devices WHERE device_id = $1', [req.params.id]);
      await audit(client, { event: 'erase', actor: req.session.username, deviceId: req.params.id, ip: req.ip });
      await client.query('COMMIT');
      events.publish('device_deleted', { deviceId: req.params.id });
      res.status(204).end();
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      next(err);
    } finally {
      client.release();
    }
  });

  return router;
}
