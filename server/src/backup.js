// Usage (on the server):
//   docker compose exec -T server node src/backup.js > backup-$(date +%F).db
// Writes a safe copy of the database to the output, while the server keeps running.
import { createReadStream, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { openDatabase } from './db/sqlite.js';

if (process.stdout.isTTY) {
  console.error('This writes a binary file. Send it to a file:  node src/backup.js > backup.db');
  process.exit(1);
}
const db = openDatabase(process.env.DATABASE_PATH || './data/notiforwarder.db');
const dir = mkdtempSync(join(tmpdir(), 'nf-backup-'));
const copy = join(dir, 'backup.db');
try {
  await db.backup(copy);
  await pipeline(createReadStream(copy), process.stdout);
} finally {
  rmSync(dir, { recursive: true, force: true });
  await db.end();
}
