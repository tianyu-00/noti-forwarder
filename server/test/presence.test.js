import { describe, it, expect } from 'vitest';
import { createPresence } from '../src/presence.js';

// A fake connection that records what the server did to it.
function fakeConnection() {
  const sent = [];
  let closed = 0;
  return { send: (event, data) => sent.push([event, data]), close: () => { closed += 1; }, sent, get closed() { return closed; } };
}

function setup() {
  const changes = [];
  const clock = { t: 1_000_000 };
  const presence = createPresence({ onChange: (id, connected) => changes.push([id, connected]), now: () => clock.t });
  return { presence, changes, clock };
}

describe('presence', () => {
  it('is connected while a phone holds a connection, and tells listeners when that changes', () => {
    const { presence, changes } = setup();
    expect(presence.isConnected('a')).toBe(false);

    const release = presence.connect('a', fakeConnection());
    expect(presence.isConnected('a')).toBe(true);
    expect(presence.connectedIds()).toEqual(['a']);

    release();
    expect(presence.isConnected('a')).toBe(false);
    expect(changes).toEqual([['a', true], ['a', false]]);
  });

  it('lets a new connection replace the old one without flickering offline', () => {
    const { presence, changes } = setup();
    const first = fakeConnection();
    const releaseFirst = presence.connect('a', first);

    const second = fakeConnection();
    presence.connect('a', second);
    releaseFirst(); // the old socket finally notices it is dead

    expect(first.closed).toBe(1);
    expect(second.closed).toBe(0);
    expect(presence.isConnected('a')).toBe(true);
    expect(changes).toEqual([['a', true]]);
  });

  it('tells a phone it was revoked, then hangs up', () => {
    const { presence, changes } = setup();
    const conn = fakeConnection();
    presence.connect('a', conn);

    presence.revoke('a');

    expect(conn.sent).toEqual([['revoked', {}]]);
    expect(conn.closed).toBe(1);
    expect(presence.isConnected('a')).toBe(false);
    expect(changes).toEqual([['a', true], ['a', false]]);
  });

  it('ignores a revoke for a phone that is not connected', () => {
    const { presence, changes } = setup();

    expect(() => presence.revoke('nobody')).not.toThrow();
    expect(changes).toEqual([]);
  });

  it('drops a connection that has not been heard from, because a vanished phone never says goodbye', () => {
    const { presence, changes, clock } = setup();
    const silent = fakeConnection();
    const chatty = fakeConnection();
    presence.connect('silent', silent);
    presence.connect('chatty', chatty);

    clock.t += 40_000;
    presence.touch('chatty'); // it checked in
    clock.t += 30_000; // silent: 70 s of nothing, chatty: 30 s

    expect(presence.dropStale(60_000)).toEqual(['silent']);

    expect(silent.closed).toBe(1);
    expect(chatty.closed).toBe(0);
    expect(presence.isConnected('silent')).toBe(false);
    expect(presence.isConnected('chatty')).toBe(true);
    expect(changes).toEqual([['silent', true], ['chatty', true], ['silent', false]]);
  });

  it('counts the moment of connecting as the first sign of life', () => {
    const { presence, clock } = setup();
    presence.connect('a', fakeConnection());

    clock.t += 59_000;
    expect(presence.dropStale(60_000)).toEqual([]);
    clock.t += 2_000;
    expect(presence.dropStale(60_000)).toEqual(['a']);
  });

  it('ignores a check-in from a phone that is not connected', () => {
    const { presence } = setup();

    expect(() => presence.touch('nobody')).not.toThrow();
    expect(presence.isConnected('nobody')).toBe(false);
  });
});
