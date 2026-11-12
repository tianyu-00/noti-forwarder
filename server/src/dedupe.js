import { createHash } from 'node:crypto';

/**
 * Identifies "the same notification delivered twice": same phone, app, sender and text at the
 * same instant on the phone (to the millisecond). Text that repeats later is a new message, so
 * a code or a missed call that arrives twice is stored twice.
 */
export function dedupeHash({ deviceId, app, sender, body, receivedAt }) {
  const instant = new Date(receivedAt).getTime();
  // JSON encoding keeps field boundaries unambiguous.
  const input = JSON.stringify([deviceId, app, sender, body, instant]);
  return createHash('sha256').update(input).digest('hex');
}
