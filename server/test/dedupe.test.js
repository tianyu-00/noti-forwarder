import { describe, it, expect } from 'vitest';
import { dedupeHash } from '../src/dedupe.js';

const base = {
  deviceId: 'dev1',
  app: 'com.bank',
  sender: 'Bank',
  body: 'Your code is 123456',
  receivedAt: '2026-11-11T10:00:05Z',
};

describe('dedupeHash', () => {
  it('is stable for the same message at the same instant, however the time is written', () => {
    const a = dedupeHash(base);
    expect(dedupeHash({ ...base, receivedAt: '2026-11-11T10:00:05.000Z' })).toBe(a);
    expect(dedupeHash({ ...base, receivedAt: '2026-11-11T10:00:05+00:00' })).toBe(a);
    expect(dedupeHash({ ...base, receivedAt: '2026-11-11T11:00:05+01:00' })).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('treats the same text a moment later as a different message, even within the same minute', () => {
    const h = dedupeHash(base);
    expect(dedupeHash({ ...base, receivedAt: '2026-11-11T10:00:06Z' })).not.toBe(h);
    expect(dedupeHash({ ...base, receivedAt: '2026-11-11T10:00:05.001Z' })).not.toBe(h);
    expect(dedupeHash({ ...base, receivedAt: '2026-11-11T10:00:55Z' })).not.toBe(h);
  });

  it('differs across devices, apps, senders and bodies', () => {
    const h = dedupeHash(base);
    expect(dedupeHash({ ...base, deviceId: 'dev2' })).not.toBe(h);
    expect(dedupeHash({ ...base, app: 'sms' })).not.toBe(h);
    expect(dedupeHash({ ...base, sender: 'Other' })).not.toBe(h);
    expect(dedupeHash({ ...base, body: 'different' })).not.toBe(h);
  });

  it('does not let field boundaries collide', () => {
    const a = dedupeHash({ ...base, sender: 'ab', body: 'c' });
    const b = dedupeHash({ ...base, sender: 'a', body: 'bc' });
    expect(a).not.toBe(b);
  });
});
