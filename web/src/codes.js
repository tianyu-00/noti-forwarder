// Finds a one-time code (2FA / OTP) in message text. The same rules as server/src/codes.js: the
// server applies them to plain messages, and this copy applies them to encrypted ones after
// they are decrypted in the browser. Keep the two in step.

const ASCII_KEYWORDS =
  /\b(?:code|otp|passcode|password|pin|verification|verify|security|authentication|authorization|auth|login|log-in|sign-in|token|one[- ]time)\b/gi;
// No word boundaries: Chinese text has no spaces, e.g. "验证码654321".
const CHINESE_KEYWORDS = /验证码|驗證碼|校验码|校驗碼|动态码|動態碼|确认码|安全码/g;

// 4-8 digits, or two groups of 3 or 4 ("123 456", "1234-5678"). Not part of a longer number,
// not next to ASCII letters, not an amount (£1500, 1234.56) and not a #reference.
const NUMBER =
  /(?<![A-Za-z\d.,£$€¥#])(\d{3}[ -]\d{3}|\d{4}[ -]\d{4}|\d{4,8})(?![A-Za-z\d]|[.,]\d|%)/g;

function spans(text, pattern) {
  return [...text.matchAll(pattern)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
}

function gap(a, b) {
  if (a.end <= b.start) return b.start - a.end;
  if (b.end <= a.start) return a.start - b.end;
  return 0;
}

export function extractCode(text) {
  if (typeof text !== 'string' || text === '') return null;

  const keywords = [...spans(text, ASCII_KEYWORDS), ...spans(text, CHINESE_KEYWORDS)];
  if (keywords.length === 0) return null;

  let best = null;
  for (const m of text.matchAll(NUMBER)) {
    const candidate = { start: m.index, end: m.index + m[0].length };
    const distance = Math.min(...keywords.map((k) => gap(candidate, k)));
    if (best === null || distance < best.distance) best = { distance, digits: m[1].replace(/\D/g, '') };
  }
  return best ? best.digits : null;
}
