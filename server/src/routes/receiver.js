import { Router } from 'express';
import { z } from 'zod';
import { authenticateDevice, requireRole } from '../auth/device-auth.js';
import { rateLimit } from '../rate-limit.js';
import { messageToApi } from '../serializers.js';

const PING_MS = 25000;
// What a receiver is told about. Never which phones are online, their SIMs or their replies: that is
// dashboard business. Message text stays encrypted when the phone paired with a key.
const RECEIVER_EVENTS = new Set(['message', 'messages_cleared', 'messages_cleared_all', 'device_deleted', 'messages_purged']);
const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) });

/**
 * The main phone's side: the recent messages, and a live stream of new ones and of deletions, so its
 * list can mirror the dashboard. Only a receiver token may use these, and a receiver token cannot send.
 */
export function receiverRouter({ db, events, presence, preAuthRateLimit = { limit: 600, windowMs: 60000 } }) {
  const router = Router();
  const perIp = rateLimit({ ...preAuthRateLimit, key: (req) => req.ip });
  const guard = [perIp, authenticateDevice({ db }), requireRole('receiver')];

  router.get('/receiver/messages', ...guard, async (req, res, next) => {
    try {
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ error: 'invalid_query' });
      const { rows } = await db.query('SELECT * FROM messages ORDER BY received_at DESC, id DESC LIMIT $1', [parsed.data.limit]);
      res.json({ messages: rows.map(messageToApi) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/receiver/stream', ...guard, (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(': connected\n\n');

    const write = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    // While it is open the receiver counts as connected, and a revoke reaches it at once.
    const release = presence.connect(req.deviceId, { send: write, close: () => res.end() });
    const unsubscribe = events.subscribe(({ type, data }) => {
      if (RECEIVER_EVENTS.has(type)) write(type, data);
    });
    const ping = setInterval(() => res.write(': ping\n\n'), PING_MS);
    res.on('close', () => {
      clearInterval(ping);
      unsubscribe();
      release();
    });
  });

  return router;
}
