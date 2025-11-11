jest.mock('../database', () => {
  const pool = {
    query: jest.fn()
  };
  return {
    getPool: () => pool,
    __pool: pool
  };
});

jest.mock('../spectrumWatcher', () => ({
  postLatestThreadForGuild: jest.fn()
}));

let database;
let spectrumConfig;
let watcher;
const { ChannelType, MessageFlags } = require('discord.js');

describe('spectrum config module', () => {
  beforeEach(() => {
    jest.resetModules();
    database = require('../database');
    watcher = require('../spectrumWatcher');
    spectrumConfig = require('../spectrum/config');
    database.__pool.query.mockReset().mockResolvedValue([[]]);
    watcher.postLatestThreadForGuild.mockReset();
    spectrumConfig.__testables.configCache.clear();
  });

  test('getSlashCommandDefinitions exposes guild command builder', () => {
    const defs = spectrumConfig.getSlashCommandDefinitions();
    expect(defs.global).toEqual([]);
    expect(defs.guild).toHaveLength(1);
    expect(defs.guild[0].name).toBe('spectrum');
  });

  test('setConfig writes to database and updates cache', async () => {
    await spectrumConfig.setConfig('guild-1', 'channel-1', 'forum-1', 'user-1');

    expect(database.__pool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO spectrum_config'), [
      'guild-1',
      'channel-1',
      'forum-1',
      'user-1'
    ]);

    const cached = spectrumConfig.__testables.configCache.get('guild-1');
    expect(cached).toMatchObject({
      guildId: 'guild-1',
      announceChannelId: 'channel-1',
      forumId: 'forum-1',
      updatedBy: 'user-1'
    });
  });

  test('fetchConfig returns cached value without querying database', async () => {
    spectrumConfig.__testables.configCache.set('guild-2', {
      guildId: 'guild-2',
      announceChannelId: 'chan',
      forumId: 'forum',
      updatedBy: null,
      updatedAt: new Date()
    });

    const result = await spectrumConfig.fetchConfig('guild-2');

    expect(result.guildId).toBe('guild-2');
    expect(database.__pool.query).not.toHaveBeenCalled();
  });

  test('clearConfig deletes configuration from database and cache', async () => {
    spectrumConfig.__testables.configCache.set('guild-3', { guildId: 'guild-3' });

    await spectrumConfig.clearConfig('guild-3');

    expect(database.__pool.query).toHaveBeenCalledWith('DELETE FROM spectrum_config WHERE guild_id = ?', ['guild-3']);
    expect(spectrumConfig.__testables.configCache.has('guild-3')).toBe(false);
  });

  test('loadCache rebuilds cache and skips invalid rows', async () => {
    const fakePool = {
      query: jest.fn().mockResolvedValue([
        [
          {
            guild_id: 'guild-load',
            announce_channel_id: 'chan-load',
            forum_id: null,
            updated_by: 'user-load',
            updated_at: new Date('2025-01-01T00:00:00Z')
          },
          null
        ]
      ])
    };

    await spectrumConfig.__testables.loadCache(fakePool);

    expect(fakePool.query).toHaveBeenCalledTimes(1);
    const cached = spectrumConfig.__testables.configCache.get('guild-load');
    expect(cached).toMatchObject({
      guildId: 'guild-load',
      announceChannelId: 'chan-load',
      forumId: null,
      updatedBy: 'user-load'
    });
    expect(spectrumConfig.__testables.configCache.size).toBe(1);
  });

  test('handleSpectrumCommand set-channel validates channel ownership', async () => {
    const channel = {
      id: 'chan-1',
      guildId: 'guild-1',
      type: ChannelType.GuildText,
      toString: () => '<#chan-1>'
    };

    const interaction = {
      guildId: 'guild-1',
      guild: {},
      user: { id: 'user-1' },
      replied: false,
      deferred: false,
      options: {
        getSubcommand: () => 'set-channel',
        getChannel: () => channel
      },
      reply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn().mockResolvedValue(undefined)
    };

    const result = await spectrumConfig.handleSpectrumCommand(interaction);

    expect(result.action).toBe('set-channel');
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Spectrum announcements will post'),
      flags: MessageFlags.Ephemeral
    });
  });

  test('handleSpectrumCommand set-channel rejects channels from other guilds', async () => {
    const channel = {
      id: 'chan-2',
      guildId: 'guild-other',
      type: ChannelType.GuildText,
      toString: () => '<#chan-2>'
    };

    const interaction = {
      guildId: 'guild-1',
      guild: {},
      user: { id: 'user-1' },
      replied: false,
      deferred: false,
      options: {
        getSubcommand: () => 'set-channel',
        getChannel: () => channel
      },
      reply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn().mockResolvedValue(undefined)
    };

    const result = await spectrumConfig.handleSpectrumCommand(interaction);
    expect(result.action).toBe('noop');
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Please choose a channel from this server.',
      flags: MessageFlags.Ephemeral
    });
  });

  test('handleSpectrumCommand set-channel rejects unsupported channel types', async () => {
    const channel = {
      id: 'chan-3',
      guildId: 'guild-1',
      type: ChannelType.GuildVoice,
      toString: () => '<#chan-3>'
    };

    const interaction = {
      guildId: 'guild-1',
      guild: {},
      user: { id: 'user-1' },
      replied: false,
      deferred: false,
      options: {
        getSubcommand: () => 'set-channel',
        getChannel: () => channel
      },
      reply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn().mockResolvedValue(undefined)
    };

    const result = await spectrumConfig.handleSpectrumCommand(interaction);
    expect(result.action).toBe('noop');
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Spectrum Watcher can only post to text or announcement channels.',
      flags: MessageFlags.Ephemeral
    });
  });

  test('handleSpectrumCommand set-channel enforces guild context', async () => {
    const channel = {
      id: 'chan-4',
      guildId: 'guild-4',
      type: ChannelType.GuildText,
      toString: () => '<#chan-4>'
    };

    const interaction = {
      guildId: null,
      guild: null,
      user: { id: 'user-1' },
      replied: false,
      deferred: false,
      options: {
        getSubcommand: () => 'set-channel',
        getChannel: () => channel
      },
      reply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn().mockResolvedValue(undefined)
    };

    const result = await spectrumConfig.handleSpectrumCommand(interaction);
    expect(result.action).toBe('noop');
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'This command can only be used inside a guild.',
      flags: MessageFlags.Ephemeral
    });
  });

  test('replyEphemeral routes to followUp when already replied', async () => {
    const channel = {
      id: 'chan-follow',
      guildId: 'guild-follow',
      type: ChannelType.GuildText,
      toString: () => '<#chan-follow>'
    };

    const interaction = {
      guildId: 'guild-follow',
      guild: {},
      user: { id: 'user-follow' },
      replied: true,
      deferred: false,
      options: {
        getSubcommand: () => 'set-channel',
        getChannel: () => channel
      },
      reply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn().mockResolvedValue(undefined)
    };

    await spectrumConfig.handleSpectrumCommand(interaction);

    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: expect.stringContaining('Spectrum announcements will post'),
      flags: MessageFlags.Ephemeral
    });
  });

  test('handleSpectrumCommand set-forum trims and stores forum id', async () => {
    const interaction = {
      guildId: 'guild-4',
      user: { id: 'user-2' },
      replied: false,
      deferred: false,
      options: {
        getSubcommand: () => 'set-forum',
        getString: () => ' 42 '
      },
      reply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn().mockResolvedValue(undefined)
    };

    const result = await spectrumConfig.handleSpectrumCommand(interaction);
    expect(result.action).toBe('set-forum');
    expect(result.config.forumId).toBe('42');
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Spectrum Watcher will monitor forum **42**.',
      flags: MessageFlags.Ephemeral
    });
  });

  test('handleSpectrumCommand set-forum validates guild and input constraints', async () => {
    const guildless = {
      guildId: null,
      user: { id: 'user-x' },
      replied: false,
      deferred: false,
      options: {
        getSubcommand: () => 'set-forum',
        getString: () => '  '
      },
      reply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn().mockResolvedValue(undefined)
    };

    const resultGuild = await spectrumConfig.handleSpectrumCommand(guildless);
    expect(resultGuild.action).toBe('noop');
    expect(guildless.reply).toHaveBeenCalledWith({
      content: 'This command can only be used inside a guild.',
      flags: MessageFlags.Ephemeral
    });

    const blank = {
      ...guildless,
      guildId: 'guild-x'
    };
    blank.reply = jest.fn().mockResolvedValue(undefined);
    blank.followUp = jest.fn().mockResolvedValue(undefined);

    const resultBlank = await spectrumConfig.handleSpectrumCommand(blank);
    expect(resultBlank.action).toBe('noop');
    expect(blank.reply).toHaveBeenCalledWith({
      content: 'Please provide a valid forum ID.',
      flags: MessageFlags.Ephemeral
    });

    const tooLong = {
      ...blank,
      options: {
        getSubcommand: () => 'set-forum',
        getString: () => 'x'.repeat(40)
      },
      reply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn().mockResolvedValue(undefined)
    };

    const resultTooLong = await spectrumConfig.handleSpectrumCommand(tooLong);
    expect(resultTooLong.action).toBe('noop');
    expect(tooLong.reply).toHaveBeenCalledWith({
      content: 'Forum IDs must be 32 characters or fewer.',
      flags: MessageFlags.Ephemeral
    });
  });

  test('handleSpectrumCommand set-forum rejects blank or oversized values', async () => {
    const blankInteraction = {
      guildId: 'guild-blank',
      user: { id: 'user' },
      replied: false,
      deferred: false,
      options: {
        getSubcommand: () => 'set-forum',
        getString: () => '  '
      },
      reply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn().mockResolvedValue(undefined)
    };

    const blankResult = await spectrumConfig.handleSpectrumCommand(blankInteraction);
    expect(blankResult.action).toBe('noop');
    expect(blankInteraction.reply).toHaveBeenCalledWith({
      content: 'Please provide a valid forum ID.',
      flags: MessageFlags.Ephemeral
    });

    const longInteraction = {
      ...blankInteraction,
      options: {
        getSubcommand: () => 'set-forum',
        getString: () => 'x'.repeat(40)
      },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    const longResult = await spectrumConfig.handleSpectrumCommand(longInteraction);
    expect(longResult.action).toBe('noop');
    expect(longInteraction.reply).toHaveBeenCalledWith({
      content: 'Forum IDs must be 32 characters or fewer.',
      flags: MessageFlags.Ephemeral
    });
  });

  test('handleSpectrumCommand clear removes configuration when set', async () => {
    spectrumConfig.__testables.configCache.set('guild-6', {
      guildId: 'guild-6',
      announceChannelId: 'chan-6',
      forumId: 'forum-6',
      updatedBy: null,
      updatedAt: new Date()
    });

    const interaction = {
      guildId: 'guild-6',
      replied: false,
      deferred: false,
      options: {
        getSubcommand: () => 'clear'
      },
      reply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn().mockResolvedValue(undefined)
    };

    const result = await spectrumConfig.handleSpectrumCommand(interaction);

    expect(result.action).toBe('clear');
    expect(database.__pool.query).toHaveBeenCalledWith('DELETE FROM spectrum_config WHERE guild_id = ?', ['guild-6']);
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Spectrum Watcher configuration has been cleared.',
      flags: MessageFlags.Ephemeral
    });
  });

  test('handleSpectrumCommand clear handles already cleared guilds', async () => {
    const interaction = {
      guildId: 'guild-cleared',
      replied: false,
      deferred: false,
      options: {
        getSubcommand: () => 'clear'
      },
      reply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn().mockResolvedValue(undefined)
    };

    const result = await spectrumConfig.handleSpectrumCommand(interaction);
    expect(result.action).toBe('clear');
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Spectrum Watcher is already cleared for this server.',
      flags: MessageFlags.Ephemeral
    });
  });

  test('handleSpectrumCommand default branch returns noop', async () => {
    const interaction = {
      guildId: 'guild-default',
      replied: false,
      deferred: false,
      options: {
        getSubcommand: () => 'unknown'
      },
      reply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn().mockResolvedValue(undefined)
    };

    const result = await spectrumConfig.handleSpectrumCommand(interaction);
    expect(result).toEqual({ action: 'noop' });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Unsupported subcommand.',
      flags: MessageFlags.Ephemeral
    });
  });

  test('handleSpectrumCommand post-latest defers reply and posts update', async () => {
    spectrumConfig.__testables.configCache.set('guild-7', {
      guildId: 'guild-7',
      announceChannelId: 'chan-7',
      forumId: 'forum-7',
      updatedBy: null,
      updatedAt: new Date()
    });

    watcher.postLatestThreadForGuild.mockResolvedValue({
      ok: true,
      thread: { subject: 'Latest' },
      threadUrl: 'https://example.com/latest'
    });

    const interaction = {
      guildId: 'guild-7',
      client: {},
      replied: false,
      deferred: false,
      options: {
        getSubcommand: () => 'post-latest'
      },
      deferReply: jest.fn().mockImplementation(() => {
        interaction.deferred = true;
        return Promise.resolve();
      }),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn(),
      followUp: jest.fn()
    };

    const result = await spectrumConfig.handleSpectrumCommand(interaction);

    expect(result).toMatchObject({ action: 'post-latest', ok: true });
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(watcher.postLatestThreadForGuild).toHaveBeenCalledWith(interaction.client, 'guild-7');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Posted **Latest** to <#chan-7>.'));
  });

  test('handleSpectrumCommand post-latest reports missing configuration', async () => {
    const interaction = {
      guildId: 'guild-missing',
      client: {},
      replied: false,
      deferred: false,
      options: {
        getSubcommand: () => 'post-latest'
      },
      reply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn().mockResolvedValue(undefined)
    };

    const result = await spectrumConfig.handleSpectrumCommand(interaction);
    expect(result).toMatchObject({ action: 'post-latest', ok: false });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Spectrum Watcher is not configured for this server.',
      flags: MessageFlags.Ephemeral
    });
  });

  test('handleSpectrumCommand post-latest requires forum and channel configuration', async () => {
    spectrumConfig.__testables.configCache.set('guild-8', {
      guildId: 'guild-8',
      announceChannelId: null,
      forumId: null,
      updatedBy: null,
      updatedAt: new Date()
    });

    const interaction = {
      guildId: 'guild-8',
      client: {},
      replied: false,
      deferred: false,
      options: {
        getSubcommand: () => 'post-latest'
      },
      reply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn().mockResolvedValue(undefined)
    };

    const resultNoForum = await spectrumConfig.handleSpectrumCommand(interaction);
    expect(resultNoForum).toMatchObject({ action: 'post-latest', ok: false });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Set a forum ID before posting the latest thread.',
      flags: MessageFlags.Ephemeral
    });

    spectrumConfig.__testables.configCache.set('guild-8', {
      guildId: 'guild-8',
      announceChannelId: null,
      forumId: 'forum-8',
      updatedBy: null,
      updatedAt: new Date()
    });

    const interactionChannel = {
      ...interaction,
      reply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn().mockResolvedValue(undefined)
    };

    const resultNoChannel = await spectrumConfig.handleSpectrumCommand(interactionChannel);
    expect(resultNoChannel).toMatchObject({ action: 'post-latest', ok: false });
    expect(interactionChannel.reply).toHaveBeenCalledWith({
      content: 'Set an announcement channel before posting the latest thread.',
      flags: MessageFlags.Ephemeral
    });
  });

  test('handleSpectrumCommand post-latest surfaces watcher errors and rejections', async () => {
    spectrumConfig.__testables.configCache.set('guild-9', {
      guildId: 'guild-9',
      announceChannelId: 'chan-9',
      forumId: 'forum-9',
      updatedBy: null,
      updatedAt: new Date()
    });

    const interaction = {
      guildId: 'guild-9',
      client: {},
      replied: false,
      deferred: false,
      options: {
        getSubcommand: () => 'post-latest'
      },
      deferReply: jest.fn().mockImplementation(() => {
        interaction.deferred = true;
        return Promise.resolve();
      }),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn(),
      followUp: jest.fn()
    };

    watcher.postLatestThreadForGuild.mockResolvedValueOnce({ ok: false, message: 'custom failure' });

    const resultFailure = await spectrumConfig.handleSpectrumCommand(interaction);
    expect(resultFailure).toMatchObject({ action: 'post-latest', ok: false });
    expect(interaction.editReply).toHaveBeenCalledWith('custom failure');

    watcher.postLatestThreadForGuild.mockRejectedValueOnce(new Error('boom'));
    interaction.editReply.mockClear();
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const resultError = await spectrumConfig.handleSpectrumCommand(interaction);
    expect(resultError.ok).toBe(false);
    expect(interaction.editReply).toHaveBeenCalledWith('Something went wrong while trying to post the latest thread. (boom)');
    expect(consoleSpy).toHaveBeenCalledWith('spectrumConfig: failed to post latest thread', expect.any(Error));

    consoleSpy.mockRestore();
  });

  test('handleSpectrumCommand post-latest reports when watcher bridge lacks export', async () => {
    spectrumConfig.__testables.configCache.set('guild-10', {
      guildId: 'guild-10',
      announceChannelId: 'chan-10',
      forumId: 'forum-10',
      updatedBy: null,
      updatedAt: new Date()
    });

    const interaction = {
      guildId: 'guild-10',
      client: {},
      replied: false,
      deferred: false,
      options: {
        getSubcommand: () => 'post-latest'
      },
      deferReply: jest.fn().mockImplementation(() => {
        interaction.deferred = true;
        return Promise.resolve();
      }),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn(),
      followUp: jest.fn()
    };

    const originalFn = watcher.postLatestThreadForGuild;
    delete watcher.postLatestThreadForGuild;

    const result = await spectrumConfig.handleSpectrumCommand(interaction);
    expect(result.ok).toBe(false);
    expect(interaction.editReply).toHaveBeenCalledWith('Something went wrong while trying to post the latest thread. (Spectrum watcher is not ready to post threads yet.)');

    watcher.postLatestThreadForGuild = originalFn;
  });

  test('initialize only performs schema work once', async () => {
    database.__pool.query.mockResolvedValue([[]]);

    await spectrumConfig.initialize({});
    const firstCallCount = database.__pool.query.mock.calls.length;

    await spectrumConfig.initialize({});

    expect(database.__pool.query.mock.calls.length).toBe(firstCallCount);
  });

  test('handleInteraction ignores non-spectrum commands', async () => {
    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'other'
    };

    await expect(spectrumConfig.handleInteraction(interaction)).resolves.toBe(false);
  });

  test('handleInteraction reports failures via ephemeral reply', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'spectrum',
      options: {
        getSubcommand: () => 'set-channel',
        getChannel: () => {
          throw new Error('option failure');
        }
      },
      guildId: 'guild-error',
      guild: {},
      user: { id: 'user-error' },
      replied: false,
      deferred: false,
      reply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn().mockResolvedValue(undefined)
    };

    await expect(spectrumConfig.handleInteraction(interaction)).resolves.toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith('spectrumConfig: failed to handle /spectrum command', expect.any(Error));
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Something went wrong while handling this command. Please try again later.',
      flags: MessageFlags.Ephemeral
    });

    consoleSpy.mockRestore();
  });
});
  test('fetchConfig falls back to database lookup', async () => {
    database.__pool.query.mockResolvedValueOnce([[{
      guild_id: 'guild-db',
      announce_channel_id: 'chan-db',
      forum_id: 'forum-db',
      updated_by: 'user-db',
      updated_at: new Date('2025-01-01T00:00:00Z')
    }]]);

    const result = await spectrumConfig.fetchConfig('guild-db');
    expect(result).toMatchObject({
      guildId: 'guild-db',
      announceChannelId: 'chan-db',
      forumId: 'forum-db',
      updatedBy: 'user-db'
    });
  });

  test('getConfigsSnapshot returns defensive copies', () => {
    spectrumConfig.__testables.configCache.clear();
    spectrumConfig.__testables.configCache.set('guild-snap', {
      guildId: 'guild-snap',
      announceChannelId: 'chan-snap',
      forumId: 'forum-snap',
      updatedBy: null,
      updatedAt: new Date()
    });

    const snapshot = spectrumConfig.getConfigsSnapshot();
    expect(snapshot[0]).toEqual({
      guildId: 'guild-snap',
      announceChannelId: 'chan-snap',
      forumId: 'forum-snap',
      updatedBy: null,
      updatedAt: expect.any(Date)
    });
    snapshot[0].guildId = 'mutated';
    expect(spectrumConfig.__testables.configCache.get('guild-snap').guildId).toBe('guild-snap');
  });

  test('onReady triggers initialization when not yet prepared', async () => {
    database.__pool.query.mockResolvedValue([[]]);

    await spectrumConfig.onReady({});

    expect(database.__pool.query).toHaveBeenCalled();
    const callCount = database.__pool.query.mock.calls.length;

    await spectrumConfig.onReady({});
    expect(database.__pool.query.mock.calls.length).toBe(callCount);
  });
