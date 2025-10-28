const threadUtils = require('../spectrum/watcher/threadUtils');
const descriptionBuilder = require('../spectrum/watcher/descriptionBuilder');
const session = require('../spectrum/watcher/session');

const ORIGINAL_NOW = Date.now;

describe('threadUtils', () => {
  test('parseInterval falls back to default for invalid values', () => {
    expect(threadUtils.parseInterval(null)).toBeGreaterThan(0);
    expect(threadUtils.parseInterval('abc')).toBe(threadUtils.parseInterval(undefined));
    expect(threadUtils.parseInterval(1000)).toBe(threadUtils.parseInterval(undefined));
  });

  test('parseInterval accepts valid number above minimum', () => {
    expect(threadUtils.parseInterval(60000)).toBe(60000);
  });

  test('toThreadId parses numeric and string identifiers', () => {
    const numeric = threadUtils.toThreadId('12345');
    expect(numeric).toEqual({ raw: '12345', numeric: 12345n });

    const alphanumeric = threadUtils.toThreadId('ABC-123');
    expect(alphanumeric).toEqual({ raw: 'ABC-123', numeric: null });

    expect(threadUtils.toThreadId(null)).toBeNull();
  });

  test('isThreadNewer compares numeric and lexical ids', () => {
    const base = threadUtils.toThreadId('100');
    const older = threadUtils.toThreadId('99');
    const newer = threadUtils.toThreadId('101');

    expect(threadUtils.isThreadNewer(newer, base)).toBe(true);
    expect(threadUtils.isThreadNewer(older, base)).toBe(false);

    const lexicalBase = threadUtils.toThreadId('ABC');
    const lexicalNew = threadUtils.toThreadId('ABD');
    expect(threadUtils.isThreadNewer(lexicalNew, lexicalBase)).toBe(true);
  });

  test('buildThreadUrl constructs canonical URLs', () => {
    expect(threadUtils.buildThreadUrl('123', 'test-slug')).toMatch(/123\/thread\/test-slug$/);
    expect(threadUtils.buildThreadUrl('456', null)).toMatch(/456$/);
  });
});

describe('descriptionBuilder', () => {
  test('formatPlainText strips markup and normalises whitespace', () => {
    const input = '<p>Hello</p><br><p><b>world</b></p>';
    expect(descriptionBuilder.formatPlainText(input)).toBe('Hello\n\nworld');
  });

  test('buildDescriptionFromBlocks handles ordered and unordered lists', () => {
    const blocks = [
      {
        type: 'text',
        data: {
          blocks: [
            { type: 'unordered-list-item', text: 'First bullet' },
            { type: 'ordered-list-item', text: 'Number one' },
            { type: 'ordered-list-item', text: 'Number two' }
          ]
        }
      }
    ];

    const description = descriptionBuilder.buildDescriptionFromBlocks(blocks);
    expect(description).toContain('- First bullet');
    expect(description).toContain('1. Number one');
    expect(description).toContain('2. Number two');
  });

  test('buildDescriptionFromThread renders different block types', () => {
    const threadDetails = {
      content_blocks: [
        {
          data: {
            blocks: [
              { type: 'header-one', text: 'Heading' },
              { type: 'header-two', text: 'Subheading' },
              { type: 'unordered-list-item', text: 'Point' },
              { type: 'ordered-list-item', text: 'Step' },
              { type: 'blockquote', text: 'Quote' },
              { type: 'unstyled', text: 'Paragraph text' }
            ]
          }
        }
      ]
    };

    const description = descriptionBuilder.buildDescriptionFromThread(threadDetails);
    expect(description).toContain('**Heading**');
    expect(description).toContain('__Subheading__');
    expect(description).toContain('- Point');
    expect(description).toContain('1. Step');
    expect(description).toContain('> Quote');
    expect(description).toContain('Paragraph text');
  });

  test('buildDescriptionFromThread returns fallback when content missing', () => {
    expect(descriptionBuilder.buildDescriptionFromThread({})).toBeNull();
  });

  test('extractImageUrl prefers large then direct URL', () => {
    const blocks = [
      {
        type: 'image',
        data: [
          {
            data: {
              sizes: {
                small: { url: 'https://example.com/small.png' },
                large: { url: 'https://example.com/large.png' }
              }
            }
          },
          {
            data: {
              url: 'https://example.com/direct.png'
            }
          }
        ]
      }
    ];

    expect(descriptionBuilder.extractImageUrl(blocks)).toBe('https://example.com/large.png');
    expect(descriptionBuilder.extractImageUrl(null)).toBeNull();
  });
});

describe('session helpers', () => {
  beforeEach(() => {
    session.sessionCache.clear();
    global.Date.now = ORIGINAL_NOW;
  });

  afterAll(() => {
    global.Date.now = ORIGINAL_NOW;
  });

  test('extractCookieValue finds matching cookie case insensitively', () => {
    const cookies = ['foo=bar; Path=/', 'Rsi-Token=abc123; HttpOnly'];
    expect(session.extractCookieValue(cookies, 'Rsi-Token')).toBe('abc123');
    expect(session.extractCookieValue(cookies, 'missing')).toBeNull();
  });

  test('extractMarkToken prefers single quotes but handles double quotes', () => {
    const single = "window.__data = {'token':'single'}";
    const double = '"token":"double"';
    expect(session.extractMarkToken(single)).toBe('single');
    expect(session.extractMarkToken(double)).toBe('double');
  });

  test('getSetCookieHeaders handles fetch polyfills', () => {
    const response = {
      headers: {
        getSetCookie: () => ['a=1']
      }
    };
    expect(session.getSetCookieHeaders(response)).toEqual(['a=1']);

    const responseRaw = {
      headers: {
        raw: () => ({ 'set-cookie': ['b=2'] })
      }
    };
    expect(session.getSetCookieHeaders(responseRaw)).toEqual(['b=2']);

    const responseGet = {
      headers: {
        get: name => (name === 'set-cookie' ? 'c=3' : null)
      }
    };
    expect(session.getSetCookieHeaders(responseGet)).toEqual(['c=3']);
  });

  test('buildSessionObject constructs headers', () => {
    const sessionObj = session.buildSessionObject({ rsiToken: 'abc', markToken: 'def' }, 123);
    expect(sessionObj).toMatchObject({
      forumId: '123',
      cookieHeader: 'Rsi-Token=abc; Rsi-Mark=def'
    });
    expect(session.buildSessionObject({}, 1)).toBeNull();
  });

  test('cache and read cached tokens honour TTL', () => {
    global.Date.now = () => 1000;
    session.cacheSessionTokens({ rsiToken: 'abc', markToken: 'def' });
    expect(session.readCachedTokens()).toEqual({ rsiToken: 'abc', markToken: 'def' });

    global.Date.now = () => Number.MAX_SAFE_INTEGER;
    expect(session.readCachedTokens()).toBeNull();
    expect(session.readCachedTokens({ allowExpired: true })).toEqual({ rsiToken: 'abc', markToken: 'def' });
  });
});
