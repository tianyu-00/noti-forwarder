// Audit events never carry message bodies, passwords or tokens.
export function audit(db, { event, actor = null, deviceId = null, ip = null }) {
  return db.query('INSERT INTO audit_log (event, actor, device_id, ip) VALUES ($1, $2, $3, $4)', [
    event,
    actor,
    deviceId,
    ip,
  ]);
}
