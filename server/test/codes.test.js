import { describe, it, expect } from 'vitest';
import { extractCode } from '../src/codes.js';

describe('extractCode', () => {
  it('finds the code in an ordinary message', () => {
    expect(extractCode('Your code is 123456')).toBe('123456');
    expect(extractCode('Use 482913 as your one-time passcode. Do not share it.')).toBe('482913');
  });

  it('finds a code written before the keyword, and ignores a letter prefix', () => {
    expect(extractCode('847291 is your verification code')).toBe('847291');
    expect(extractCode('G-123456 is your Google verification code.')).toBe('123456');
  });

  it('joins a code written in groups', () => {
    expect(extractCode('Your code is 123 456')).toBe('123456');
    expect(extractCode('Your code is 123-456')).toBe('123456');
    expect(extractCode('Security code: 1234 5678')).toBe('12345678');
  });

  it('accepts codes of 4 to 8 digits', () => {
    expect(extractCode('Your PIN is 4821')).toBe('4821');
    expect(extractCode('Auth code 12345678')).toBe('12345678');
  });

  it('picks the number next to the keyword when there are several', () => {
    expect(extractCode('Order 5555 confirmed. Your code is 123456.')).toBe('123456');
    expect(extractCode('Code 123456 expires in 10 minutes. Call 02071234567 for help.')).toBe('123456');
  });

  it('understands the Chinese keywords used by apps like WeChat', () => {
    expect(extractCode('【微信】验证码 654321，请勿泄露')).toBe('654321');
    expect(extractCode('您的验证码是 887766')).toBe('887766');
  });

  it('ignores amounts, decimals, long numbers and numbers glued to letters', () => {
    expect(extractCode('Security alert: £1500 was spent on your card')).toBeNull();
    expect(extractCode('Verification code balance 1234.56')).toBeNull();
    expect(extractCode('Your code is 12345678901')).toBeNull();
    expect(extractCode('Ref AB123456 code 9988')).toBe('9988');
  });

  it('finds nothing when there is no code-like keyword', () => {
    expect(extractCode('Your order 123456 has shipped')).toBeNull();
    expect(extractCode('Meet at 7 on Friday')).toBeNull();
  });

  it('copes with empty input', () => {
    expect(extractCode('')).toBeNull();
    expect(extractCode(null)).toBeNull();
    expect(extractCode(undefined)).toBeNull();
  });
});
