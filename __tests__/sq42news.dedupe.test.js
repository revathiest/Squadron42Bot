const { normalizeTitle } = require('../sq42news/watcher/dedupe');

describe('sq42news dedupe normalizeTitle', () => {
  test('lowercases and trims whitespace', () => {
    expect(normalizeTitle('  Squadron 42 Monthly Report  ')).toBe('squadron 42 monthly report');
  });

  test('strips trailing " - Source Name" attribution', () => {
    expect(normalizeTitle('CIG reveals Squadron 42 gameplay - PC Gamer')).toBe('cig reveals squadron 42 gameplay');
  });

  test('strips punctuation and quotes', () => {
    expect(normalizeTitle('"Squadron 42" is coming, CIG says!')).toBe('squadron 42 is coming cig says');
  });

  test('treats near-identical headlines from different outlets as the same story', () => {
    const a = normalizeTitle('Squadron 42 Gets New Trailer - IGN');
    const b = normalizeTitle('Squadron 42 gets new trailer - Kotaku');
    expect(a).toBe(b);
  });

  test('returns empty string for falsy input', () => {
    expect(normalizeTitle('')).toBe('');
    expect(normalizeTitle(undefined)).toBe('');
    expect(normalizeTitle(null)).toBe('');
  });
});
