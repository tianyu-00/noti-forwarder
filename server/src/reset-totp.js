// Usage (on the server): docker compose exec server node src/reset-totp.js <username>
// Turns 2FA off for that user, for when the phone and the backup codes are both lost.
import { openDatabase } from './db/sqlite.js';
import { resetTotp } from './auth/users.js';

const username = process.argv[2];
if (!username) {
  console.error('Usage: node src/reset-totp.js <username>');
  process.exit(1);
}
const db = openDatabase(process.env.DATABASE_PATH || './data/notiforwarder.db');
const found = await resetTotp(db, username);
console.log(found ? `2FA turned off for ${username}` : `no such user: ${username}`);
await db.end();
process.exit(found ? 0 : 1);
