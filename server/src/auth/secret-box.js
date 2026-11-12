import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';
const MIN_KEY_LENGTH = 32;

/**
 * Encrypts small secrets (the two-step login key) before they go into the database, so a stolen
 * database backup alone does not give an attacker the authenticator secret.
 * AES-256-GCM: a random 12-byte IV per value and an authentication tag, so a changed value or a
 * wrong key fails loudly instead of returning garbage.
 */
export function createSecretBox(secretKey) {
  if (typeof secretKey !== 'string' || secretKey.length < MIN_KEY_LENGTH) {
    throw new Error(`SECRET_KEY must be at least ${MIN_KEY_LENGTH} characters (try: openssl rand -base64 32)`);
  }
  const key = Buffer.from(hkdfSync('sha256', secretKey, 'notiforwarder', 'totp-secret', 32));

  function isSealed(value) {
    return typeof value === 'string' && value.startsWith(PREFIX);
  }

  return {
    isSealed,
    seal(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
    },
    open(stored) {
      if (!isSealed(stored)) return stored; // a value saved before encryption was turned on
      const raw = Buffer.from(stored.slice(PREFIX.length), 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}

/** Used when no SECRET_KEY is set: secrets stay as they are, and sealed ones cannot be read. */
export const plainSecretBox = {
  isSealed: (value) => typeof value === 'string' && value.startsWith(PREFIX),
  seal: (plain) => plain,
  open(stored) {
    if (typeof stored === 'string' && stored.startsWith(PREFIX)) {
      throw new Error('two-step secrets are encrypted but SECRET_KEY is not set');
    }
    return stored;
  },
};
