import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createApp } from './app.js';
import { loadBuildInfo } from './config.js';
import { runMigrations } from './db/migrate.js';
import { ensureAdminUser } from './auth/users.js';
import { ntfyFromEnv } from './ntfy.js';

const port = Number(process.env.PORT) || 3000;

function requireEnv(name) {
  if (!process.env[name]) {
    console.error(`${name} is required`);
    process.exit(1);
  }
  return process.env[name];
}

const databaseUrl = requireEnv('DATABASE_URL');
const publicUrl = requireEnv('PUBLIC_URL');
if (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length < 12) {
  console.error('ADMIN_PASSWORD must be at least 12 characters');
  process.exit(1);
}

const db = new pg.Pool({ connectionString: databaseUrl });
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

// First start only: create the single dashboard user from the environment.
if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
  const created = await ensureAdminUser(db, {
    username: process.env.ADMIN_USERNAME,
    password: process.env.ADMIN_PASSWORD,
  });
  if (created) console.log('created admin user');
}

// TRUST_PROXY = number of reverse-proxy hops in front of the server (e.g. 1 for
// Cloudflare tunnel + proxy). Leave unset if clients connect directly.
const trustProxy = process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : undefined;

// Push alerts via ntfy are optional. A wrong setting stops the server at start, so a typo
// cannot silently turn alerts off (or send private text somewhere unintended).
let notifier = null;
try {
  notifier = ntfyFromEnv(process.env);
} catch (err) {
  console.error(`ntfy settings: ${err.message}`);
  process.exit(1);
}
console.log(notifier ? 'ntfy push enabled' : 'ntfy push off (set NTFY_TOPIC to turn it on)');

const app = createApp({ ...loadBuildInfo(process.env), db, publicUrl, trustProxy, notifier });

app.listen(port, () => {
  console.log(`server listening on :${port}`);
});
