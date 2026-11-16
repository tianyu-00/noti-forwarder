import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildTestApp } from './helpers/app.js';
import { createSilentMonitor } from '../src/silent.js';

const HOUR = 3600000;
const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);

let ctx;
let clock;
let quiet;
let back;
beforeEach(async () => {
  ctx = await buildTestApp();
  clock = { t: T0 };
  quiet = [];
  back = [];
});
afterEach(() => ctx.pool.end());

const monitor = (overrides = {}) =>
  createSilentMonitor({
    db: ctx.pool,
    afterMinutes: 120,
    now: () => clock.t,
    onQuiet: (e) => quiet.push(e),
    onBack: (e) => back.push(e),
    logger: { warn() {} },
    ...overrides,
  });

// Sets when the phone was last seen, relative to the fake clock.
async function seenAgo(deviceId, ms) {
  await ctx.pool.query('UPDATE devices SET last_seen = $2, paired_at = $2 WHERE device_id = $1', [
    deviceId,
    new Date(clock.t - ms),
  ]);
}

describe('quiet phone monitor', () => {
  it('ignores recent phones, revoked phones and a phone paired a moment ago', async () => {
    const recent = await ctx.addDevice();
    const revoked = await ctx.addDevice({ revoked: true });
    const fresh = await ctx.addDevice();
    await seenAgo(recent.deviceId, 30 * 60000);
    await seenAgo(revoked.deviceId, 9 * HOUR);
    await ctx.pool.query('UPDATE devices SET last_seen = NULL, paired_at = $2 WHERE device_id = $1', [
      fresh.deviceId,
      new Date(clock.t - 60000),
    ]);

    const result = await monitor().check();

    expect(result).toEqual({ wentQuiet: [], recovered: [] });
    expect(quiet).toEqual([]);
  });

  it('announces once when a phone goes quiet, with its name and how long, not again on the next check', async () => {
    const d = await ctx.addDevice();
    await ctx.pool.query("UPDATE devices SET name = 'Kitchen phone' WHERE device_id = $1", [d.deviceId]);
    await seenAgo(d.deviceId, 3 * HOUR);
    const m = monitor();

    expect((await m.check()).wentQuiet).toEqual([d.deviceId]);
    expect((await m.check()).wentQuiet).toEqual([]);

    expect(quiet).toEqual([{ deviceId: d.deviceId, deviceName: 'Kitchen phone', minutes: 180 }]);
  });

  it('counts a phone that never connected from the moment it was paired', async () => {
    const d = await ctx.addDevice();
    await ctx.pool.query('UPDATE devices SET last_seen = NULL, paired_at = $2 WHERE device_id = $1', [
      d.deviceId,
      new Date(clock.t - 5 * HOUR),
    ]);

    expect((await monitor().check()).wentQuiet).toEqual([d.deviceId]);
  });

  it('says once when the phone is back', async () => {
    const d = await ctx.addDevice();
    await ctx.pool.query("UPDATE devices SET name = 'Kitchen phone' WHERE device_id = $1", [d.deviceId]);
    await seenAgo(d.deviceId, 3 * HOUR);
    const m = monitor();
    await m.check();

    await seenAgo(d.deviceId, 60000);
    const result = await m.check();

    expect(result.recovered).toEqual([d.deviceId]);
    expect((await m.check()).recovered).toEqual([]);
    expect(back).toEqual([{ deviceId: d.deviceId, deviceName: 'Kitchen phone' }]);
  });

  it('stays quiet about a phone that was revoked while it was quiet', async () => {
    const d = await ctx.addDevice();
    await seenAgo(d.deviceId, 3 * HOUR);
    const m = monitor();
    await m.check();

    await ctx.pool.query('UPDATE devices SET revoked_at = now() WHERE device_id = $1', [d.deviceId]);

    expect(await m.check()).toEqual({ wentQuiet: [], recovered: [] });
    expect(back).toEqual([]);
  });

  it('does nothing when switched off with 0 minutes', async () => {
    const d = await ctx.addDevice();
    await seenAgo(d.deviceId, 9 * HOUR);

    expect(await monitor({ afterMinutes: 0 }).check()).toEqual({ wentQuiet: [], recovered: [] });
    expect(quiet).toEqual([]);
  });

  it('works with no listeners at all', async () => {
    const d = await ctx.addDevice();
    await seenAgo(d.deviceId, 3 * HOUR);

    expect((await monitor({ onQuiet: undefined, onBack: undefined }).check()).wentQuiet).toEqual([d.deviceId]);
  });

  it('keeps going if a listener throws', async () => {
    const d = await ctx.addDevice();
    await seenAgo(d.deviceId, 3 * HOUR);
    const m = monitor({ onQuiet: () => { throw new Error('boom'); } });

    expect((await m.check()).wentQuiet).toEqual([d.deviceId]);
  });

  it('never flags a phone that holds a connection, however old its last message is', async () => {
    const d = await ctx.addDevice();
    await seenAgo(d.deviceId, 9 * HOUR);
    const m = monitor({ isConnected: (id) => id === d.deviceId });

    expect((await m.check()).wentQuiet).toEqual([]);
  });
});
