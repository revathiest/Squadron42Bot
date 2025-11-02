
jest.mock('../database', () => {
  const pool = {
    query: jest.fn().mockResolvedValue([])
  };
  return {
    getPool: () => pool,
    __pool: pool
  };
});

const database = require('../database');
const voiceRooms = require('../voiceRooms');
const {
  handleInteraction,
  addTemplateToCache,
  removeTemplateFromCache,
  addTemporaryChannelToCache,
  removeTemporaryChannelFromCache,
  isTemplateChannel,
  templateCache,
  tempChannelCache
} = voiceRooms.__testables;

const { ChannelType, MessageFlags } = require('discord.js');

describe('voiceRooms handleInteraction', () => {
  beforeEach(() => {
    templateCache.clear();
    tempChannelCache.clear();
    database.__pool.query.mockClear();
  });

  test('ignores non-chat input commands', async () => {
    const interaction = {
      isChatInputCommand: () => false
    };

    await expect(handleInteraction(interaction)).resolves.toBe(false);
  });

  test('ignores other commands', async () => {
    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'other'
    };

    await expect(handleInteraction(interaction)).resolves.toBe(false);
  });

  test('rejects usage outside guilds', async () => {
    const reply = jest.fn().mockResolvedValue(undefined);
    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'voice-rooms',
      inGuild: () => false,
      reply
    };

    await expect(handleInteraction(interaction)).resolves.toBe(true);

    expect(reply).toHaveBeenCalledWith({
      content: 'This command can only be used in a server.',
      flags: MessageFlags.Ephemeral
    });
  });

  test('rejects users without administrator permissions', async () => {
    const reply = jest.fn().mockResolvedValue(undefined);
    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'voice-rooms',
      inGuild: () => true,
      memberPermissions: { has: () => false },
      options: {
        getSubcommand: () => 'list'
      },
      reply
    };

    await expect(handleInteraction(interaction)).resolves.toBe(true);

    expect(reply).toHaveBeenCalledWith({
      content: 'Only administrators can use this command.',
      flags: MessageFlags.Ephemeral
    });
  });

  test('rejects set-template when channel is not voice', async () => {
    const reply = jest.fn().mockResolvedValue(undefined);
    const channel = { id: 'text-1', type: ChannelType.GuildText, toString: () => '#general' };
    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'voice-rooms',
      inGuild: () => true,
      memberPermissions: { has: () => true },
      guildId: 'guild-1',
      options: {
        getSubcommand: () => 'set-template',
        getChannel: jest.fn((name) => (name === 'channel' ? channel : null))
      },
      reply
    };

    await expect(handleInteraction(interaction)).resolves.toBe(true);

    expect(reply).toHaveBeenCalledWith({
      content: 'Please choose a voice channel.',
      flags: MessageFlags.Ephemeral
    });
    expect(database.__pool.query).not.toHaveBeenCalled();
  });

  test('stores template channels and replies success', async () => {
    const reply = jest.fn().mockResolvedValue(undefined);
    const channel = {
      id: 'voice-1',
      type: ChannelType.GuildVoice,
      toString: () => '<#voice-1>'
    };

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'voice-rooms',
      inGuild: () => true,
      memberPermissions: { has: () => true },
      guildId: 'guild-2',
      options: {
        getSubcommand: () => 'set-template',
        getChannel: jest.fn((name) => (name === 'channel' ? channel : null))
      },
      reply
    };

    await expect(handleInteraction(interaction)).resolves.toBe(true);

    expect(database.__pool.query).toHaveBeenCalledWith(
      'INSERT INTO voice_channel_templates (guild_id, template_channel_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE created_at = created_at',
      ['guild-2', 'voice-1']
    );
    expect(templateCache.get('guild-2').has('voice-1')).toBe(true);
    expect(reply).toHaveBeenCalledWith({
      content: 'Added <#voice-1> as a dynamic voice lobby.',
      flags: MessageFlags.Ephemeral
    });
  });

  test('removes template channels via clear-template', async () => {
    const reply = jest.fn().mockResolvedValue(undefined);
    const channel = {
      id: 'voice-2',
      type: ChannelType.GuildVoice,
      toString: () => '<#voice-2>'
    };

    templateCache.set('guild-3', new Set(['voice-2']));

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'voice-rooms',
      inGuild: () => true,
      memberPermissions: { has: () => true },
      guildId: 'guild-3',
      options: {
        getSubcommand: () => 'clear-template',
        getChannel: jest.fn((name) => (name === 'channel' ? channel : null))
      },
      reply
    };

    await expect(handleInteraction(interaction)).resolves.toBe(true);

    expect(database.__pool.query).toHaveBeenCalledWith(
      'DELETE FROM voice_channel_templates WHERE guild_id = ? AND template_channel_id = ?',
      ['guild-3', 'voice-2']
    );
    expect(templateCache.get('guild-3')).toBeUndefined();
    expect(reply).toHaveBeenCalledWith({
      content: 'Removed <#voice-2> from the dynamic voice lobby list.',
      flags: MessageFlags.Ephemeral
    });
  });

  test('reports failure via reply when not deferred', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const reply = jest.fn().mockResolvedValue(undefined);
    const channel = {
      id: 'voice-8',
      type: ChannelType.GuildVoice,
      toString: () => '<#voice-8>'
    };

    database.__pool.query.mockRejectedValueOnce(new Error('db down'));

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'voice-rooms',
      inGuild: () => true,
      memberPermissions: { has: () => true },
      guildId: 'guild-8',
      options: {
        getSubcommand: () => 'set-template',
        getChannel: jest.fn((name) => (name === 'channel' ? channel : null))
      },
      reply,
      followUp: jest.fn(),
      deferred: false,
      replied: false
    };

    await handleInteraction(interaction);

    expect(reply).toHaveBeenCalledWith({
      content: 'Something went wrong while processing that command.',
      flags: MessageFlags.Ephemeral
    });
    expect(interaction.followUp).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  test('uses followUp when interaction already deferred', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const followUp = jest.fn().mockResolvedValue(undefined);
    const channel = {
      id: 'voice-9',
      type: ChannelType.GuildVoice,
      toString: () => '<#voice-9>'
    };

    database.__pool.query.mockRejectedValueOnce(new Error('db down'));
    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'voice-rooms',
      inGuild: () => true,
      memberPermissions: { has: () => true },
      guildId: 'guild-9',
      options: {
        getSubcommand: () => 'set-template',
        getChannel: jest.fn((name) => (name === 'channel' ? channel : null))
      },
      reply: jest.fn(),
      followUp,
      deferred: true,
      replied: false
    };

    await handleInteraction(interaction);

    expect(followUp).toHaveBeenCalledWith({
      content: 'Something went wrong while processing that command.',
      flags: MessageFlags.Ephemeral
    });

    errorSpy.mockRestore();
  });
});

describe('voiceRooms cache helpers', () => {
  beforeEach(() => {
    templateCache.clear();
    tempChannelCache.clear();
  });

  test('template cache add/remove works', () => {
    addTemplateToCache('guild-10', 'channel-10');
    expect(templateCache.get('guild-10').has('channel-10')).toBe(true);

    removeTemplateFromCache('guild-10', 'channel-10');
    expect(templateCache.has('guild-10')).toBe(false);
  });

  test('temporary channel cache add/remove works', () => {
    const record = { channel_id: 'temp-1', guild_id: 'guild', owner_id: 'user', template_channel_id: 'template' };
    addTemporaryChannelToCache(record);
    expect(tempChannelCache.get('temp-1')).toBe(record);

    removeTemporaryChannelFromCache('temp-1');
    expect(tempChannelCache.has('temp-1')).toBe(false);
  });

  test('isTemplateChannel reflects cache contents', () => {
    expect(isTemplateChannel('guild-x', 'channel-x')).toBe(false);
    addTemplateToCache('guild-x', 'channel-x');
    expect(isTemplateChannel('guild-x', 'channel-x')).toBe(true);
  });
});












describe('voiceRooms command definition', () => {
  test('getSlashCommandDefinitions exposes guild command', () => {
    const defs = voiceRooms.getSlashCommandDefinitions();
    expect(defs.global).toEqual([]);
    expect(defs.guild).toHaveLength(1);
    expect(defs.guild[0].name).toBe('voice-rooms');
  });
});

describe('voiceRooms misc interaction handling', () => {
  test('returns false for non voice-room button customIds', async () => {
    const interaction = {
      isChatInputCommand: () => false,
      isButton: () => true,
      customId: 'control:123',
      isModalSubmit: () => false
    };

    await expect(handleInteraction(interaction)).resolves.toBe(false);
  });

  test('module handleInteraction delegates to handler implementation', async () => {
    const interaction = {
      isChatInputCommand: () => false
    };

    await expect(voiceRooms.handleInteraction(interaction)).resolves.toBe(false);
  });
});

