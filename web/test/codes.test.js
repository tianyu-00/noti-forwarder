import { extractCode } from '../src/codes.js';

// The server finds codes in plain messages; encrypted ones can only be read here, with the same rules.
describe('extractCode', () => {
  it('finds the number next to a code keyword', () => {
    expect(extractCode('Your code is 482913, do not share it')).toBe('482913');
    expect(extractCode('验证码654321')).toBe('654321');
    expect(extractCode('OTP: 123 456')).toBe('123456');
  });

  it('returns null without a keyword, or for amounts and references', () => {
    expect(extractCode('Your parcel 482913 has shipped')).toBeNull();
    expect(extractCode('Your code: balance £1500')).toBeNull();
    expect(extractCode('')).toBeNull();
    expect(extractCode(null)).toBeNull();
  });

  it('prefers the number nearest the keyword', () => {
    expect(extractCode('Order 99887766 shipped. Your verification code is 1234')).toBe('1234');
  });
});
