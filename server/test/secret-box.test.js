import { describe, it, expect } from 'vitest';
import { createSecretBox, plainSecretBox } from '../src/auth/secret-box.js';

const KEY = 'k'.repeat(40);

describe('secret box', () => {
  it('seals a secret so the stored text is not the secret, and opens it again', () => {
    const box = createSecretBox(KEY);
    const sealed = box.seal('JBSWY3DPEHPK3PXP');

    expect(sealed).toMatch(/^enc:v1:/);
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(box.open(sealed)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('gives different output each time for the same secret', () => {
    const box = createSecretBox(KEY);
    expect(box.seal('same')).not.toBe(box.seal('same'));
  });

  it('refuses a tampered value and a wrong key', () => {
    const box = createSecretBox(KEY);
    const sealed = box.seal('JBSWY3DPEHPK3PXP');
    const tampered = `${sealed.slice(0, -2)}${sealed.endsWith('AA') ? 'BB' : 'AA'}`;

    expect(() => box.open(tampered)).toThrow();
    expect(() => createSecretBox('z'.repeat(40)).open(sealed)).toThrow();
  });

  it('refuses a key that is too short', () => {
    expect(() => createSecretBox('short')).toThrow(/at least 32/);
  });

  it('opens an old plain-text value unchanged, so existing installs keep working', () => {
    expect(createSecretBox(KEY).open('JBSWY3DPEHPK3PXP')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('knows which values are sealed', () => {
    const box = createSecretBox(KEY);
    expect(box.isSealed(box.seal('x'))).toBe(true);
    expect(box.isSealed('x')).toBe(false);
  });

  it('without a key leaves secrets as they are and cannot open sealed ones', () => {
    expect(plainSecretBox.seal('abc')).toBe('abc');
    expect(plainSecretBox.open('abc')).toBe('abc');
    expect(() => plainSecretBox.open('enc:v1:AAAA')).toThrow(/SECRET_KEY/);
  });
});
