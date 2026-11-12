import { decryptField, generateKey, isEncrypted, isValidKey } from '../src/e2e.js';

// Made by a separate script with Node's own crypto. The Android tests use the same vector, so
// both sides are proven to agree on the byte format.
const VECTOR = {
  key: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
  field: 'body',
  plaintext: 'Your code is 482913',
  blob: 'e2e:v1:Ii4dPFsHI_YnQXKyUD-DnROc_iU0H0iXDw40L_-M-fU9epD9NRdemW2c3BmEtRw',
};

describe('end-to-end encryption format', () => {
  it('decrypts the reference message', () => {
    expect(decryptField(VECTOR.key, VECTOR.field, VECTOR.blob)).toBe(VECTOR.plaintext);
  });

  it('recognises encrypted text by its prefix', () => {
    expect(isEncrypted(VECTOR.blob)).toBe(true);
    expect(isEncrypted('Your code is 482913')).toBe(false);
    expect(isEncrypted(null)).toBe(false);
  });

  it('refuses a wrong key, a different field (so body and sender cannot be swapped) and a changed message', () => {
    const otherKey = generateKey();
    const flipped = `${VECTOR.blob.slice(0, -3)}${VECTOR.blob.endsWith('AAA') ? 'BBB' : 'AAA'}`;

    expect(() => decryptField(otherKey, VECTOR.field, VECTOR.blob)).toThrow();
    expect(() => decryptField(VECTOR.key, 'sender', VECTOR.blob)).toThrow();
    expect(() => decryptField(VECTOR.key, VECTOR.field, flipped)).toThrow();
    expect(() => decryptField(VECTOR.key, VECTOR.field, 'e2e:v1:')).toThrow();
  });

  it('makes a fresh 256-bit key each time and validates a key', () => {
    const a = generateKey();
    const b = generateKey();

    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(isValidKey(a)).toBe(true);
    expect(isValidKey(`${a}x`)).toBe(false);
    expect(isValidKey('not a key')).toBe(false);
    expect(isValidKey('')).toBe(false);
  });
});
