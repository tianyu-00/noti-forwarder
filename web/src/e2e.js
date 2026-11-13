import { gcm } from "@noble/ciphers/aes.js";

// End-to-end encryption of message text. The key never leaves the phones and the browsers.
//
// Format of an encrypted field:  "e2e:v1:" + base64url( nonce[12] | ciphertext | tag[16] )
// Cipher: AES-256-GCM. Additional data: "nf-e2e-v1:" + field name ("body" or "sender"), so the
// server cannot move one field's ciphertext into another. The phone derives the nonce from the
// message itself (see android/.../E2eCipher.kt), so a repeated message gives identical output
// and the server's duplicate check keeps working. This side only decrypts.
//
// A pure-JavaScript AES is used on purpose: the browser's own crypto.subtle is switched off on
// plain http pages, and the dashboard may be opened on a LAN address without a certificate.

const PREFIX = "e2e:v1:";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function toBase64Url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function fromBase64Url(text) {
  const padded = text
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function isEncrypted(text) {
  return typeof text === "string" && text.startsWith(PREFIX);
}

export function isValidKey(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(text))
    return false;
  return fromBase64Url(text).length === KEY_BYTES;
}

/** A fresh random 256-bit key as base64url text (43 characters). */
export function generateKey() {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
}

/** Throws if the key is wrong, the field is not the one it was made for, or the text was changed. */
export function decryptField(key, field, blob) {
  if (!isValidKey(key)) throw new Error("bad key");
  if (!isEncrypted(blob)) throw new Error("not encrypted");
  const raw = fromBase64Url(blob.slice(PREFIX.length));
  if (raw.length < NONCE_BYTES + TAG_BYTES) throw new Error("too short");
  const nonce = raw.subarray(0, NONCE_BYTES);
  const aad = encoder.encode(`nf-e2e-v1:${field}`);
  const plain = gcm(fromBase64Url(key), nonce, aad).decrypt(
    raw.subarray(NONCE_BYTES),
  );
  return decoder.decode(plain);
}
