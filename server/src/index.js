import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createApp } from './app.js';
import { loadBuildInfo } from './config.js';
import { runMigrations } from './db/migrate.js';

const port = Number(process.env.PORT) || 3000;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url));

// Migrations run automatically on start (see CLAUDE.md); retry while Postgres boots.
for (let attempt = 1; ; attempt++) {
  try {
    const applied = await runMigrations(db, migrationsDir);
    if (applied.length) console.log(`applied migrations: ${applied.join(', ')}`);
    break;
  } catch (err) {
    if (attempt >= 20) throw err;
    console.log(`database not ready (${err.code || err.message}), retrying...`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

const app = createApp({ ...loadBuildInfo(process.env), db });

app.listen(port, () => {
  console.log(`server listening on :${port}`);
});
