const { PermissionFlagsBits, ChannelType, MessageFlags, Events } = require('discord.js');

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
const tickets = require('../tickets');

const {
  buildTicketChannelName,
  getModeratorRoles,
  isModerator,
  handleTicketCommand,
  handleSetChannel,
  handleSetArchive,
  handleCreateButton,
  handleButton,
  handleModalSubmit,
  handleInteraction,
  buildLobbyEmbed,
  buildTicketControls,
  buildLobbyComponents,
  settingsCache,
  rolesCache,
  openTickets
} = tickets.__testables;

const originalWarn = console.warn;
const originalError = console.error;
beforeAll(() => {
  console.warn = jest.fn();
  console.error = jest.fn();
});

afterAll(() => {
  console.warn = originalWarn;
  console.error = originalError;
});
describe('tickets module helpers', () => {
  beforeEach(() => {
    rolesCache.clear();
    settingsCache.clear();
    database.__pool.query.mockClear();
  });

  test('slash command definition includes ticket command', () => {
    const defs = tickets.getSlashCommandDefinitions();
    expect(defs).toHaveProperty('guild');
    const ticketCommand = defs.guild.find(cmd => cmd.name === 'ticket');
    expect(ticketCommand).toBeDefined();
    expect(ticketCommand.options).toEqual(expect.any(Array));
  });

  test('channel name sanitizes user names', () => {
    expect(buildTicketChannelName('User Example', 42)).toBe('ticket-user-example-42');
    expect(buildTicketChannelName('***', 5)).toBe('ticket-user-5');
  });

  test('getModeratorRoles falls back to empty set', () => {
    expect(getModeratorRoles('missing-guild').size).toBe(0);
  });

  test('isModerator uses configured roles', () => {
    rolesCache.set('guild-1', new Set(['role-a']));
    const guild = { id: 'guild-1' };
    const member = {
      roles: { cache: { some: fn => fn({ id: 'role-a' }) } },
      permissions: { has: () => false }
    };

    expect(isModerator(guild, member)).toBe(true);
  });

  test('isModerator falls back to ManageChannels when no roles configured', () => {
    const guild = { id: 'guild-2' };
    const member = {
      permissions: { has: perm => perm === PermissionFlagsBits.ManageChannels }
    };

    expect(isModerator(guild, member)).toBe(true);
  });
});


describe('ticket set-channel command', () => {
  beforeEach(() => {
    settingsCache.clear();
    database.__pool.query.mockClear().mockResolvedValue([]);
  });

  test('set channel rejects non-text channels', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const channel = { id: 'voice-channel', type: ChannelType.GuildVoice, toString: () => '<#voice-channel>' };
    const interaction = {
      id: 'interaction-set-voice',
      guildId: 'guild-set',
      options: {
        getSubcommandGroup: () => null,
        getSubcommand: () => 'set-channel',
        getChannel: jest.fn(name => (name === 'channel' ? channel : null))
      },
      reply: jest.fn().mockResolvedValue(undefined),
      guild: { channels: { fetch: jest.fn() } }
    };

    await handleTicketCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Please choose a text channel for ticket creation.',
      flags: MessageFlags.Ephemeral
    });
    expect(database.__pool.query).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  test('set channel configures lobby and updates cache', async () => {
    const channel = {
      id: 'text-channel',
      type: ChannelType.GuildText,
      toString: () => '#support',
      send: jest.fn().mockResolvedValue({ id: 'message-1' })
    };

    const interaction = {
      id: 'interaction-set-text',
      guildId: 'guild-config',
      guild: {
        name: 'Support Guild',
        channels: { fetch: jest.fn() }
      },
      options: {
        getSubcommandGroup: () => null,
        getSubcommand: () => 'set-channel',
        getChannel: jest.fn(name => (name === 'channel' ? channel : null))
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn()
    };

    await handleTicketCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(channel.send).toHaveBeenCalled();
    expect(database.__pool.query).toHaveBeenCalledWith(
      'REPLACE INTO ticket_settings (guild_id, channel_id, message_id, archive_category_id) VALUES (?, ?, ?, ?)',
      ['guild-config', 'text-channel', 'message-1', null]
    );

    const settings = settingsCache.get('guild-config');
    expect(settings).toEqual({
      channelId: 'text-channel',
      messageId: 'message-1',
      archiveCategoryId: null
    });
    expect(interaction.editReply).toHaveBeenCalledWith('Ticket lobby channel configured successfully.');
  });

  test('set channel cleans up previous lobby message', async () => {
    const previousDelete = jest.fn().mockResolvedValue(undefined);
    const previousMessage = { delete: previousDelete };
    const previousChannel = {
      messages: {
        fetch: jest.fn().mockResolvedValue(previousMessage)
      }
    };

    settingsCache.set('guild-clean', {
      channelId: 'old-channel',
      messageId: 'old-message',
      archiveCategoryId: null
    });

    const channel = {
      id: 'new-channel',
      type: ChannelType.GuildText,
      toString: () => '#new-channel',
      send: jest.fn().mockResolvedValue({ id: 'new-message' })
    };
    const archiveCategory = { id: 'archive-123' };

    const interaction = {
      id: 'interaction-clean',
      guildId: 'guild-clean',
      guild: {
        name: 'Clean Guild',
        channels: {
          fetch: jest.fn(channelId => {
            if (channelId === 'old-channel') {
              return Promise.resolve(previousChannel);
            }
            return Promise.resolve(null);
          })
        }
      },
      options: {
        getSubcommandGroup: () => null,
        getSubcommand: () => 'set-channel',
        getChannel: jest.fn(name => {
          if (name === 'channel') return channel;
          if (name === 'archive_category') return archiveCategory;
          return null;
        })
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn()
    };

    await handleTicketCommand(interaction);

    expect(previousChannel.messages.fetch).toHaveBeenCalledWith('old-message');
    expect(previousDelete).toHaveBeenCalled();
    expect(database.__pool.query).toHaveBeenCalledWith(
      'REPLACE INTO ticket_settings (guild_id, channel_id, message_id, archive_category_id) VALUES (?, ?, ?, ?)',
      ['guild-clean', 'new-channel', 'new-message', 'archive-123']
    );

    const settings = settingsCache.get('guild-clean');
    expect(settings).toEqual({
      channelId: 'new-channel',
      messageId: 'new-message',
      archiveCategoryId: 'archive-123'
    });
  });

  test('set channel logs cleanup failures but continues', async () => {
    settingsCache.set('guild-warn', {
      channelId: 'stale-channel',
      messageId: 'stale-message',
      archiveCategoryId: null
    });

    const channel = {
      id: 'fresh-channel',
      type: ChannelType.GuildText,
      toString: () => '#fresh',
      send: jest.fn().mockResolvedValue({ id: 'fresh-message' })
    };

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const interaction = {
      id: 'interaction-warn',
      guildId: 'guild-warn',
      guild: {
        name: 'Warn Guild',
        channels: {
          fetch: jest.fn(() => Promise.reject(new Error('no access')))
        }
      },
      options: {
        getSubcommandGroup: () => null,
        getSubcommand: () => 'set-channel',
        getChannel: jest.fn(name => (name === 'channel' ? channel : null))
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn()
    };

    await handleTicketCommand(interaction);

    expect(warnSpy).toHaveBeenCalled();
    expect(database.__pool.query).toHaveBeenCalledWith(
      'REPLACE INTO ticket_settings (guild_id, channel_id, message_id, archive_category_id) VALUES (?, ?, ?, ?)',
      ['guild-warn', 'fresh-channel', 'fresh-message', null]
    );

    warnSpy.mockRestore();
  });

  test('set channel surfaces configuration errors', async () => {
    const channel = {
      id: 'error-channel',
      type: ChannelType.GuildText,
      toString: () => '#error',
      send: jest.fn().mockResolvedValue({ id: 'unused-message' })
    };

    database.__pool.query.mockRejectedValueOnce(new Error('db write failed'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const interaction = {
      id: 'interaction-error',
      guildId: 'guild-error',
      guild: {
        name: 'Error Guild',
        channels: { fetch: jest.fn() }
      },
      options: {
        getSubcommandGroup: () => null,
        getSubcommand: () => 'set-channel',
        getChannel: jest.fn(name => (name === 'channel' ? channel : null))
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn()
    };

    await handleTicketCommand(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith('Failed to configure the ticket lobby channel. Please check my permissions.');
    expect(settingsCache.has('guild-error')).toBe(false);

    errorSpy.mockRestore();
  });
});


describe('ticket interaction router', () => {
  beforeEach(() => {
    settingsCache.clear();
    rolesCache.clear();
    openTickets.clear();
    database.__pool.query.mockClear().mockResolvedValue([]);
  });

  test('handleButton rejects creation outside designated lobby', async () => {
    settingsCache.set('guild-button', {
      channelId: 'lobby-channel',
      messageId: 'message-id',
      archiveCategoryId: null
    });

    const interaction = {
      customId: 'ticket:create',
      guildId: 'guild-button',
      channelId: 'other-channel',
      reply: jest.fn().mockResolvedValue(undefined),
      showModal: jest.fn()
    };

    await handleButton(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Tickets can only be opened from the designated ticket channel.',
      flags: MessageFlags.Ephemeral
    });
    expect(interaction.showModal).not.toHaveBeenCalled();
  });

  test('handleButton opens the ticket modal when lobby matches', async () => {
    settingsCache.set('guild-button', {
      channelId: 'lobby-channel',
      messageId: 'message-id',
      archiveCategoryId: null
    });

    const interaction = {
      customId: 'ticket:create',
      guildId: 'guild-button',
      channelId: 'lobby-channel',
      reply: jest.fn().mockResolvedValue(undefined),
      showModal: jest.fn().mockResolvedValue(undefined)
    };

    await handleButton(interaction);

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  test('handleButton routes claim actions', async () => {
    rolesCache.set('guild-claim', new Set(['mod-role']));
    openTickets.set('channel-claim', {
      id: 1,
      guildId: 'guild-claim',
      userId: 'reporter',
      claimedBy: null,
      controlMessageId: null
    });

    const interaction = {
      customId: 'ticket:claim:1',
      guildId: 'guild-claim',
      channel: { id: 'channel-claim' },
      guild: { id: 'guild-claim' },
      member: {
        roles: { cache: { some: fn => fn({ id: 'mod-role' }) } },
        displayName: 'Mod'
      },
      user: { id: 'mod-user', username: 'Moderator' },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await handleButton(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({ content: 'Ticket claimed by <@mod-user>.' });
  });

  test('handleButton routes close actions', async () => {
    rolesCache.set('guild-close', new Set(['mod-role']));
    settingsCache.set('guild-close', {
      channelId: 'channel-close',
      messageId: 'message-id',
      archiveCategoryId: 'archive-cat'
    });
    openTickets.set('channel-close', {
      id: 2,
      guildId: 'guild-close',
      userId: 'reporter',
      claimedBy: null,
      controlMessageId: null
    });

    const permissionOverwrites = {
      edit: jest.fn().mockResolvedValue(undefined)
    };

    const channel = {
      id: 'channel-close',
      permissionOverwrites,
      setParent: jest.fn().mockResolvedValue(undefined)
    };

    const interaction = {
      customId: 'ticket:close:2',
      guildId: 'guild-close',
      channel,
      guild: { id: 'guild-close', roles: { everyone: { id: 'everyone-role' } } },
      member: { roles: { cache: { some: fn => fn({ id: 'mod-role' }) } } },
      user: { id: 'mod-user' },
      client: { users: { cache: new Map() } },
      reply: jest.fn().mockResolvedValue(undefined)
    };

    await handleButton(interaction);

    expect(permissionOverwrites.edit).toHaveBeenCalled();
    expect(channel.setParent).toHaveBeenCalledWith('archive-cat', { lockPermissions: false });
    expect(interaction.reply).toHaveBeenCalledWith({ content: 'Ticket closed and archived.' });
    expect(openTickets.has('channel-close')).toBe(false);
  });

  test('handleModalSubmit invokes ticket creation from modal submission', async () => {
    const interaction = {
      customId: 'ticket:modal:create',
      guildId: 'guild-modal',
      reply: jest.fn().mockResolvedValue(undefined),
      fields: { getTextInputValue: jest.fn() }
    };

    await handleModalSubmit(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Ticket system is not configured for this server.',
      flags: MessageFlags.Ephemeral
    });
  });

  test('handleInteraction routes chat input commands', async () => {
    rolesCache.set('guild-router', new Set(['role-router']));

    const interaction = {
      guildId: 'guild-router',
      options: {
        getSubcommandGroup: () => 'roles',
        getSubcommand: () => 'list'
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      isChatInputCommand: () => true,
      commandName: 'ticket',
      isButton: () => false,
      isModalSubmit: () => false
    };

    await expect(handleInteraction(interaction)).resolves.toBe(true);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalled();
  });

  test('handleInteraction routes button interactions', async () => {
    settingsCache.set('guild-route', {
      channelId: 'route-channel',
      messageId: 'message-id',
      archiveCategoryId: null
    });

    const interaction = {
      guildId: 'guild-route',
      channelId: 'route-channel',
      customId: 'ticket:create',
      showModal: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
      isChatInputCommand: () => false,
      isButton: () => true,
      isModalSubmit: () => false
    };

    await expect(handleInteraction(interaction)).resolves.toBe(true);

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  test('handleInteraction routes modal submissions', async () => {
    const interaction = {
      guildId: 'guild-modal-route',
      customId: 'ticket:modal:create',
      reply: jest.fn().mockResolvedValue(undefined),
      fields: { getTextInputValue: jest.fn() },
      isChatInputCommand: () => false,
      isButton: () => false,
      isModalSubmit: () => true
    };

    await expect(handleInteraction(interaction)).resolves.toBe(true);
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Ticket system is not configured for this server.',
      flags: MessageFlags.Ephemeral
    });
  });

  test('handleInteraction ignores unrelated buttons', async () => {
    const interaction = {
      isChatInputCommand: () => false,
      isButton: () => true,
      customId: 'control-panel',
      isModalSubmit: () => false,
      showModal: jest.fn(),
      reply: jest.fn()
    };

    await expect(handleInteraction(interaction)).resolves.toBe(false);
    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  test('handleInteraction ignores unrelated modals', async () => {
    const interaction = {
      isChatInputCommand: () => false,
      isButton: () => false,
      isModalSubmit: () => true,
      customId: 'control:modal',
      reply: jest.fn()
    };

    await expect(handleInteraction(interaction)).resolves.toBe(false);
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});

describe('ticket role commands', () => {
  beforeEach(() => {
    rolesCache.clear();
    database.__pool.query.mockClear().mockResolvedValue([]);
  });

  function createRolesInteraction(subcommand, role) {
    return {
      guildId: 'guild-roles',
      options: {
        getSubcommandGroup: () => 'roles',
        getSubcommand: () => subcommand,
        getRole: () => role
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined)
    };
  }

  test('roles add stores role and replies', async () => {
    const role = { id: 'role-1', toString: () => '<@&role-1>' };
    const interaction = createRolesInteraction('add', role);

    await handleTicketCommand(interaction);

    expect(database.__pool.query).toHaveBeenCalledWith(
      'REPLACE INTO ticket_roles (guild_id, role_id) VALUES (?, ?)',
      ['guild-roles', 'role-1']
    );
    expect(rolesCache.get('guild-roles')?.has('role-1')).toBe(true);
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith('Added <@&role-1> as a ticket moderator role.');
  });

  test('roles remove updates cache', async () => {
    rolesCache.set('guild-roles', new Set(['role-1', 'role-2']));
    const role = { id: 'role-1', toString: () => '<@&role-1>' };
    const interaction = createRolesInteraction('remove', role);

    await handleTicketCommand(interaction);

    expect(database.__pool.query).toHaveBeenCalledWith(
      'DELETE FROM ticket_roles WHERE guild_id = ? AND role_id = ?',
      ['guild-roles', 'role-1']
    );
    expect(rolesCache.get('guild-roles')?.has('role-1')).toBe(false);
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith('Removed <@&role-1> from ticket moderator roles.');
  });

  test('roles list reports configured roles', async () => {
    rolesCache.set('guild-roles', new Set(['role-1', 'role-2']));
    const interaction = {
      guildId: 'guild-roles',
      options: {
        getSubcommandGroup: () => 'roles',
        getSubcommand: () => 'list'
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined)
    };

    await handleTicketCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    const message = interaction.editReply.mock.calls[0][0];
    expect(message).toContain('<@&role-1>');
    expect(message).toContain('<@&role-2>');
  });

  test('roles list warns when empty', async () => {
    const interaction = {
      guildId: 'guild-empty',
      options: {
        getSubcommandGroup: () => 'roles',
        getSubcommand: () => 'list'
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined)
    };

    await handleTicketCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith('No moderator roles configured. Use /ticket roles add to add one.');
  });

  test('roles add surfaces database errors', async () => {
    const role = { id: 'role-err', toString: () => '<@&role-err>' };
    const interaction = createRolesInteraction('add', role);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    database.__pool.query.mockRejectedValueOnce(new Error('db down'));

    await handleTicketCommand(interaction);

    expect(interaction.editReply).toHaveBeenLastCalledWith('Failed to add the ticket moderator role.');
    expect(rolesCache.has('guild-roles')).toBe(false);

    errorSpy.mockRestore();
  });

  test('roles remove surfaces database errors', async () => {
    rolesCache.set('guild-roles', new Set(['role-1']));
    const role = { id: 'role-1', toString: () => '<@&role-1>' };
    const interaction = createRolesInteraction('remove', role);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    database.__pool.query.mockRejectedValueOnce(new Error('db down'));

    await handleTicketCommand(interaction);

    expect(interaction.editReply).toHaveBeenLastCalledWith('Failed to remove the ticket moderator role.');
    expect(rolesCache.get('guild-roles')?.has('role-1')).toBe(true);

    errorSpy.mockRestore();
  });

  test('roles list handles edit failures', async () => {
    rolesCache.set('guild-roles', new Set(['role-1']));
    const interaction = {
      guildId: 'guild-roles',
      options: {
        getSubcommandGroup: () => 'roles',
        getSubcommand: () => 'list'
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest
        .fn()
        .mockRejectedValueOnce(new Error('discord down'))
        .mockResolvedValue(undefined)
    };
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await handleTicketCommand(interaction);

    expect(interaction.editReply).toHaveBeenLastCalledWith('Failed to fetch ticket moderator roles.');

    errorSpy.mockRestore();
  });
});

describe('ticket archive command', () => {
  beforeEach(() => {
    settingsCache.clear();
    database.__pool.query.mockClear().mockResolvedValue([]);
  });

  function createArchiveInteraction(category) {
    return {
      guildId: 'guild-archive',
      options: {
        getChannel: () => category
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined)
    };
  }

  test('set archive updates cache and database', async () => {
    const category = { id: 'archive-1', type: ChannelType.GuildCategory, toString: () => '#Archive' };
    settingsCache.set('guild-archive', { channelId: '123', messageId: '456', archiveCategoryId: null });
    const interaction = createArchiveInteraction(category);

    await handleSetArchive(interaction);

    expect(database.__pool.query).toHaveBeenCalledWith(
      'UPDATE ticket_settings SET archive_category_id = ? WHERE guild_id = ?',
      ['archive-1', 'guild-archive']
    );
    expect(settingsCache.get('guild-archive').archiveCategoryId).toBe('archive-1');
    expect(interaction.editReply).toHaveBeenCalledWith('Ticket archive category set to #Archive.');
  });

  test('set archive requires configured lobby', async () => {
    const category = { id: 'archive-2', type: ChannelType.GuildCategory, toString: () => '#Archive' };
    const interaction = createArchiveInteraction(category);

    await handleSetArchive(interaction);

    expect(database.__pool.query).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith('Ticket lobby is not configured yet. Use /ticket set-channel first.');
  });

  test('set archive rejects non-category channel', async () => {
    const category = { id: 'text-1', type: ChannelType.GuildText, toString: () => '#general' };
    const interaction = createArchiveInteraction(category);

    await handleSetArchive(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({ content: 'Please choose a category channel for archives.', flags: MessageFlags.Ephemeral });
    expect(interaction.deferReply).not.toHaveBeenCalled();
  });

  test('set archive surfaces database errors', async () => {
    const category = { id: 'archive-err', type: ChannelType.GuildCategory, toString: () => '#Archive' };
    settingsCache.set('guild-archive', { channelId: '123', messageId: '456', archiveCategoryId: null });
    const interaction = createArchiveInteraction(category);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    database.__pool.query.mockRejectedValueOnce(new Error('db down'));

    await handleSetArchive(interaction);

    expect(interaction.editReply).toHaveBeenLastCalledWith('Failed to update the ticket archive category.');
    expect(settingsCache.get('guild-archive').archiveCategoryId).toBeNull();

    errorSpy.mockRestore();
  });
});

describe('ticket lobby UI', () => {
  test('buildLobbyEmbed returns expected fields', () => {
    const embed = buildLobbyEmbed('Guild Name');
    expect(embed.data.title).toBe('Need Assistance?');
    expect(embed.data.fields[0].value).toContain('Open Ticket');
  });

  test('buildTicketControls toggles claim button', () => {
    const [row] = buildTicketControls(99, 'Tester');
    const claimButton = row.components[0];
    expect(claimButton.data.custom_id).toBe('ticket:claim:99');
    expect(claimButton.data.disabled).toBe(true);
    const [openRow] = buildTicketControls(100, null);
    expect(openRow.components[0].data.disabled).toBe(false);
  });
  test('buildLobbyComponents includes create button', () => {
    const rows = buildLobbyComponents();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.components[0].data.custom_id).toBe('ticket:create');
  });
});

describe('tickets initialize', () => {
  beforeEach(() => {
    database.__pool.query.mockReset();
    database.__pool.query.mockImplementation(() => Promise.resolve([[]]));
  });

  afterEach(() => {
    database.__pool.query.mockReset();
    database.__pool.query.mockResolvedValue([]);
  });

  test('initializes schema and listeners once', async () => {
    const client = {
      on: jest.fn()
    };

    await tickets.initialize(client);

    // three schema queries + three cache queries
    expect(database.__pool.query).toHaveBeenCalledTimes(6);
    expect(client.on).toHaveBeenCalledWith(Events.MessageCreate, expect.any(Function));

    const queryCount = database.__pool.query.mock.calls.length;
    const onCount = client.on.mock.calls.length;

    await tickets.initialize(client);

    expect(database.__pool.query.mock.calls.length).toBe(queryCount);
    expect(client.on.mock.calls.length).toBe(onCount);
  });
});
