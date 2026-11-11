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
