import { z } from 'zod';
import { isEncrypted } from './e2e.js';

// Encrypted text is longer than the text it hides (nonce, tag, base64), so it gets more room.
const SENDER_PLAIN_MAX = 500;
const SENDER_ENCRYPTED_MAX = 1500;
const BODY_PLAIN_MAX = 20000;
const BODY_ENCRYPTED_MAX = 30000;

const messageSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['sms', 'notification']),
  app: z.string().min(1).max(255),
  // The app's real name as the phone shows it. Optional: older phones do not send it.
  appLabel: z.string().max(255).optional(),
  sender: z
    .string()
    .max(SENDER_ENCRYPTED_MAX)
    .refine((v) => isEncrypted(v) || v.length <= SENDER_PLAIN_MAX)
    .default(''),
  body: z
    .string()
    .max(BODY_ENCRYPTED_MAX)
    .refine((v) => isEncrypted(v) || v.length <= BODY_PLAIN_MAX),
  receivedAt: z.string().datetime({ offset: true }),
});

export const postMessagesSchema = z.object({
  messages: z.array(messageSchema).max(500),
});

// Cursor = base64url("<received_at, microsecond precision>|<id>").
const CURSOR_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
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
