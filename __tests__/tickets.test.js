const { PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');

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
  handleSetArchive,
  buildLobbyEmbed,
  buildTicketControls,
  buildLobbyComponents,
  settingsCache,
  rolesCache
} = tickets.__testables;

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




