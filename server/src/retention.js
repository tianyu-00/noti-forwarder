// Message retention: how long messages are kept is a dashboard setting (null = forever).

export async function getRetentionDays(db) {
  const { rows } = await db.query("SELECT value FROM settings WHERE key = 'retention_days'");
  return rows.length ? rows[0].value : null;
}

export async function setRetentionDays(db, days) {
  if (days === null) {
    await db.query("DELETE FROM settings WHERE key = 'retention_days'");
    return;
  }
  await db.query(
    `INSERT INTO settings (key, value) VALUES ('retention_days', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(days)],
  );
}

/** Deletes messages older than the stored limit. Returns how many were deleted. */
export async function purgeOldMessages(db) {
  const days = await getRetentionDays(db);
  if (days === null) return 0;
  const result = await db.query("DELETE FROM messages WHERE received_at < now() - ($1 || ' days')::interval", [
    String(days),
  ]);
  return result.rowCount;
}

/** Runs the purge on a timer. Logs only a count, never message text. */
export function startRetentionJob(db, { everyMs = 60 * 60 * 1000, logger = console } = {}) {
  const run = async () => {
    try {
      const purged = await purgeOldMessages(db);
      if (purged > 0) logger.log(`retention: deleted ${purged} old messages`);
    } catch (err) {
      logger.error(`retention failed: ${err.code || err.name}`);
    }
  };
  run();
  const timer = setInterval(run, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
