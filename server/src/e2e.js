// End-to-end encrypted text is opaque to the server: "e2e:v1:" followed by base64url of
// nonce + AES-GCM ciphertext. The phones encrypt and the dashboards decrypt; the server never
// has the key, so it can only store, forward and size-check these values.
export const E2E_PREFIX = 'e2e:v1:';

export function isEncrypted(text) {
  return typeof text === 'string' && text.startsWith(E2E_PREFIX);
}
