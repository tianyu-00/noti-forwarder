// Watches for phones that have stopped checking in. Each phone sends a heartbeat every ~15
// minutes, so a phone unseen for a couple of hours is probably dead: killed by the battery
// optimiser, offline, or Notification access revoked. Messages would silently stop, so say so
// (through the callbacks; index.js sends it to the receiver phones).
//
// "Already announced" is kept in memory only (no database column): after a server restart a phone
// that is still quiet is announced once more. Nothing here handles message text.

export function createSilentMonitor({
  db,
  afterMinutes,
  // Called with { deviceId, deviceName, minutes } when a phone goes quiet, and { deviceId, deviceName } when it is back.
  onQuiet = () => {},
  onBack = () => {},
  // A phone holding its connection is alive by definition, however long since its last message.
  isConnected = () => false,
  now = Date.now,
  logger = console,
}) {
  const announced = new Set();
  let timer = null;

  // A broken listener must not stop the check or the other announcements.
  function tell(listener, event) {
    try {
      listener(event);
    } catch {
      logger.warn('quiet phone announcement failed');
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
      if (isConnected(row.device_id)) continue;
      const lastContact = new Date(row.last_seen ?? row.paired_at).getTime();
      if (now() - lastContact >= limit) quietNow.set(row.device_id, { row, ms: now() - lastContact });
    }
    const names = new Map(rows.map((r) => [r.device_id, r.name]));

    const wentQuiet = [];
    for (const [id, { row, ms }] of quietNow) {
      if (announced.has(id)) continue;
      announced.add(id);
      wentQuiet.push(id);
      tell(onQuiet, { deviceId: id, deviceName: row.name, minutes: Math.floor(ms / 60000) });
    }

    const recovered = [];
    for (const id of [...announced]) {
      if (quietNow.has(id)) continue;
      announced.delete(id);
      if (!names.has(id)) continue; // revoked or erased meanwhile: nothing to announce
      recovered.push(id);
      tell(onBack, { deviceId: id, deviceName: names.get(id) });
    }
    return { wentQuiet, recovered };
  }

  return {
    check,
    start(intervalMs = 5 * 60000) {
      const run = () => check().catch((err) => logger.warn(`quiet phone check failed: ${err.code || err.name}`));
      timer = setInterval(run, intervalMs);
      timer.unref?.();
      run();
    },
    stop() {
      clearInterval(timer);
    },
  };
}
