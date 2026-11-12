/**
 * Splits message text around its 2FA code so the code can be highlighted. The code is digits
 * only (the server strips spaces and dashes), but the text may show it as "123 456", so the
 * match allows an optional space or dash between digits. Only ever returns slices of the
 * original text: nothing here builds HTML.
 */
export function splitAroundCode(body, code) {
  const whole = [{ text: body, isCode: false }];
  // Digits only: a code like ".*" can never act as a pattern.
  if (!code || !/^\d+$/.test(code)) return whole;

  const pattern = new RegExp(`(?<!\\d)${[...code].join('[ -]?')}(?!\\d)`);
  const match = pattern.exec(body);
  if (!match) return whole;

  return [
    { text: body.slice(0, match.index), isCode: false },
    { text: match[0], isCode: true },
    { text: body.slice(match.index + match[0].length), isCode: false },
  ].filter((part) => part.text !== '');
}
