const { postToDiscord } = require('../spectrum/watcher/poster');
const descriptionBuilder = require('../spectrum/watcher/descriptionBuilder');

jest.mock('../spectrum/watcher/descriptionBuilder', () => {
  const actual = jest.requireActual('../spectrum/watcher/descriptionBuilder');
  return {
    ...actual,
    buildDescriptionFromThread: jest.fn(actual.buildDescriptionFromThread),
    extractImageUrl: jest.fn(actual.extractImageUrl)
  };
});

describe('spectrum poster', () => {
  const baseThreadDetails = {
    slug: 'thread-slug',
    content_blocks: [
      {
        data: {
          blocks: [
            { type: 'unstyled', text: 'Thread body' }
          ]
        }
      }
    ],
    category: { name: 'Patch Notes' }
  };

  const baseThreadInfo = { subject: 'Thread Subject', id: 42 };

  function createClient(sendImpl = jest.fn().mockResolvedValue(undefined)) {
    const channel = {
      isTextBased: () => true,
      send: sendImpl
    };

    return {
      user: { displayAvatarURL: () => 'https://avatar.example/123.png' },
      channels: {
        fetch: jest.fn(async () => channel)
      },
      __mock: { channel }
    };
  }

  test('sends embed with derived metadata when configuration is valid', async () => {
    const client = createClient();
    const guildConfig = { forumId: '123', announceChannelId: '456' };

    const success = await postToDiscord(client, guildConfig, baseThreadInfo, baseThreadDetails);

    expect(success).toBe(true);
    expect(client.channels.fetch).toHaveBeenCalledWith('456');

    const [{ embeds }] = client.__mock.channel.send.mock.calls[0];
    const embedData = embeds[0].data;
    expect(embedData.title).toBe('Thread Subject');
    expect(embedData.url).toContain('/123/thread/thread-slug');
    expect(embedData.description).toContain('Thread body');
    expect(embedData.footer.text).toContain('Patch Notes');
  });

  test('returns false when channel fetch fails', async () => {
    const client = {
      user: { displayAvatarURL: () => '' },
      channels: {
        fetch: jest.fn().mockResolvedValue(null)
      }
    };

    const result = await postToDiscord(client, { announceChannelId: 'chan' }, baseThreadInfo, baseThreadDetails);
    expect(result).toBe(false);
  });

  test('returns false when fetched channel is not text capable', async () => {
    const client = {
      user: { displayAvatarURL: () => '' },
      channels: {
        fetch: jest.fn().mockResolvedValue({
          isTextBased: () => false
        })
      }
    };

    const result = await postToDiscord(client, { announceChannelId: 'chan' }, baseThreadInfo, baseThreadDetails);
    expect(result).toBe(false);
  });

  test('handles send errors gracefully', async () => {
    const error = new Error('send failed');
    const send = jest.fn().mockRejectedValue(error);
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const client = createClient(send);
    const result = await postToDiscord(client, { forumId: '321', announceChannelId: '999' }, baseThreadInfo, baseThreadDetails);

    expect(result).toBe(false);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  test('skips when configuration missing channel id', async () => {
    const client = createClient();
    const result = await postToDiscord(client, { forumId: '123' }, baseThreadInfo, baseThreadDetails);
    expect(result).toBe(false);
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });

  test('does not set empty descriptions', async () => {
    const client = createClient();
    descriptionBuilder.buildDescriptionFromThread.mockReturnValueOnce('   ');

    await postToDiscord(client, { forumId: '123', announceChannelId: '456' }, baseThreadInfo, baseThreadDetails);

    const [{ embeds }] = client.__mock.channel.send.mock.calls[0];
    expect(embeds[0].data.description).toBeUndefined();
  });
});
