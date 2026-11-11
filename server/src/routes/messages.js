import { Router } from 'express';
import express from 'express';
import { authenticateDevice } from '../auth/device-auth.js';
import { dedupeHash } from '../dedupe.js';
import { postMessagesSchema, getMessagesQuerySchema, encodeCursor, decodeCursor } from '../schemas.js';
import { rateLimit } from '../rate-limit.js';

// Secure by default: until dashboard sessions exist (milestone 1b), viewers get 401.
function denyViewers(req, res) {
  res.status(401).json({ error: 'unauthorized' });
}

function toApi(row) {
  return {
    id: row.id,
    deviceId: row.device_id,
    type: row.type,
    app: row.app,
    sender: row.sender,
    body: row.body,
    receivedAt: row.received_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

function escapeLike(text) {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function messagesRouter({
  db,
  requireViewer = denyViewers,
  messageRateLimit = { limit: 120, windowMs: 60000 },
}) {
  const router = Router();
  const perDevice = rateLimit({ ...messageRateLimit, key: (req) => req.deviceId });

  router.post('/messages', authenticateDevice({ db }), perDevice, express.json({ limit: '2mb' }), async (req, res, next) => {
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

  router.get('/messages', requireViewer, async (req, res, next) => {
    try {
      const parsed = getMessagesQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: 'invalid_query' });
      }
      const { device, type, app, q, limit, before } = parsed.data;
      const where = [];
      const params = [];
      const bind = (value) => {
        params.push(value);
        return `$${params.length}`;
      };

      if (device) where.push(`device_id = ${bind(device)}`);
      if (type) where.push(`type = ${bind(type)}`);
      if (app) where.push(`app = ${bind(app)}`);
      if (q) {
        const like = bind(`%${escapeLike(q)}%`);
        where.push(`(body ILIKE ${like} OR sender ILIKE ${like} OR app ILIKE ${like})`);
      }
      if (before) {
        const { ts, id } = decodeCursor(before);
        where.push(`(received_at, id) < (${bind(ts)}::timestamptz, ${bind(id)}::uuid)`);
      }

      const { rows } = await db.query(
        `SELECT *, to_char(received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS received_at_us
           FROM messages ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY received_at DESC, id DESC
          LIMIT ${bind(limit + 1)}`,
        params,
      );
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      res.json({
        messages: page.map(toApi),
        nextBefore: rows.length > limit ? encodeCursor(last.received_at_us, last.id) : null,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
