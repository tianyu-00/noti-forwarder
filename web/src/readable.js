import { decryptField, isEncrypted } from "./e2e.js";
import { extractCode } from "./codes.js";

/**
 * Turns a message as the server stores it into one the dashboard can show. Encrypted fields are
 * decrypted with this browser's key and the 2FA code is found here (the server cannot read
 * them). `locked` says why a message cannot be shown: 'no-key' or 'wrong-key'.
 */
export function readMessage(message, key) {
  if (!isEncrypted(message.body) && !isEncrypted(message.sender))
    return { ...message, encrypted: false, locked: null };
  if (!key)
    return {
      ...message,
      sender: "",
      body: "",
      code: null,
      encrypted: true,
      locked: "no-key",
    };
  try {
    const sender = isEncrypted(message.sender)
      ? decryptField(key, "sender", message.sender)
      : message.sender;
    const body = isEncrypted(message.body)
      ? decryptField(key, "body", message.body)
      : message.body;
    return {
      ...message,
      sender,
      body,
      code: extractCode(body),
      encrypted: true,
      locked: null,
    };
  } catch {
    return {
      ...message,
      sender: "",
      body: "",
      code: null,
      encrypted: true,
      locked: "wrong-key",
    };
  }
}

/**
 * A reply as the server stores it, readable here. The number and text are plain, or encrypted
 * by a browser with the shared key; one this browser cannot read has `locked` set.
 */
export function readReply(reply, key) {
  if (!isEncrypted(reply.to) && !isEncrypted(reply.body))
    return { ...reply, locked: null };
  if (!key) return { ...reply, to: "", body: "", locked: "no-key" };
  try {
    return {
      ...reply,
      to: isEncrypted(reply.to)
        ? decryptField(key, "reply-to", reply.to)
        : reply.to,
      body: isEncrypted(reply.body)
        ? decryptField(key, "reply-body", reply.body)
        : reply.body,
      locked: null,
    };
  } catch {
    return { ...reply, to: "", body: "", locked: "wrong-key" };
  }
}
