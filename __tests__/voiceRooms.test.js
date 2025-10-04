const { ChannelType, MessageFlags, PermissionFlagsBits } = require('discord.js');

jest.mock('../database', () => {
  const pool = { query: jest.fn().mockResolvedValue([]) };
  return {
    getPool: jest.fn(() => pool),
    __pool: pool
  };
});

const database = require('../database');
const voiceRooms = require('../voiceRooms');
const { getSlashCommandDefinitions, __testables } = voiceRooms;
const {
  handleInteraction,
  addTemplateToCache,
  removeTemplateFromCache,
  addTemporaryChannelToCache,
  removeTemporaryChannelFromCache,
  isTemplateChannel,
  templateCache,
  tempChannelCache
} = __testables;

function makeBaseInteraction(overrides = {}) {
  const defaults = {
    isChatInputCommand: () => true,
    commandName: 'voice-rooms',
    inGuild: () => true,
    guildId: 'guild-1',
    memberPermissions: { has: () => true },
    options: {
      getSubcommand: () => 'list',
      getChannel: () => ({})
    },
    guild: {
      channels: {
        cache: new Map()
      }
    },
    deferred: false,
    replied: false,
    reply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined)
  };

  return { ...defaults, ...overrides };
}

beforeEach(() => {
  templateCache.clear();
  tempChannelCache.clear();
  database.__pool.query.mockReset();
  database.__pool.query.mockResolvedValue([]);
});

describe('voiceRooms command definition', () => {
  test('exports a guild-scoped admin-only slash command', () => {
    const definition = getSlashCommandDefinitions();
    expect(definition.global).toHaveLength(0);
    expect(definition.guild).toHaveLength(1);

    const command = definition.guild[0];
    expect(command.name).toBe('voice-rooms');
    expect(command.dm_permission).toBe(false);
    expect(command.default_member_permissions).toBe(PermissionFlagsBits.Administrator.toString());

    const optionNames = command.options.map(option => option.name);
    expect(optionNames).toEqual(expect.arrayContaining(['set-template', 'clear-template', 'list']));
  });
});

describe('voiceRooms.handleInteraction', () => {
  test('rejects usage outside of guilds', async () => {
    const interaction = makeBaseInteraction({ inGuild: () => false });

    await handleInteraction(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'This command can only be used in a server.',
      flags: MessageFlags.Ephemeral
    });
  });

  test('rejects non-admin members', async () => {
    const interaction = makeBaseInteraction({
      memberPermissions: { has: () => false }
    });

    await handleInteraction(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Only administrators can use this command.',
      flags: MessageFlags.Ephemeral
    });
  });

  test('requires voice channel for set-template', async () => {
    const wrongChannel = { id: 'text-1', type: ChannelType.GuildText };
    const interaction = makeBaseInteraction({
      options: {
        getSubcommand: () => 'set-template',
        getChannel: () => wrongChannel
      }
    });

    await handleInteraction(interaction);

    expect(database.__pool.query).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Please choose a voice channel.',
      flags: MessageFlags.Ephemeral
    });
  });

  test('lists configured lobbies when none are set', async () => {
    const interaction = makeBaseInteraction();

    await handleInteraction(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'No dynamic voice lobbies are configured yet.',
      flags: MessageFlags.Ephemeral
    });
  });

  test('lists configured lobbies when templates exist', async () => {
    addTemplateToCache('guild-1', 'voice-123');
    const channel = { id: 'voice-123', type: ChannelType.GuildVoice, toString: () => '<#voice-123>' };
    const interaction = makeBaseInteraction({
      guild: {
        channels: {
          cache: new Map([[ 'voice-123', channel ]])
        }
      }
    });

    await handleInteraction(interaction);

    const expectedMessage = ['Configured lobbies:', '- <#voice-123>'].join('\n');
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expectedMessage,
      flags: MessageFlags.Ephemeral
    });
  });

  test('lists channel IDs when cache misses the channel object', async () => {
    addTemplateToCache('guild-1', 'voice-123');
    const interaction = makeBaseInteraction();

    await handleInteraction(interaction);

    const expectedMessage = ['Configured lobbies:', '- Channel ID voice-123'].join('\n');
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expectedMessage,
      flags: MessageFlags.Ephemeral
    });
  });

  test('creates a lobby template on set-template', async () => {
    const channel = { id: 'voice-123', type: ChannelType.GuildVoice, toString: () => '<#voice-123>' };
    const interaction = makeBaseInteraction({
      options: {
        getSubcommand: () => 'set-template',
        getChannel: () => channel
      }
    });

    await handleInteraction(interaction);

    expect(database.__pool.query).toHaveBeenCalledWith(
      'INSERT INTO voice_channel_templates (guild_id, template_channel_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE created_at = created_at',
      ['guild-1', 'voice-123']
    );

    expect(templateCache.has('guild-1')).toBe(true);
    expect(isTemplateChannel('guild-1', 'voice-123')).toBe(true);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Added <#voice-123> as a dynamic voice lobby.',
      flags: MessageFlags.Ephemeral
    });
  });

  test('removes a lobby template on clear-template', async () => {
    addTemplateToCache('guild-1', 'voice-123');
    const channel = { id: 'voice-123', type: ChannelType.GuildVoice, toString: () => '<#voice-123>' };
    const interaction = makeBaseInteraction({
      options: {
        getSubcommand: () => 'clear-template',
        getChannel: () => channel
      }
    });

    await handleInteraction(interaction);

    expect(database.__pool.query).toHaveBeenCalledWith(
      'DELETE FROM voice_channel_templates WHERE guild_id = ? AND template_channel_id = ?',
      ['guild-1', 'voice-123']
    );

    expect(templateCache.has('guild-1')).toBe(false);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Removed <#voice-123> from the dynamic voice lobby list.',
      flags: MessageFlags.Ephemeral
    });
  });

  test('surfaces database errors via reply', async () => {
    database.__pool.query.mockRejectedValueOnce(new Error('boom'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const interaction = makeBaseInteraction({
      options: {
        getSubcommand: () => 'set-template',
        getChannel: () => ({ id: 'voice-123', type: ChannelType.GuildVoice })
      }
    });

    await handleInteraction(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Something went wrong while processing that command.',
      flags: MessageFlags.Ephemeral
    });
    expect(interaction.followUp).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('uses followUp when interaction already deferred', async () => {
    database.__pool.query.mockRejectedValueOnce(new Error('boom'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const interaction = makeBaseInteraction({
      deferred: true,
      options: {
        getSubcommand: () => 'set-template',
        getChannel: () => ({ id: 'voice-123', type: ChannelType.GuildVoice })
      }
    });

    await handleInteraction(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith({
      content: 'Something went wrong while processing that command.',
      flags: MessageFlags.Ephemeral
    });
    consoleSpy.mockRestore();
  });
});

describe('cache helpers', () => {
  test('template cache add/remove/isTemplateChannel', () => {
    expect(isTemplateChannel('guild-1', 'voice-123')).toBe(false);

    addTemplateToCache('guild-1', 'voice-123');
    expect(isTemplateChannel('guild-1', 'voice-123')).toBe(true);

    removeTemplateFromCache('guild-1', 'voice-123');
    expect(isTemplateChannel('guild-1', 'voice-123')).toBe(false);
  });

  test('temporary channel cache add/remove', () => {
    addTemporaryChannelToCache({
      channel_id: 'temp-1',
      guild_id: 'guild-1',
      owner_id: 'owner',
      template_channel_id: 'voice-123'
    });

    expect(tempChannelCache.has('temp-1')).toBe(true);

    removeTemporaryChannelFromCache('temp-1');
    expect(tempChannelCache.has('temp-1')).toBe(false);
  });
});
