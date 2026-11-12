/**
 * The pairing QR carries the server address and the one-time code. With end-to-end encryption on
 * it also carries the key (`k`), so the phone can encrypt. The key is added here, in the browser:
 * the server that made the rest of the payload never sees it.
 */
export function withKey(qrPayload, key) {
  if (!key) return qrPayload;
  return JSON.stringify({ ...JSON.parse(qrPayload), k: key });
}
