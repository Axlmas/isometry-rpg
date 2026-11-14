const ACCENTED: Record<string, string> = {
  a: 'á', b: 'ƀ', c: 'ç', d: 'đ', e: 'é', g: 'ĝ', h: 'ĥ', i: 'í', k: 'ķ', l: 'ļ', n: 'ñ',
  o: 'ö', r: 'ŕ', s: 'š', t: 'ţ', u: 'ü', w: 'ŵ', y: 'ý', z: 'ž',
  A: 'Å', C: 'Ç', D: 'Đ', E: 'É', G: 'Ĝ', H: 'Ĥ', I: 'Í', K: 'Ķ', L: 'Ļ', N: 'Ñ',
  O: 'Ö', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Ü', W: 'Ŵ', Y: 'Ý', Z: 'Ž',
};

/**
 * Turns a source message into a pseudo-translation: accented letters to
 * reveal hard-coded text and missing glyphs, and about 40% extra length to
 * reveal layouts that break when a translation is longer than English.
 *
 * ICU syntax is preserved. In an ICU message, text at an even brace depth is
 * player-readable and text at an odd depth is syntax (argument names,
 * `plural`, selectors), so only even depths are changed.
 */
export function pseudolocalize(message: string): string {
  let depth = 0;
  let letters = 0;
  let out = '';
  for (const char of message) {
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    else if (depth % 2 === 0 && /\p{L}/u.test(char)) {
      letters += 1;
      out += ACCENTED[char] ?? char;
      continue;
    }
    out += char;
  }
  const padding = '~'.repeat(Math.ceil(letters * 0.4));
  return `[${out}${padding ? ' ' + padding : ''}]`;
}

export function pseudolocalizeAll(messages: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(messages).map(([key, value]) => [key, pseudolocalize(value)]));
}
