const session = require('../spectrum/watcher/session');

beforeEach(() => {
  session.sessionCache.clear();
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.resetAllMocks();
});

afterAll(() => {
  delete global.fetch;
});

describe('spectrum session helpers', () => {
  test('fetchSessionTokens parses tokens from headers and html', async () => {
    const response = {
      ok: true,
      text: jest.fn().mockResolvedValue("window.__data={'token':'mark-123'}"),
      headers: {
        getSetCookie: () => ['Rsi-Token=rsi-456; Path=/;']
      }
    };

    global.fetch.mockResolvedValue(response);

    const tokens = await session.fetchSessionTokens('https://example.com/forum');

    expect(tokens).toEqual({ rsiToken: 'rsi-456', markToken: 'mark-123' });
    expect(session.readCachedTokens()).toEqual({ rsiToken: 'rsi-456', markToken: 'mark-123' });
  });

  test('fetchSessionTokens returns null on network failure', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch.mockRejectedValue(new Error('network down'));

    const tokens = await session.fetchSessionTokens('https://example.com/forum');
    expect(tokens).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('fetchSessionTokens logs warning when response is not ok', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch.mockResolvedValue({
      ok: false,
      status: 429,
      text: jest.fn().mockResolvedValue('rate limited'),
      headers: { getSetCookie: () => [] }
    });

    const tokens = await session.fetchSessionTokens('https://example.com/forum');
    expect(tokens).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('token preflight failed'));
    consoleSpy.mockRestore();
  });

  test('createSpectrumSession uses cached tokens when refresh fails', async () => {
    session.cacheSessionTokens({ rsiToken: 'cached-token', markToken: 'cached-mark' });
    global.fetch.mockResolvedValue({ ok: false, status: 500, text: jest.fn().mockResolvedValue('err'), headers: { getSetCookie: () => [] } });

    const sessionObj = await session.createSpectrumSession('forum-123');
    expect(sessionObj).toMatchObject({
      forumId: 'forum-123',
      cookieHeader: 'Rsi-Token=cached-token; Rsi-Mark=cached-mark'
    });
  });

  test('createSpectrumSession returns null when all attempts fail', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch.mockResolvedValue({ ok: false, status: 500, text: jest.fn().mockResolvedValue('err'), headers: { getSetCookie: () => [] } });

    const result = await session.createSpectrumSession('forum-miss');
    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('missing tokens for forum forum-miss'));
    consoleSpy.mockRestore();
  });

  test('extractCookieValue handles mixed input', () => {
    const cookies = [42, '  RSI-Token=upper;', 'rsi-token=lower; Path=/'];
    expect(session.extractCookieValue(cookies, 'RSI-Token')).toBe('upper');
    expect(session.extractCookieValue(cookies, 'rsi-token')).toBe('lower');
    expect(session.extractCookieValue(cookies, 'missing')).toBeNull();
  });

  test('extractMarkToken reads both quote styles', () => {
    expect(session.extractMarkToken('{"token":"abc"}')).toBe('abc');
    expect(session.extractMarkToken("window.__data={'token':'xyz'}")).toBe('xyz');
  });

  test('getSetCookieHeaders inspects raw/get fallbacks', () => {
    const headers = {
      raw: () => ({ 'set-cookie': ['one'], 'Set-Cookie': ['two'] })
    };
    expect(session.getSetCookieHeaders({ headers })).toEqual(['one']);

    const headersGet = {
      get: () => 'single-cookie'
    };
    expect(session.getSetCookieHeaders({ headers: headersGet })).toEqual(['single-cookie']);
  });

  test('buildSessionObject returns null when tokens missing', () => {
    expect(session.buildSessionObject({}, 'forum')).toBeNull();
  });

  test('readCachedTokens respects expiry and allowExpired option', () => {
    session.sessionCache.set('global', {
      rsiToken: 'cached',
      markToken: 'mark',
      expiresAt: Date.now() - 1000
    });

    expect(session.readCachedTokens()).toBeNull();
    expect(session.readCachedTokens({ allowExpired: true })).toEqual({ rsiToken: 'cached', markToken: 'mark' });
  });
});
