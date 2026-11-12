// Watches for phones that have stopped checking in. Each phone sends a heartbeat every ~15
// minutes, so a phone unseen for a couple of hours is probably dead: killed by the battery
// optimiser, offline, or Notification access revoked. Messages would silently stop, so say so.
//
// "Already alerted" is kept in memory only (no database column): after a server restart a phone
// that is still quiet is announced once more. Nothing here handles message text.

function describeQuiet(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

export function createSilentMonitor({
  db,
  notifier = null,
  afterMinutes,
  now = Date.now,
  logger = console,
}) {
  const alerted = new Set();
  let timer = null;

  async function send(alert) {
    if (!notifier) return;
    try {
      await notifier.alert(alert);
    } catch {
      logger.warn('silent phone alert failed to send');
    }
  }

  async function check() {
    if (!afterMinutes || afterMinutes <= 0) return { wentQuiet: [], recovered: [] };
    const { rows } = await db.query(
      'SELECT device_id, name, last_seen, paired_at FROM devices WHERE revoked_at IS NULL',
    );
    const limit = afterMinutes * 60000;
    const quietNow = new Map();
    for (const row of rows) {
      const lastContact = new Date(row.last_seen ?? row.paired_at).getTime();
      if (now() - lastContact >= limit) quietNow.set(row.device_id, { row, ms: now() - lastContact });
    }
    const names = new Map(rows.map((r) => [r.device_id, r.name]));

    const wentQuiet = [];
    for (const [id, { row, ms }] of quietNow) {
      if (alerted.has(id)) continue;
      alerted.add(id);
      wentQuiet.push(id);
      await send({
        title: `${row.name} has gone quiet`,
        message: `No contact for ${describeQuiet(ms)}. Check that the app is running and Notification access is on.`,
        priority: 4,
        tags: ['warning'],
      });
    }

    const recovered = [];
    for (const id of [...alerted]) {
      if (quietNow.has(id)) continue;
      alerted.delete(id);
      if (!names.has(id)) continue; // revoked or erased meanwhile: nothing to announce
      recovered.push(id);
      await send({ title: `${names.get(id)} is back`, message: 'It is checking in again.', priority: 3, tags: ['white_check_mark'] });
    }
    return { wentQuiet, recovered };
  }

  return {
    check,
    start(intervalMs = 5 * 60000) {
      const run = () => check().catch((err) => logger.warn(`silent phone check failed: ${err.code || err.name}`));
      timer = setInterval(run, intervalMs);
      timer.unref?.();
      run();
    },
    stop() {
      clearInterval(timer);
    },
  };
}
