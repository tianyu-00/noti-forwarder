import { z } from 'zod';

const messageSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['sms', 'notification']),
  app: z.string().min(1).max(255),
  sender: z.string().max(500).default(''),
  body: z.string().max(20000),
  receivedAt: z.string().datetime({ offset: true }),
});

export const postMessagesSchema = z.object({
  messages: z.array(messageSchema).max(500),
});

// Cursor = base64url("<received_at, microsecond precision>|<id>").
const CURSOR_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(ts, id) {
  return Buffer.from(`${ts}|${id}`).toString('base64url');
}

export function decodeCursor(cursor) {
  const [ts, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  return CURSOR_TS.test(ts ?? '') && UUID.test(id ?? '') ? { ts, id } : null;
}

export const getMessagesQuerySchema = z.object({
  device: z.string().max(100).optional(),
  type: z.enum(['sms', 'notification']).optional(),
  app: z.string().max(255).optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z
    .string()
    .max(200)
    .refine((c) => decodeCursor(c) !== null)
    .optional(),
});
