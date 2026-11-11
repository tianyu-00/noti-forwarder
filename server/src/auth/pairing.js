import { randomBytes } from 'node:crypto';
import { hashToken } from './tokens.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const PAIRING_TTL_MS = 10 * 60 * 1000;

// 17 random bytes = 136 bits, shown as 28 base32 characters in groups of 4.
export function generatePairingCode() {
  const bytes = randomBytes(17);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return out.match(/.{1,4}/g).join('-');
}

// People type codes in any case, with or without dashes.
export function normalizeCode(code) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashCode(code) {
  return hashToken(normalizeCode(code));
}
