import { hashPassword } from './password.js';

// Single-user system: the admin is created once and never overwritten.
export async function ensureAdminUser(db, { username, password }) {
  const hash = await hashPassword(password);
  const result = await db.query(
    `INSERT INTO users (username, password_hash)
     SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM users)`,
    [username, hash],
  );
  return result.rowCount === 1;
}

/** Server-side escape hatch: removes 2FA for a user (run by whoever controls the server). */
export async function resetTotp(db, username) {
  const { rows } = await db.query(
    `UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL
      WHERE username = $1 RETURNING id`,
    [username],
  );
  if (rows.length === 0) return false;
  await db.query('DELETE FROM totp_backup_codes WHERE user_id = $1', [rows[0].id]);
  await db.query('INSERT INTO audit_log (event, actor) VALUES ($1, $2)', ['totp_reset', username]);
  return true;
}
