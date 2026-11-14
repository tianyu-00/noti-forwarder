import { extractCode } from './codes.js';
import { isEncrypted } from './e2e.js';

export function messageToApi(row) {
  return {
    id: row.id,
    deviceId: row.device_id,
    type: row.type,
    app: row.app,
    appLabel: row.app_label ?? null,
    // The SIM (the phone's subscription id) that received it; null for notifications and older phones.
    sim: row.sim ?? null,
    sender: row.sender,
    body: row.body,
    receivedAt: row.received_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    // Computed from the text each time, so it needs no stored column.
    // Encrypted text cannot be read here; the dashboard finds the code after decrypting.
    code: isEncrypted(row.body) ? null : extractCode(row.body),
  };
}

// token_hash is never part of the API shape.
export function deviceToApi(row) {
  return {
    deviceId: row.device_id,
    name: row.name,
    model: row.model,
    appVersion: row.app_version,
    pairedAt: row.paired_at.toISOString(),
    lastSeen: row.last_seen ? row.last_seen.toISOString() : null,
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
    // null until the phone reports its SIMs.
    sims: row.sims ? JSON.parse(row.sims) : null,
  };
}

export const DEVICE_COLUMNS = 'device_id, name, model, app_version, paired_at, last_seen, revoked_at, sims';

export function outboxToApi(row) {
  return {
    id: row.id,
    deviceId: row.device_id,
    to: row.recipient,
    body: row.body,
    status: row.status,
    error: row.error ?? null,
    sim: row.sim ?? null,
    createdAt: row.created_at.toISOString(),
    sentAt: row.sent_at ? row.sent_at.toISOString() : null,
  };
}
