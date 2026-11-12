import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildTestApp } from './helpers/app.js';
import { createSilentMonitor } from '../src/silent.js';

const HOUR = 3600000;
const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);

let ctx;
let clock;
let alerts;
beforeEach(async () => {
  ctx = await buildTestApp();
  clock = { t: T0 };
  alerts = [];
});
afterEach(() => ctx.pool.end());

const monitor = (overrides = {}) =>
  createSilentMonitor({
    db: ctx.pool,
    afterMinutes: 120,
    now: () => clock.t,
    notifier: { alert: async (a) => alerts.push(a) },
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

describe('silent phone monitor', () => {
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
    expect(alerts).toEqual([]);
  });

  it('alerts once when a phone goes quiet, not again on the next check', async () => {
    const d = await ctx.addDevice();
    await ctx.pool.query("UPDATE devices SET name = 'Kitchen phone' WHERE device_id = $1", [d.deviceId]);
    await seenAgo(d.deviceId, 3 * HOUR);
    const m = monitor();

    expect((await m.check()).wentQuiet).toEqual([d.deviceId]);
    expect((await m.check()).wentQuiet).toEqual([]);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toMatch(/Kitchen phone/);
    expect(alerts[0].message).toMatch(/3 hours/);
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
    await seenAgo(d.deviceId, 3 * HOUR);
    const m = monitor();
    await m.check();

    await seenAgo(d.deviceId, 60000);
    const back = await m.check();

    expect(back.recovered).toEqual([d.deviceId]);
    expect((await m.check()).recovered).toEqual([]);
    expect(alerts).toHaveLength(2);
    expect(alerts[1].title).toMatch(/back/i);
  });

  it('stays quiet about a phone that was revoked while it was quiet', async () => {
    const d = await ctx.addDevice();
    await seenAgo(d.deviceId, 3 * HOUR);
    const m = monitor();
    await m.check();

    await ctx.pool.query('UPDATE devices SET revoked_at = now() WHERE device_id = $1', [d.deviceId]);

    expect(await m.check()).toEqual({ wentQuiet: [], recovered: [] });
    expect(alerts).toHaveLength(1);
  });

  it('does nothing when switched off with 0 minutes, and works without ntfy', async () => {
    const d = await ctx.addDevice();
    await seenAgo(d.deviceId, 9 * HOUR);

    expect(await monitor({ afterMinutes: 0 }).check()).toEqual({ wentQuiet: [], recovered: [] });
    expect((await monitor({ notifier: null }).check()).wentQuiet).toEqual([d.deviceId]);
  });

  it('keeps going if the push fails', async () => {
    const d = await ctx.addDevice();
    await seenAgo(d.deviceId, 3 * HOUR);
    const m = monitor({ notifier: { alert: async () => { throw new Error('boom'); } } });

    expect((await m.check()).wentQuiet).toEqual([d.deviceId]);
  });

  it('never flags a phone that holds a connection, however old its last message is', async () => {
    const d = await ctx.addDevice();
    await seenAgo(d.deviceId, 9 * HOUR);
    const m = monitor({ isConnected: (id) => id === d.deviceId });

    expect(await m.check()).toEqual({ wentQuiet: [], recovered: [] });
    expect(alerts).toEqual([]);
  });
});
