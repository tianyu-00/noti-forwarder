import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createApp } from './app.js';
import { cookieSecureFor } from './cookie-secure.js';
import { createSilentMonitor } from './silent.js';
import { createSecretBox, plainSecretBox } from './auth/secret-box.js';
import { assertSecretsReadable, sealExistingSecrets } from './auth/secrets-at-rest.js';
import { loadBuildInfo } from './config.js';
import { runMigrations } from './db/migrate.js';
import { ensureAdminUser } from './auth/users.js';
import { ntfyFromEnv } from './ntfy.js';
import { startRetentionJob } from './retention.js';

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

// Optional: SECRET_KEY encrypts the two-step login secret in the database. Without it the
// secret is stored as plain text (protect your database backups).
let secretBox = plainSecretBox;
if (process.env.SECRET_KEY) {
  try {
    secretBox = createSecretBox(process.env.SECRET_KEY);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
try {
  await assertSecretsReadable(db, secretBox);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const sealedNow = await sealExistingSecrets(db, secretBox);
if (sealedNow) console.log(`encrypted ${sealedNow} stored two-step secret(s)`);
if (secretBox === plainSecretBox) console.log('SECRET_KEY not set: the two-step secret is stored unencrypted');

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

// A phone unseen for this many minutes counts as quiet (0 turns the check off). Phones check in
// every ~15 minutes, so the default leaves room for a couple of missed ones.
const silentAfterMinutes = process.env.SILENT_AFTER_MINUTES === undefined || process.env.SILENT_AFTER_MINUTES === '' ? 120 : Number(process.env.SILENT_AFTER_MINUTES);
if (!Number.isInteger(silentAfterMinutes) || silentAfterMinutes < 0 || (silentAfterMinutes > 0 && silentAfterMinutes < 30)) {
  console.error('SILENT_AFTER_MINUTES must be 0 (off) or a whole number of at least 30');
  process.exit(1);
}
const cookieSecure = cookieSecureFor(publicUrl);
if (!cookieSecure) console.log('PUBLIC_URL is http://: sessions work without HTTPS, but traffic is not encrypted');
const app = createApp({ ...loadBuildInfo(process.env), db, publicUrl, trustProxy, notifier, cookieSecure, secretBox, silentAfterMinutes });

startRetentionJob(db);
if (silentAfterMinutes > 0) {
  createSilentMonitor({ db, notifier, afterMinutes: silentAfterMinutes, isConnected: (id) => app.locals.presence?.isConnected(id) ?? false }).start();
  console.log(`silent phone alerts after ${silentAfterMinutes} minutes without contact`);
} else {
  console.log('silent phone alerts off (SILENT_AFTER_MINUTES=0)');
}

app.listen(port, () => {
  console.log(`server listening on :${port}`);
});
