import { describe, it, expect } from 'vitest';
import { cookieSecureFor } from '../src/cookie-secure.js';

describe('cookieSecureFor', () => {
  it('marks the session cookie Secure for an https address', () => {
    expect(cookieSecureFor('https://notifications.example.com')).toBe(true);
  });

  it('leaves it off for a plain http address, so the sign-in sticks without a domain', () => {
    expect(cookieSecureFor('http://192.168.1.20:8006')).toBe(false);
  });

  it('is case-insensitive about the scheme', () => {
    expect(cookieSecureFor('HTTP://192.168.1.20:8006')).toBe(false);
  });
});
