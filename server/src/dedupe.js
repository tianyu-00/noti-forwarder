import { createHash } from 'node:crypto';

export function dedupeHash({ deviceId, app, sender, body, receivedAt }) {
  const minute = Math.floor(new Date(receivedAt).getTime() / 60000);
  // JSON encoding keeps field boundaries unambiguous.
  const input = JSON.stringify([deviceId, app, sender, body, minute]);
  return createHash('sha256').update(input).digest('hex');
}
