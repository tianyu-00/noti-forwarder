import { createHash } from 'node:crypto';

// Device tokens are long random strings, so a fast hash is sufficient at rest.
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}
