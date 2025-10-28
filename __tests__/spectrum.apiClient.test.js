jest.mock('../spectrum/watcher/session', () => ({
  createSpectrumSession: jest.fn()
}));

const session = require('../spectrum/watcher/session');
const apiClient = require('../spectrum/watcher/apiClient');

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.resetAllMocks();
});

afterAll(() => {
  delete global.fetch;
});

describe('spectrum api client', () => {
  test('spectrumApiPost returns null when session missing', async () => {
    const result = await apiClient.spectrumApiPost(null, '/endpoint', {});
    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('spectrumApiPost returns data when request succeeds', async () => {
    const payload = { success: 1, data: { threads: [1, 2, 3] } };
    global.fetch.mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue(JSON.stringify(payload))
    });

    const sessionObj = { markToken: 'm', rsiToken: 'r', referer: 'ref', cookieHeader: 'cookie' };
    const data = await apiClient.spectrumApiPost(sessionObj, '/threads', {});

    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/threads'), expect.any(Object));
    expect(data).toEqual(payload.data);
  });

  test('spectrumApiPost logs and returns null on HTTP failure', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: jest.fn().mockResolvedValue('error body')
    });

    const result = await apiClient.spectrumApiPost({ markToken: 'm', rsiToken: 'r', referer: '', cookieHeader: '' }, '/fail', {});

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('spectrumApiPost guards against invalid JSON payloads', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch.mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue('{"missing":"quote}')
    });

    const result = await apiClient.spectrumApiPost({ markToken: 'm', rsiToken: 'r', referer: '', cookieHeader: '' }, '/bad-json', {});
    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('invalid JSON payload'), expect.any(Error));
    consoleSpy.mockRestore();
  });

  test('spectrumApiPost handles success flag equalling zero', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch.mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue(JSON.stringify({ success: 0, msg: 'blocked' }))
    });

    const result = await apiClient.spectrumApiPost({ markToken: 'm', rsiToken: 'r', referer: '', cookieHeader: '' }, '/blocked', {});
    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('API responded with failure for /blocked: blocked'));
    consoleSpy.mockRestore();
  });

  test('spectrumApiPost catches network errors', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch.mockRejectedValue(new Error('bad network'));

    const result = await apiClient.spectrumApiPost({ markToken: 'm', rsiToken: 'r', referer: '', cookieHeader: '' }, '/crash', {});
    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('request to /crash threw'), expect.any(Error));
    consoleSpy.mockRestore();
  });

  test('fetchThreadsWithSession returns empty array when session creation fails', async () => {
    session.createSpectrumSession.mockResolvedValue(null);

    const { threads, session: sessionResult } = await apiClient.fetchThreadsWithSession('forum');

    expect(threads).toEqual([]);
    expect(sessionResult).toBeNull();
  });

  test('fetchThreadsWithSession returns threads when api succeeds', async () => {
    session.createSpectrumSession.mockResolvedValue({ markToken: 'm', rsiToken: 'r', referer: '', cookieHeader: '' });

    const payload = { success: 1, data: { threads: [{ id: 1 }] } };
    global.fetch.mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue(JSON.stringify(payload))
    });

    const result = await apiClient.fetchThreadsWithSession('forum');
    expect(result.session).toBeTruthy();
    expect(result.threads).toEqual([{ id: 1 }]);
  });

  test('fetchThreadsWithSession returns empty when API payload lacks thread list', async () => {
    session.createSpectrumSession.mockResolvedValue({ markToken: 'm', rsiToken: 'r', referer: '', cookieHeader: '' });
    const payload = { success: 1, data: {} };
    global.fetch.mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue(JSON.stringify(payload))
    });

    const result = await apiClient.fetchThreadsWithSession('forum-x');
    expect(result.threads).toEqual([]);
    expect(result.session).toBeTruthy();
  });

  test('fetchThreadDetails passes slug and sort mode', async () => {
    const sessionObj = { markToken: 'm', rsiToken: 'r', referer: '', cookieHeader: '' };
    const payload = { success: 1, data: { posts: [] } };
    global.fetch.mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue(JSON.stringify(payload))
    });

    const result = await apiClient.fetchThreadDetails(sessionObj, 'test-slug');
    expect(result).toEqual(payload.data);
    const [, options] = global.fetch.mock.calls[0];
    expect(JSON.parse(options.body)).toMatchObject({ slug: 'test-slug' });
  });
});
