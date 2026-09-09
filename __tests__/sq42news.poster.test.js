jest.mock('../sq42news/watcher/stateStore', () => ({
  getState: jest.fn(),
  setState: jest.fn(),
}));

const stateStore = require('../sq42news/watcher/stateStore');
const { postItem } = require('../sq42news/watcher/poster');

describe('sq42news poster cross-source dedupe', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stateStore.getState.mockResolvedValue(null);
    stateStore.setState.mockResolvedValue(undefined);
  });

  function createClient(sendImpl = jest.fn().mockResolvedValue(undefined)) {
    const channel = { isTextBased: () => true, send: sendImpl };
    return {
      user: { displayAvatarURL: () => 'https://avatar.example/1.png' },
      channels: { fetch: jest.fn(async () => channel) },
      __mock: { channel },
    };
  }

  test('posts and records the story when nothing has been posted yet', async () => {
    const client = createClient();
    const ok = await postItem(client, 'chan-1', { title: 'Squadron 42 Monthly Report', url: 'https://a' }, 'commlinks', { guildId: 'g1' });

    expect(ok).toBe(true);
    expect(client.__mock.channel.send).toHaveBeenCalledTimes(1);
    expect(stateStore.setState).toHaveBeenCalledWith('g1', 'dedupe', expect.objectContaining({
      entries: expect.arrayContaining([expect.objectContaining({ key: 'squadron 42 monthly report' })]),
    }));
  });

  test('skips posting a story already posted for the guild, even from a different source', async () => {
    stateStore.getState.mockResolvedValue({
      entries: [{ key: 'cig reveals squadron 42 gameplay', postedAt: Date.now() }],
    });

    const client = createClient();
    const ok = await postItem(
      client,
      'chan-1',
      { title: 'CIG Reveals Squadron 42 Gameplay - IGN', url: 'https://b' },
      'press',
      { guildId: 'g1' }
    );

    expect(ok).toBe(false);
    expect(client.channels.fetch).not.toHaveBeenCalled();
    expect(stateStore.setState).not.toHaveBeenCalled();
  });

  test('ignores dedupe entries older than the rolling window', async () => {
    const staleTimestamp = Date.now() - (4 * 24 * 60 * 60 * 1000); // 4 days ago, window is 3 days
    stateStore.getState.mockResolvedValue({
      entries: [{ key: 'squadron 42 monthly report', postedAt: staleTimestamp }],
    });

    const client = createClient();
    const ok = await postItem(client, 'chan-1', { title: 'Squadron 42 Monthly Report', url: 'https://c' }, 'youtube', { guildId: 'g1' });

    expect(ok).toBe(true);
    expect(client.__mock.channel.send).toHaveBeenCalledTimes(1);
  });

  test('does not dedupe when no guildId is provided (e.g. preview)', async () => {
    const client = createClient();
    const ok = await postItem(client, 'chan-1', { title: 'Squadron 42 Monthly Report', url: 'https://d' }, 'commlinks');

    expect(ok).toBe(true);
    expect(stateStore.getState).not.toHaveBeenCalled();
    expect(stateStore.setState).not.toHaveBeenCalled();
  });
});
