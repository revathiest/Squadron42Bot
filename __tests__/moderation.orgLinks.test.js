const { ChannelType } = require('discord.js');

describe('moderation org link handler', () => {
  let handler;
  let database;
  let forumRows;
  let orgRows;
  const forumId = 'forum-123';

  beforeEach(() => {
    jest.resetModules();

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
    forumRows = [{ channel_id: forumId }];
    orgRows = [];

    database.__pool.query.mockImplementation((sql, params) => {
      if (sql.includes('FROM moderation_org_forum_channels')) {
        return Promise.resolve([forumRows]);
      }

      if (sql.includes('FROM moderation_org_posts')) {
        return Promise.resolve([orgRows]);
      }

      if (sql.includes('INSERT INTO moderation_org_posts')) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }

      return Promise.resolve([{ affectedRows: 0 }]);
    });

    handler.clearOrgForumCache();
  });

  afterEach(() => {
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

  test('removes org links posted outside configured forums', async () => {
    const message = baseMessage({ content: 'https://robertsspaceindustries.com/en/orgs/FOO' });

    await handler.handleMessageCreate(message);

    expect(database.__pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FROM moderation_org_forum_channels'),
      [message.guildId]
    );
    expect(message.delete).toHaveBeenCalledWith('Organization links are restricted to the configured forum channels.');
    expect(message.author.send).toHaveBeenCalledWith(expect.stringContaining(`<#${forumId}>`));
  });

  test('handles consecutive org link messages without losing matches', async () => {
    const messageOne = baseMessage({ content: 'https://robertsspaceindustries.com/en/orgs/FOO' });
    const messageTwo = baseMessage({ content: 'https://robertsspaceindustries.com/en/orgs/BAR' });

    await handler.handleMessageCreate(messageOne);
    await handler.handleMessageCreate(messageTwo);

    expect(messageOne.delete).toHaveBeenCalled();
    expect(messageTwo.delete).toHaveBeenCalledWith('Organization links are restricted to the configured forum channels.');
  });

  test('records first-time org promotions inside configured forum', async () => {
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

    await handler.handleMessageCreate(message);

    expect(database.__pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FROM moderation_org_forum_channels'),
      ['guild-1']
    );
    expect(database.__pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FROM moderation_org_posts'),
      ['guild-1', 'BAR']
    );
    expect(database.__pool.query).toHaveBeenNthCalledWith(
      3,
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

    orgRows = [
      {
        guild_id: 'guild-1',
        org_code: 'BETA',
        channel_id: 'thread-1',
        message_id: 'message-original',
        author_id: 'user-original'
      }
    ];

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

    orgRows = [
      {
        guild_id: 'guild-1',
        org_code: 'GAMMA',
        channel_id: 'thread-1',
        message_id: 'message-old',
        author_id: 'user-old'
      }
    ];

    message.client.channels.fetch.mockResolvedValue({
      isTextBased: () => true,
      messages: { fetch: jest.fn().mockRejectedValue(new Error('missing')) }
    });

    await handler.handleMessageCreate(message);

    expect(database.__pool.query).toHaveBeenNthCalledWith(
      3,
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
    database.__pool.query.mockImplementation((sql) => {
      if (sql.includes('FROM moderation_org_forum_channels')) {
        return Promise.resolve([[]]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });
    handler.clearOrgForumCache();
  });

  afterEach(() => {
    jest.resetModules();
  });

  test('notifies once that forums are missing and removes links', async () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

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

    expect(database.__pool.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM moderation_org_forum_channels'),
      [message.guildId]
    );
    expect(message.delete).toHaveBeenCalledWith('Organization links are restricted to the configured forum channels.');
    const noticeCalls = infoSpy.mock.calls.filter(
      ([message]) => typeof message === 'string' && message.startsWith('moderation: no org promotion forums configured')
    );
    expect(noticeCalls).toHaveLength(1);

    infoSpy.mockRestore();
  });
});

describe('maybeDeleteEmptyThread helper', () => {
  let maybeDeleteEmptyThread;

  beforeEach(() => {
    jest.resetModules();

    jest.doMock('../database', () => {
      const pool = {
        query: jest.fn()
      };
      return {
        getPool: () => pool
      };
    });

    const orgLinks = require('../moderation/handlers/orgLinks');
    ({ __testables: { maybeDeleteEmptyThread } } = orgLinks);
    orgLinks.clearOrgForumCache();
  });

  afterEach(() => {
    jest.resetModules();
  });

  test('deletes empty thread', async () => {
    const deleteFn = jest.fn().mockResolvedValue(undefined);
    const channel = {
      id: 'thread-1',
      parentId: 'forum-1',
      isThread: () => true,
      messages: {
        fetch: jest.fn().mockResolvedValue(new Map())
      },
      delete: deleteFn
    };

    await maybeDeleteEmptyThread(channel, 'Cleanup');

    expect(channel.messages.fetch).toHaveBeenCalledWith({ limit: 2 });
    expect(deleteFn).toHaveBeenCalledWith('Cleanup');
  });

  test('skips when thread not empty or fetch fails', async () => {
    const nonEmptyChannel = {
      isThread: () => true,
      messages: {
        fetch: jest.fn().mockResolvedValue(new Map([['1', {}]]))
      },
      delete: jest.fn()
    };

    await maybeDeleteEmptyThread(nonEmptyChannel, 'Should not delete');
    expect(nonEmptyChannel.delete).not.toHaveBeenCalled();

    const errorChannel = {
      isThread: () => true,
      messages: {
        fetch: jest.fn().mockRejectedValue(new Error('failed'))
      },
      delete: jest.fn()
    };

    await maybeDeleteEmptyThread(errorChannel, 'Error path');
    expect(errorChannel.delete).not.toHaveBeenCalled();
  });
});

describe('org promotion forum cache helpers', () => {
  let orgLinks;
  let database;

  beforeEach(() => {
    jest.resetModules();

    jest.doMock('../database', () => {
      const pool = {
        query: jest.fn()
      };
      return {
        getPool: () => pool,
        __pool: pool
      };
    });

    orgLinks = require('../moderation/handlers/orgLinks');
    database = require('../database');
    orgLinks.clearOrgForumCache();
  });

  afterEach(() => {
    jest.resetModules();
  });

  test('allowOrgForumChannel persists and caches the channel', async () => {
    database.__pool.query.mockImplementation(sql => {
      if (sql.includes('INSERT INTO moderation_org_forum_channels')) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      if (sql.includes('SELECT channel_id FROM moderation_org_forum_channels')) {
        return Promise.resolve([[{ channel_id: 'forum-allow' }]]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });

    await orgLinks.allowOrgForumChannel('guild-allow', 'forum-allow', 'user-allow');
    const forums = await orgLinks.listOrgForumChannels('guild-allow');
    expect(forums).toEqual(['forum-allow']);
  });

  test('disallowOrgForumChannel removes the channel from cache', async () => {
    const storedForums = new Set();
    database.__pool.query.mockImplementation((sql, params) => {
      if (sql.includes('INSERT INTO moderation_org_forum_channels')) {
        storedForums.add(params[1]);
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      if (sql.includes('DELETE FROM moderation_org_forum_channels')) {
        const removed = storedForums.delete(params[1]);
        return Promise.resolve([{ affectedRows: removed ? 1 : 0 }]);
      }
      if (sql.includes('SELECT channel_id FROM moderation_org_forum_channels')) {
        return Promise.resolve([Array.from(storedForums).map(channel_id => ({ channel_id }))]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });

    await orgLinks.allowOrgForumChannel('guild-remove', 'forum-remove', 'user-remove');
    expect(await orgLinks.listOrgForumChannels('guild-remove')).toEqual(['forum-remove']);

    await orgLinks.disallowOrgForumChannel('guild-remove', 'forum-remove');
    expect(await orgLinks.listOrgForumChannels('guild-remove')).toEqual([]);
  });

  test('loadOrgForumCache hydrates cache for multiple guilds', async () => {
    database.__pool.query.mockImplementation(sql => {
      if (sql.includes('SELECT guild_id, channel_id FROM moderation_org_forum_channels')) {
        return Promise.resolve([
          [
            { guild_id: 'guild-a', channel_id: 'forum-a1' },
            { guild_id: 'guild-b', channel_id: 'forum-b1' },
            { guild_id: 'guild-a', channel_id: 'forum-a2' }
          ]
        ]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });

    await orgLinks.loadOrgForumCache();

    expect(await orgLinks.listOrgForumChannels('guild-a')).toEqual(['forum-a1', 'forum-a2']);
    expect(await orgLinks.listOrgForumChannels('guild-b')).toEqual(['forum-b1']);
  });

  test('disallowOrgForumChannel returns false when nothing is removed', async () => {
    database.__pool.query.mockImplementation(sql => {
      if (sql.includes('DELETE FROM moderation_org_forum_channels')) {
        return Promise.resolve([{ affectedRows: 0 }]);
      }
      return Promise.resolve([{ affectedRows: 0 }]);
    });

    const removed = await orgLinks.disallowOrgForumChannel('guild-empty', 'forum-missing');
    expect(removed).toBe(false);
  });
});
