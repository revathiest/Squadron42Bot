const { ChannelType } = require('discord.js');

describe('moderation org link handler', () => {
  let handler;
  let database;
  const forumId = 'forum-123';

  beforeEach(() => {
    jest.resetModules();
    process.env.ORG_PROMO_FORUM_CHANNEL_ID = forumId;

    jest.doMock('../database', () => {
      const pool = {
        query: jest.fn()
      };
      return {
        getPool: () => pool,
        __pool: pool
      };
    });

    handler = require('../moderation/handlers/orgLinks');
    database = require('../database');
  });

  afterEach(() => {
    delete process.env.ORG_PROMO_FORUM_CHANNEL_ID;
    jest.resetModules();
  });

  const baseMessage = (overrides = {}) => ({
    content: '',
    id: 'message-1',
    author: { bot: false, id: 'user-1', send: jest.fn().mockResolvedValue(undefined) },
    guild: { id: 'guild-1' },
    guildId: 'guild-1',
    channel: {
      id: 'channel-1',
      type: ChannelType.GuildText,
      parentId: null,
      isTextBased: () => true
    },
    channelId: 'channel-1',
    client: {
      channels: {
        fetch: jest.fn()
      }
    },
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides
  });

  test('ignores bot messages', async () => {
    const message = baseMessage({ author: { bot: true } });
    await handler.handleMessageCreate(message);
    expect(database.__pool.query).not.toHaveBeenCalled();
    expect(message.delete).not.toHaveBeenCalled();
  });

  test('removes referral codes and notifies user', async () => {
    const message = baseMessage({ content: 'Use STAR-ABCD-1234 for bonuses!' });

    await handler.handleMessageCreate(message);

    expect(message.delete).toHaveBeenCalledWith('Referral codes must be shared via slash commands.');
    expect(message.author.send).toHaveBeenCalledWith(expect.stringContaining('/register-referral-code'));
  });

  test('removes org links posted outside the designated forum', async () => {
    const message = baseMessage({ content: 'https://robertsspaceindustries.com/en/orgs/FOO' });

    await handler.handleMessageCreate(message);

    expect(message.delete).toHaveBeenCalledWith('Organization links are restricted to the designated forum.');
    expect(message.author.send).toHaveBeenCalledWith(expect.stringContaining(`<#${forumId}>`));
  });

  test('handles consecutive org link messages without losing matches', async () => {
    const messageOne = baseMessage({ content: 'https://robertsspaceindustries.com/en/orgs/FOO' });
    const messageTwo = baseMessage({ content: 'https://robertsspaceindustries.com/en/orgs/BAR' });

    await handler.handleMessageCreate(messageOne);
    await handler.handleMessageCreate(messageTwo);

    expect(messageOne.delete).toHaveBeenCalled();
    expect(messageTwo.delete).toHaveBeenCalledWith('Organization links are restricted to the designated forum.');
  });

  test('records first-time org promotions inside the forum', async () => {
    const threadChannel = {
      id: 'thread-1',
      type: ChannelType.PublicThread,
      parentId: forumId,
      isTextBased: () => true
    };

    const message = baseMessage({
      content: 'Check out https://robertsspaceindustries.com/en/orgs/BAR',
      channel: threadChannel,
      channelId: 'thread-1'
    });

    database.__pool.query
      .mockResolvedValueOnce([[]]) // fetchOrgRecord -> none
      .mockResolvedValueOnce([[]]); // insert

    await handler.handleMessageCreate(message);

    expect(database.__pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FROM moderation_org_posts'),
      ['guild-1', 'BAR']
    );
    expect(database.__pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO moderation_org_posts'),
      ['guild-1', 'BAR', 'thread-1', message.id, message.author.id]
    );
    expect(message.delete).not.toHaveBeenCalled();
  });

  test('deletes duplicate org links and references original post', async () => {
    const threadChannel = {
      id: 'thread-1',
      type: ChannelType.PublicThread,
      parentId: forumId,
      isTextBased: () => true
    };

    const message = baseMessage({
      id: 'message-new',
      content: 'Join https://robertsspaceindustries.com/en/orgs/BETA',
      channel: threadChannel,
      channelId: 'thread-1'
    });

    database.__pool.query.mockResolvedValueOnce([
      [
        {
          guild_id: 'guild-1',
          org_code: 'BETA',
          channel_id: 'thread-1',
          message_id: 'message-original',
          author_id: 'user-original'
        }
      ]
    ]);

    const fetchOriginal = jest.fn().mockResolvedValue({
      guildId: 'guild-1',
      channelId: 'thread-1',
      id: 'message-original'
    });

    message.client.channels.fetch.mockResolvedValue({
      isTextBased: () => true,
      messages: { fetch: fetchOriginal }
    });

    await handler.handleMessageCreate(message);

    expect(message.delete).toHaveBeenCalledWith('Duplicate organization promotion detected.');
    expect(message.author.send).toHaveBeenCalledWith(expect.stringContaining('https://discord.com/channels/guild-1/thread-1/message-original'));
  });

  test('updates org record when original message is missing', async () => {
    const threadChannel = {
      id: 'thread-1',
      type: ChannelType.PublicThread,
      parentId: forumId,
      isTextBased: () => true
    };

    const message = baseMessage({
      id: 'message-new',
      content: 'Join https://robertsspaceindustries.com/en/orgs/GAMMA',
      channel: threadChannel,
      channelId: 'thread-1'
    });

    database.__pool.query
      .mockResolvedValueOnce([
        [
          {
            guild_id: 'guild-1',
            org_code: 'GAMMA',
            channel_id: 'thread-1',
            message_id: 'message-old',
            author_id: 'user-old'
          }
        ]
      ])
      .mockResolvedValueOnce([[]]); // force update insert

    message.client.channels.fetch.mockResolvedValue({
      isTextBased: () => true,
      messages: { fetch: jest.fn().mockRejectedValue(new Error('missing')) }
    });

    await handler.handleMessageCreate(message);

    expect(database.__pool.query).toHaveBeenLastCalledWith(
      expect.stringContaining('ON DUPLICATE KEY UPDATE'),
      ['guild-1', 'GAMMA', 'thread-1', 'message-new', 'user-1']
    );
    expect(message.delete).not.toHaveBeenCalled();
  });
});

describe('moderation org link handler without forum configuration', () => {
  let handler;
  let database;

  beforeEach(() => {
    jest.resetModules();
    delete process.env.ORG_PROMO_FORUM_CHANNEL_ID;

    jest.doMock('../database', () => {
      const pool = {
        query: jest.fn()
      };
      return {
        getPool: () => pool,
        __pool: pool
      };
    });

    handler = require('../moderation/handlers/orgLinks');
    database = require('../database');
  });

  afterEach(() => {
    jest.resetModules();
  });

  test('logs a warning once and skips enforcement', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const message = {
      content: 'https://robertsspaceindustries.com/en/orgs/NOFORUM',
      author: { bot: false, id: 'user-xyz', send: jest.fn() },
      guild: { id: 'guild-missing' },
      guildId: 'guild-missing',
      channel: {
        id: 'channel-x',
        type: ChannelType.GuildText,
        parentId: null,
        isTextBased: () => true
      },
      channelId: 'channel-x',
      client: { channels: { fetch: jest.fn() } },
      delete: jest.fn().mockResolvedValue(undefined)
    };

    await handler.handleMessageCreate(message);
    await handler.handleMessageCreate(message);

    expect(database.__pool.query).not.toHaveBeenCalled();
    expect(message.delete).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });
});
