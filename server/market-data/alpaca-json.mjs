// Strict provider JSON reader. Numeric OHLC tokens retain their source decimal
// spelling instead of first rounding through a JavaScript number. No IO.
export function parseAlpacaJSON(text) {
  if (typeof text !== 'string' || text.length > 2_000_000) throw new Error('response_json_invalid');
  let cursor = 0;
  const fail = () => { throw new Error('response_json_invalid'); };
  const whitespace = () => { while (/[\x20\t\r\n]/.test(text[cursor] ?? '!')) cursor++; };
  function string() {
    if (text[cursor] !== '"') fail();
    const start = cursor++;
    while (cursor < text.length) {
      const ch = text[cursor++];
      if (ch === '"') return JSON.parse(text.slice(start, cursor));
      if (ch === '\\') cursor++;
    }
    fail();
  }
  function value(depth, key) {
    if (depth > 32) fail();
    whitespace();
    const ch = text[cursor];
    if (ch === '"') return string();
    if (ch === '{') {
      cursor++; whitespace();
      const object = Object.create(null), keys = new Set();
      if (text[cursor] === '}') { cursor++; return object; }
      while (cursor < text.length) {
        whitespace(); const member = string();
        if (keys.has(member)) fail();
        keys.add(member); whitespace();
        if (text[cursor++] !== ':') fail();
        object[member] = value(depth + 1, member); whitespace();
        const delimiter = text[cursor++];
        if (delimiter === '}') return object;
        if (delimiter !== ',') fail();
      }
      fail();
    }
    if (ch === '[') {
      cursor++; whitespace(); const array = [];
      if (text[cursor] === ']') { cursor++; return array; }
      while (cursor < text.length) {
        array.push(value(depth + 1)); whitespace();
        const delimiter = text[cursor++];
        if (delimiter === ']') return array;
        if (delimiter !== ',') fail();
      }
      fail();
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(cursor));
    if (!match) fail();
    cursor += match[0].length;
    // Unadjusted share volume is an integer in the provider contract. Checking
    // only the rounded Number would accept e.g. 9007199254740991.1 or -1e-400.
    if (key === 'v' && /^-?\d/.test(match[0]) && (!/^(?:0|[1-9]\d*)$/.test(match[0]) || !Number.isSafeInteger(Number(match[0])))) fail();
    // Decimal-domain validation deliberately rejects exponent notation or excess
    // precision rather than silently rounding unsupported monetary input.
    return ['o','h','l','c'].includes(key) && /^-?\d/.test(match[0]) ? match[0] : JSON.parse(match[0]);
  }
  const result = value(0); whitespace();
  if (cursor !== text.length) fail();
  return result;
}
