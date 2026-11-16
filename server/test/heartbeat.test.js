import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './helpers/app.js';

let ctx;
beforeAll(async () => {
  ctx = await buildTestApp();
});
afterAll(() => ctx.pool.end());

const beat = (token, headers = {}) =>
  request(ctx.app).post('/api/v1/heartbeat').set(token ? { Authorization: `Bearer ${token}` } : {}).set(headers);

describe('POST /api/v1/heartbeat', () => {
  it('needs a device token and refuses a revoked phone', async () => {
    const revoked = await ctx.addDevice({ revoked: true });

    expect((await beat(null)).status).toBe(401);
    expect((await beat('wrong-token')).status).toBe(401);
    expect((await beat(revoked.token)).status).toBe(401);
  });

  it('marks the phone as seen and records its app version, without needing a message', async () => {
    const d = await ctx.addDevice();
    await ctx.pool.query("UPDATE devices SET last_seen = ts_add_ms(now(), -5 * 3600000) WHERE device_id = $1", [d.deviceId]);

    const res = await beat(d.token, { 'X-App-Version': '0.1.77' });

    expect(res.status).toBe(204);
    const { rows } = await ctx.pool.query(
      "SELECT app_version, last_seen > ts_add_ms(now(), -60000) AS fresh FROM devices WHERE device_id = $1",
      [d.deviceId],
    );
    expect(rows[0]).toEqual({ app_version: '0.1.77', fresh: 1 });
    const messages = await ctx.pool.query('SELECT 1 FROM messages WHERE device_id = $1', [d.deviceId]);
    expect(messages.rowCount).toBe(0);
  });

  const battery = async (id) =>
    (await ctx.pool.query('SELECT battery_percent, battery_charging FROM devices WHERE device_id = $1', [id])).rows[0];

  it('keeps the battery level the phone reports, and whether it is charging', async () => {
    const d = await ctx.addDevice();

    const res = await beat(d.token).send({ battery: { percent: 63, charging: false } });

    expect(res.status).toBe(204);
    expect(await battery(d.deviceId)).toEqual({ battery_percent: 63, battery_charging: 0 });
  });

  it('keeps the last known level when a check-in carries none, as older versions of the app do', async () => {
    const d = await ctx.addDevice();
    await beat(d.token).send({ battery: { percent: 63, charging: true } });

    expect((await beat(d.token)).status).toBe(204);

    expect(await battery(d.deviceId)).toEqual({ battery_percent: 63, battery_charging: 1 });
  });

  it('starts with no level at all', async () => {
    const d = await ctx.addDevice();

    expect(await battery(d.deviceId)).toEqual({ battery_percent: null, battery_charging: null });
  });

  it('refuses a level that makes no sense, and keeps the old one', async () => {
    const d = await ctx.addDevice();
    await beat(d.token).send({ battery: { percent: 50, charging: false } });

    for (const bad of [
      { battery: { percent: 150, charging: false } },
      { battery: { percent: -1, charging: false } },
      { battery: { percent: 12.5, charging: false } },
      { battery: { percent: 'full', charging: false } },
      { battery: { percent: 50 } },
      { battery: 'low' },
    ]) {
      expect((await beat(d.token).send(bad)).status).toBe(400);
    }

    expect(await battery(d.deviceId)).toEqual({ battery_percent: 50, battery_charging: 0 });
  });

  it('tells open dashboards the new level with the "seen" news', async () => {
    const d = await ctx.addDevice();
    const seen = [];
    const off = ctx.app.locals.events.subscribe((e) => e.type === 'device_seen' && seen.push(e.data));

    await beat(d.token).send({ battery: { percent: 20, charging: true } });
    await beat(d.token); // no level this time
    off();

    expect(seen[0]).toMatchObject({ deviceId: d.deviceId, battery: { percent: 20, charging: true } });
    expect(seen[1].battery).toBeUndefined();
  });
});
