import { Router } from 'express';
import express from 'express';
import { authenticateDevice } from '../auth/device-auth.js';
import { dedupeHash } from '../dedupe.js';
import { postMessagesSchema, getMessagesQuerySchema, encodeCursor, decodeCursor } from '../schemas.js';
import { rateLimit } from '../rate-limit.js';
import { messageToApi } from '../serializers.js';

// Secure by default: until dashboard sessions exist (milestone 1b), viewers get 401.
function denyViewers(req, res) {
  res.status(401).json({ error: 'unauthorized' });
}

const toApi = messageToApi;

function escapeLike(text) {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function messagesRouter({
  db,
  requireViewer = denyViewers,
  events,
  notifier,
  messageRateLimit = { limit: 120, windowMs: 60000 },
  // Before the token check, per IP: bad-token guessing must not cost a database write each time.
  // Generous, because several phones can share one home IP.
  preAuthRateLimit = { limit: 600, windowMs: 60000 },
}) {
  const router = Router();
  const perIp = rateLimit({ ...preAuthRateLimit, key: (req) => req.ip });
  const perDevice = rateLimit({ ...messageRateLimit, key: (req) => req.deviceId });

  router.post('/messages', perIp, authenticateDevice({ db }), perDevice, express.json({ limit: '2mb' }), async (req, res, next) => {
    try {
      const parsed = postMessagesSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'invalid_payload' });
      }
      const incoming = parsed.data.messages;
      let stored = 0;
      const storedMessages = [];
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
           ON CONFLICT DO NOTHING
           RETURNING *`,
          [m.id, req.deviceId, m.type, m.app, m.sender, m.body, m.receivedAt, hash],
        );
        stored += result.rowCount;
        // Only newly stored messages are pushed; duplicates stay silent.
        if (result.rowCount === 1) {
          const apiMessage = toApi(result.rows[0]);
          storedMessages.push(apiMessage);
          events.publish('message', apiMessage);
        }
      }
      res.status(201).json({ stored, duplicates: incoming.length - stored });
      // After the phone has its answer, and never awaited: a slow or broken push must not
      // delay the phone, make it retry, or lose anything that is already stored.
      if (notifier && storedMessages.length > 0) {
        try {
          Promise.resolve(notifier.notify(storedMessages, req.deviceName)).catch(() => {});
        } catch {
          // swallowed on purpose; the notifier logs its own failures without message text
        }
      }
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
