jest.mock('../database', () => {
  const pool = {
    query: jest.fn()
  };
  return {
    getPool: () => pool,
    __pool: pool
  };
});

jest.mock('../spectrum/config', () => ({
  initialize: jest.fn().mockResolvedValue(),
  onReady: jest.fn().mockResolvedValue(),
  getSlashCommandDefinitions: jest.fn(() => ({ global: [], guild: [] })),
  handleInteraction: jest.fn(),
  fetchConfig: jest.fn(),
  getConfigsSnapshot: jest.fn(() => [])
}));

jest.mock('../spectrum/watcher/apiClient', () => ({
  fetchThreadsWithSession: jest.fn(),
  fetchThreads: jest.fn(),
  fetchThreadDetails: jest.fn()
}));

jest.mock('../spectrum/watcher/poster', () => ({
  postToDiscord: jest.fn()
}));

jest.mock('../spectrum/watcher/stateStore', () => {
  const stateCache = new Map();
  return {
    stateCache,
    ensureStateSchema: jest.fn(),
    loadState: jest.fn(),
    getLastSeenThread: jest.fn(),
    setLastSeenThread: jest.fn()
  };
});

let spectrumConfig;
let apiClient;
let poster;
let stateStore;
let service;

const { buildThreadUrl } = require('../spectrum/watcher/threadUtils');

describe('spectrum watcher service', () => {
  beforeEach(() => {
    jest.resetModules();
    service = require('../spectrum/watcher/service');
    spectrumConfig = require('../spectrum/config');
    apiClient = require('../spectrum/watcher/apiClient');
    poster = require('../spectrum/watcher/poster');
    stateStore = require('../spectrum/watcher/stateStore');

    apiClient.fetchThreadsWithSession.mockReset();
    apiClient.fetchThreadDetails.mockReset();
    poster.postToDiscord.mockReset();
    spectrumConfig.fetchConfig.mockReset();
    spectrumConfig.getConfigsSnapshot.mockReset().mockReturnValue([]);
    stateStore.getLastSeenThread.mockReset().mockResolvedValue(null);
    stateStore.setLastSeenThread.mockReset();
    stateStore.stateCache.clear();
  });

  test('postLatestThreadForGuild returns error when config missing', async () => {
    spectrumConfig.fetchConfig.mockResolvedValue(null);

    const result = await service.postLatestThreadForGuild({}, 'guild-x');
    expect(result).toEqual({ ok: false, message: 'Spectrum Watcher is not configured for this server.' });
  });

  test('postLatestThreadForGuild returns error when forum not configured', async () => {
    spectrumConfig.fetchConfig.mockResolvedValue({ guildId: 'guild-1', announceChannelId: 'chan' });

    const result = await service.postLatestThreadForGuild({}, 'guild-1');
    expect(result).toEqual({ ok: false, message: 'No forum ID is configured for this server.' });
  });

  test('postLatestThreadForGuild returns error when announce channel missing', async () => {
    spectrumConfig.fetchConfig.mockResolvedValue({ guildId: 'guild-announce', forumId: '42' });

    const result = await service.postLatestThreadForGuild({}, 'guild-announce');
    expect(result).toEqual({ ok: false, message: 'No announcement channel is configured for this server.' });
  });

  test('postLatestThreadForGuild posts latest thread and records state', async () => {
    const thread = { id: 100, slug: 'test-thread', subject: 'Test Thread' };
    const details = { blocks: [] };

    spectrumConfig.fetchConfig.mockResolvedValue({
      guildId: 'guild-2',
      forumId: '42',
      announceChannelId: 'chan-2'
    });

    apiClient.fetchThreadsWithSession.mockResolvedValue({
      threads: [thread],
      session: { token: 'abc' }
    });

    apiClient.fetchThreadDetails.mockResolvedValue(details);
    poster.postToDiscord.mockResolvedValue(true);

    const result = await service.postLatestThreadForGuild({ id: 'client' }, 'guild-2');

    expect(result.ok).toBe(true);
    expect(result.thread).toBe(thread);
    expect(result.threadDetails).toBe(details);
    expect(result.threadUrl).toBe(buildThreadUrl('42', 'test-thread'));
    expect(result.channelId).toBe('chan-2');
    expect(stateStore.setLastSeenThread).toHaveBeenCalledWith('guild-2', '100');
  });

  test('postLatestThreadForGuild returns failure when details cannot be loaded', async () => {
    spectrumConfig.fetchConfig.mockResolvedValue({
      guildId: 'guild-err',
      forumId: '55',
      announceChannelId: 'chan-err'
    });

    apiClient.fetchThreadsWithSession.mockResolvedValue({
      threads: [{ id: 200, slug: 'missing-details' }],
      session: { token: 'session' }
    });

    apiClient.fetchThreadDetails.mockResolvedValue(null);

    const result = await service.postLatestThreadForGuild({}, 'guild-err');
    expect(result).toEqual({ ok: false, message: 'Unable to load the latest thread details from Spectrum.' });
  });

  test('postLatestThreadForGuild surfaces send failure', async () => {
    spectrumConfig.fetchConfig.mockResolvedValue({
      guildId: 'guild-err2',
      forumId: '56',
      announceChannelId: 'chan'
    });

    apiClient.fetchThreadsWithSession.mockResolvedValue({
      threads: [{ id: 300, slug: 'post-failure', subject: 'Failure Thread' }],
      session: { token: 'session' }
    });

    apiClient.fetchThreadDetails.mockResolvedValue({ blocks: [] });
    poster.postToDiscord.mockResolvedValue(false);

    const result = await service.postLatestThreadForGuild({}, 'guild-err2');
    expect(result).toEqual({ ok: false, message: 'Failed to send the latest thread to the configured channel.' });
  });

  test('getLatestThreadSnapshot surfaces latest thread metadata', async () => {
    const guildConfig = { guildId: 'guild-3', forumId: '99', announceChannelId: 'chan-3' };

    spectrumConfig.fetchConfig.mockResolvedValue(guildConfig);

    apiClient.fetchThreadsWithSession.mockResolvedValue({
      threads: [{ id: 10, slug: 'snapshot-thread', thread: { slug: 'snapshot-thread' } }],
      session: { token: 'session' }
    });

    apiClient.fetchThreadDetails.mockResolvedValue({ blocks: [] });

    const result = await service.getLatestThreadSnapshot('guild-3');

    expect(apiClient.fetchThreadsWithSession).toHaveBeenCalledWith('99');
    expect(result.ok).toBe(true);
    expect(result.latestThreadId).toBe('10');
    expect(result.threadUrl).toBe(buildThreadUrl('99', 'snapshot-thread'));
  });

  test('getLatestThreadSnapshot handles missing configuration and data', async () => {
    spectrumConfig.fetchConfig.mockResolvedValue(null);
    await expect(service.getLatestThreadSnapshot('guild-missing')).resolves.toMatchObject({
      ok: false,
      message: 'Spectrum Watcher is not configured for this server.'
    });

    spectrumConfig.fetchConfig.mockResolvedValue({ guildId: 'guild-noforum', forumId: null });
    await expect(service.getLatestThreadSnapshot('guild-noforum')).resolves.toMatchObject({
      ok: false,
      message: 'No forum ID is configured for this server.'
    });

    spectrumConfig.fetchConfig.mockResolvedValue({ guildId: 'guild-nodata', forumId: '88' });
    apiClient.fetchThreadsWithSession.mockResolvedValue({ threads: [], session: null });
    await expect(service.getLatestThreadSnapshot('guild-nodata')).resolves.toMatchObject({
      ok: false,
      message: 'Unable to retrieve threads from Spectrum at the moment.'
    });

    apiClient.fetchThreadsWithSession.mockResolvedValue({
      threads: [{ id: 1, slug: null }],
      session: { token: 'session' }
    });
    await expect(service.getLatestThreadSnapshot('guild-noslug')).resolves.toMatchObject({
      ok: false,
      message: 'The latest thread is missing a slug, so it cannot be fetched.'
    });
  });

  test('checkForNewThreads skips guilds without forum configuration', async () => {
    spectrumConfig.getConfigsSnapshot.mockReturnValue([
      { guildId: 'guild-a', forumId: null },
      { guildId: 'guild-b', forumId: '101', announceChannelId: 'chan-b' }
    ]);

    apiClient.fetchThreadsWithSession.mockResolvedValue({ threads: [], session: {} });

    await service.checkForNewThreads({});

    expect(apiClient.fetchThreadsWithSession).toHaveBeenCalledTimes(1);
    expect(apiClient.fetchThreadsWithSession).toHaveBeenCalledWith('101');
  });

  test('checkForNewThreads stores last seen thread on first run', async () => {
    spectrumConfig.getConfigsSnapshot.mockReturnValue([
      { guildId: 'guild-first', forumId: '50', announceChannelId: 'chan-first' }
    ]);

    apiClient.fetchThreadsWithSession.mockResolvedValue({
      threads: [{ id: 400, slug: 'initial-thread' }],
      session: { token: 'session' }
    });

    stateStore.getLastSeenThread.mockResolvedValueOnce(null);

    await service.checkForNewThreads({});

    expect(stateStore.setLastSeenThread).toHaveBeenCalledWith('guild-first', '400');
    expect(poster.postToDiscord).not.toHaveBeenCalled();
  });

  test('checkForNewThreads posts when a newer thread is available', async () => {
    spectrumConfig.getConfigsSnapshot.mockReturnValue([
      { guildId: 'guild-update', forumId: '60', announceChannelId: 'chan-update' }
    ]);

    apiClient.fetchThreadsWithSession.mockResolvedValue({
      threads: [
        { id: 500, slug: 'old-thread' },
        { id: 501, slug: 'new-thread' }
      ],
      session: { token: 'session' }
    });

    stateStore.getLastSeenThread.mockResolvedValueOnce({ raw: '500', numeric: 500n });
    apiClient.fetchThreadDetails.mockResolvedValue({ posts: [] });
    poster.postToDiscord.mockResolvedValue(true);

    await service.checkForNewThreads({});

    expect(poster.postToDiscord).toHaveBeenCalledWith(expect.any(Object), expect.any(Object), expect.objectContaining({ slug: 'new-thread' }), expect.any(Object));
    expect(stateStore.setLastSeenThread).toHaveBeenCalledWith('guild-update', '501');
  });

  test('utility helpers convert thread ids and ordering', () => {
    const { isThreadNewer, toThreadId } = service.__testables;

    const older = toThreadId('99');
    const newer = toThreadId('100');

    expect(older.numeric).toBe(99n);
    expect(newer.numeric).toBe(100n);
    expect(isThreadNewer(newer, older)).toBe(true);
    expect(isThreadNewer(older, newer)).toBe(false);
  });

  test('initialize executes schema and caching once', async () => {
    const client = {};

    await service.initialize(client);
    expect(spectrumConfig.initialize).toHaveBeenCalledWith(client);
    expect(stateStore.ensureStateSchema).toHaveBeenCalled();
    expect(stateStore.loadState).toHaveBeenCalled();

    const schemaCallCount = stateStore.ensureStateSchema.mock.calls.length;
    await service.initialize(client);
    expect(stateStore.ensureStateSchema.mock.calls.length).toBe(schemaCallCount);
  });

  test('onReady schedules polling and triggers initial check', async () => {
    process.env.SPECTRUM_POLL_INTERVAL_MS = '20000';

    const originalSetInterval = global.setInterval;
    const originalSetTimeout = global.setTimeout;
    let intervalCallback = null;
    let timeoutCallback = null;

    global.setInterval = jest.fn((fn, delay) => {
      intervalCallback = fn;
      return 1;
    });
    global.setTimeout = jest.fn((fn, delay) => {
      timeoutCallback = fn;
      return 1;
    });

    spectrumConfig.getConfigsSnapshot.mockReturnValue([{ guildId: 'guild-timer', forumId: '70', announceChannelId: 'chan-timer' }]);
    apiClient.fetchThreadsWithSession.mockResolvedValue({ threads: [], session: {} });

    await service.initialize({});
    await service.onReady('client-instance');

    expect(typeof timeoutCallback).toBe('function');
    expect(typeof intervalCallback).toBe('function');

    await timeoutCallback();
    await Promise.resolve();
    const firstCallCount = apiClient.fetchThreadsWithSession.mock.calls.length;
    await intervalCallback();
    await Promise.resolve();
    expect(apiClient.fetchThreadsWithSession.mock.calls.length).toBeGreaterThanOrEqual(firstCallCount);

    await intervalCallback();
    await Promise.resolve();
    expect(apiClient.fetchThreadsWithSession.mock.calls.length).toBeGreaterThan(firstCallCount);

    global.setInterval = originalSetInterval;
   global.setTimeout = originalSetTimeout;
   delete process.env.SPECTRUM_POLL_INTERVAL_MS;
  });

  test('checkForNewThreads warns when new thread lacks slug', async () => {
    spectrumConfig.getConfigsSnapshot.mockReturnValue([
      { guildId: 'guild-noslug', forumId: '61', announceChannelId: 'chan-noslug' }
    ]);

    stateStore.getLastSeenThread.mockResolvedValueOnce({ raw: '100', numeric: 100n });
    apiClient.fetchThreadsWithSession.mockResolvedValue({
      threads: [{ id: 101, subject: 'No Slug Thread' }],
      session: { token: 'session' }
    });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await service.checkForNewThreads({});

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing slug'));
    expect(poster.postToDiscord).not.toHaveBeenCalled();
    expect(stateStore.setLastSeenThread).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('checkForNewThreads leaves state untouched when posting fails', async () => {
    spectrumConfig.getConfigsSnapshot.mockReturnValue([
      { guildId: 'guild-postfail', forumId: '62', announceChannelId: 'chan-postfail' }
    ]);

    stateStore.getLastSeenThread.mockResolvedValueOnce({ raw: '200', numeric: 200n });
    apiClient.fetchThreadsWithSession.mockResolvedValue({
      threads: [{ id: 201, slug: 'new-thread' }],
      session: { token: 'session' }
    });

    apiClient.fetchThreadDetails.mockResolvedValue({ posts: [] });
    poster.postToDiscord.mockResolvedValue(false);

    await service.checkForNewThreads({});

    expect(poster.postToDiscord).toHaveBeenCalled();
    expect(stateStore.setLastSeenThread).not.toHaveBeenCalled();
  });

  test('checkForNewThreads ignores overlapping invocations', async () => {
    spectrumConfig.getConfigsSnapshot.mockReturnValue([
      { guildId: 'guild-concurrent', forumId: '63', announceChannelId: 'chan-concurrent' }
    ]);

    let resolveFetch;
    apiClient.fetchThreadsWithSession.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveFetch = resolve;
        })
    );

    const inFlight = service.checkForNewThreads({});
    const skipped = service.checkForNewThreads({});
    expect(apiClient.fetchThreadsWithSession).toHaveBeenCalledTimes(1);

    resolveFetch({ threads: [], session: {} });

    await Promise.all([inFlight, skipped]);
  });
});
