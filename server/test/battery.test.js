import { describe, it, expect, beforeEach } from 'vitest';
import { createBatteryWatcher } from '../src/battery.js';

let low;
let ok;
let watcher;
beforeEach(() => {
  low = [];
  ok = [];
  watcher = createBatteryWatcher({ onLow: (e) => low.push(e), onOk: (e) => ok.push(e), logger: { warn() {} } });
});

const see = (percent, charging = false, id = 'd1') => watcher.observe({ deviceId: id, deviceName: 'Kitchen phone', percent, charging });

describe('battery watcher', () => {
  it('says once when a phone drops to 15% or less while it is not charging', () => {
    see(40);
    see(16);
    expect(low).toEqual([]);

    see(15);
    see(12);
    see(9);

    expect(low).toEqual([{ deviceId: 'd1', deviceName: 'Kitchen phone', percent: 15 }]);
  });

  it('says nothing about a low level while the phone is charging', () => {
    see(8, true);
    see(5, true);

    expect(low).toEqual([]);
  });

  it('says when a phone that was low goes on charge, or recovers to 20% or more', () => {
    see(12);
    see(13, true);
    expect(ok).toEqual([{ deviceId: 'd1', deviceName: 'Kitchen phone', percent: 13 }]);

    see(10); // low again after being unplugged
    see(25);
    expect(ok).toHaveLength(2);
    expect(low).toHaveLength(2);
  });

  it('does not say "ok" between 16% and 19%, so a level hovering around the limit stays quiet', () => {
    see(14);
    see(17);
    see(18);
    see(14);

    expect(low).toHaveLength(1);
    expect(ok).toEqual([]);
  });

  it('never says "ok" for a phone it did not call low', () => {
    see(60);
    see(70, true);

    expect(ok).toEqual([]);
  });

  it('keeps phones apart', () => {
    see(10, false, 'a');
    see(10, false, 'b');

    expect(low.map((e) => e.deviceId)).toEqual(['a', 'b']);
  });

  it('forgets a phone, so it is announced again if it is still low after that', () => {
    see(10);
    watcher.forget('d1');
    see(9);

    expect(low).toHaveLength(2);
  });

  it('keeps going if a listener throws', () => {
    const w = createBatteryWatcher({ onLow: () => { throw new Error('boom'); }, logger: { warn() {} } });

    expect(() => w.observe({ deviceId: 'd', deviceName: 'P', percent: 5, charging: false })).not.toThrow();
  });
});
