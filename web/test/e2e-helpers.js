import { createCipheriv, randomBytes } from "node:crypto";

// Test-only encryption with Node's own crypto, written separately from src/e2e.js (which only decrypts).
export function encryptField(key, field, plaintext) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(key, "base64url"),
    nonce,
  );
  cipher.setAAD(Buffer.from(`nf-e2e-v1:${field}`));
  const body = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return `e2e:v1:${Buffer.concat([nonce, body, cipher.getAuthTag()]).toString("base64url")}`;
}
