import { decryptField, isEncrypted } from "./e2e.js";
import { extractCode } from "./codes.js";

/**
 * Turns a message as the server stores it into one the dashboard can show. Encrypted fields are
 * decrypted with this browser's key and the 2FA code is found here (the server cannot read
 * them). `locked` says why a message cannot be shown: 'no-key' or 'wrong-key'.
 */
export function readMessage(message, key) {
  if (!isEncrypted(message.body) && !isEncrypted(message.sender))
    return { ...message, locked: null };
  if (!key)
    return { ...message, sender: "", body: "", code: null, locked: "no-key" };
  try {
    const sender = isEncrypted(message.sender)
      ? decryptField(key, "sender", message.sender)
      : message.sender;
    const body = isEncrypted(message.body)
      ? decryptField(key, "body", message.body)
      : message.body;
    return { ...message, sender, body, code: extractCode(body), locked: null };
  } catch {
    return {
      ...message,
      sender: "",
      body: "",
      code: null,
      locked: "wrong-key",
    };
  }
}
