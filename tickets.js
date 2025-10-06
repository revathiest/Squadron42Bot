// tickets.js
// Ticketing system: allows users to create support tickets via buttons and modals.

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  Events,
  ModalBuilder,
  MessageFlags,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { getPool } = require('./database');

const settingsCache = new Map(); // guildId -> { channelId, messageId, archiveCategoryId }
const rolesCache = new Map(); // guildId -> Set(roleId)
const openTickets = new Map(); // channelId -> { id, guildId, userId, claimedBy, controlMessageId }

let clientRef;
let initialized = false;

console.log('tickets: module loaded');

/* istanbul ignore next */
async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ticket_settings (
      guild_id VARCHAR(20) NOT NULL PRIMARY KEY,
      channel_id VARCHAR(20) NOT NULL,
      message_id VARCHAR(20) NOT NULL,
      archive_category_id VARCHAR(20) DEFAULT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ticket_roles (
      guild_id VARCHAR(20) NOT NULL,
      role_id VARCHAR(20) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, role_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      guild_id VARCHAR(20) NOT NULL,
      user_id VARCHAR(20) NOT NULL,
      channel_id VARCHAR(20) DEFAULT NULL,
      status ENUM('open', 'closed') NOT NULL DEFAULT 'open',
      claimed_by VARCHAR(20) DEFAULT NULL,
      closed_by VARCHAR(20) DEFAULT NULL,
      control_message_id VARCHAR(20) DEFAULT NULL,
      description TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      closed_at TIMESTAMP NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}

/* istanbul ignore next */
async function loadCache(pool) {
  const [settingsRows] = await pool.query('SELECT guild_id, channel_id, message_id, archive_category_id FROM ticket_settings');
  settingsCache.clear();
  for (const row of settingsRows) {
    settingsCache.set(row.guild_id, {
      channelId: row.channel_id,
      messageId: row.message_id,
      archiveCategoryId: row.archive_category_id || null
    });
  }

  const [roleRows] = await pool.query('SELECT guild_id, role_id FROM ticket_roles');
  rolesCache.clear();
  for (const row of roleRows) {
    let set = rolesCache.get(row.guild_id);
    if (!set) {
      set = new Set();
      rolesCache.set(row.guild_id, set);
    }
    set.add(row.role_id);
  }

  const [ticketRows] = await pool.query('SELECT id, guild_id, user_id, channel_id, claimed_by, control_message_id FROM tickets WHERE status = "open" AND channel_id IS NOT NULL');
  openTickets.clear();
  for (const row of ticketRows) {
    openTickets.set(row.channel_id, {
      id: row.id,
      guildId: row.guild_id,
      userId: row.user_id,
      claimedBy: row.claimed_by || null,
      controlMessageId: row.control_message_id || null
    });
  }
}

function getModeratorRoles(guildId) {
  return rolesCache.get(guildId) || new Set();
}

function buildTicketChannelName(userDisplay, ticketId) {
  const sanitized = sanitizeNameSegment(userDisplay);
  return `ticket-${sanitized}-${ticketId}`;
}

function sanitizeNameSegment(value) {
  if (!value) return 'user';
  const collapsed = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return collapsed || 'user';
}

function buildLobbyEmbed(guildName) {
  return new EmbedBuilder()
    .setTitle('Need Assistance?')
    .setDescription('Click the button below to open a private ticket with the moderation team.')
    .addFields(
      { name: 'How it works', value: '1. Press **Open Ticket**.\n2. Describe your issue in the form.\n3. A moderator will claim your ticket and follow up in a private channel.' },
      { name: 'Reminder', value: guildName ? `Tickets in ${guildName} are for support questions and issue reporting.` : 'Tickets are intended for support questions and issue reporting.' }
    )
    .setColor(0x5865f2);
}

function buildLobbyComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket:create')
        .setLabel('Open Ticket')
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

function buildTicketControls(ticketId, claimedBy) {
  const claimButton = new ButtonBuilder()
    .setCustomId(`ticket:claim:${ticketId}`)
    .setLabel(claimedBy ? `Claimed by ${claimedBy}` : 'Claim Ticket')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(Boolean(claimedBy));

  const closeButton = new ButtonBuilder()
    .setCustomId(`ticket:close:${ticketId}`)
    .setLabel('Close Ticket')
    .setStyle(ButtonStyle.Danger);

  return [new ActionRowBuilder().addComponents(claimButton, closeButton)];
}

function getSlashCommandDefinitions() {
  const ticketCommand = new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Configure and manage the ticket system.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand(sub =>
      sub
        .setName('set-channel')
        .setDescription('Designate the ticket lobby channel (only one per guild).')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Channel where users can create tickets.')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
        .addChannelOption(option =>
          option
            .setName('archive_category')
            .setDescription('Category where closed tickets are moved.')
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('set-archive')
        .setDescription('Update the archive category for closed tickets.')
        .addChannelOption(option =>
          option
            .setName('category')
            .setDescription('Archive category for closed tickets.')
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true)
        )
    )
    .addSubcommandGroup(group =>
      group
        .setName('roles')
        .setDescription('Manage moderator roles for the ticket system.')
        .addSubcommand(sub =>
          sub
            .setName('add')
            .setDescription('Add a role that can manage tickets.')
            .addRoleOption(option =>
              option
                .setName('role')
                .setDescription('Role that can manage tickets.')
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('remove')
            .setDescription('Remove a moderator role from the ticket system.')
            .addRoleOption(option =>
              option
                .setName('role')
                .setDescription('Role to remove from ticket moderators.')
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('list')
            .setDescription('List current moderator roles for tickets.')
        )
    );

  return {
    global: [],
    guild: [ticketCommand.toJSON()]
  };
}

function isModerator(guild, member) {
  if (!guild || !member) return false;
  const roles = getModeratorRoles(guild.id);
  if (roles.size === 0) {
    return member.permissions?.has(PermissionFlagsBits.ManageChannels) ?? false;
  }

  return member.roles?.cache?.some(role => roles.has(role.id)) ?? false;
}

/* istanbul ignore next */
async function handleSetChannel(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  const context = `tickets:set-channel[guild=${interaction.guildId},interaction=${interaction.id}]`;
  
  if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
    console.warn(`${context} rejected non-text channel type ${channel.type}`);
    await interaction.reply({ content: 'Please choose a text channel for ticket creation.', flags: MessageFlags.Ephemeral });
    return;
  }

  const archiveCategoryOption = interaction.options.getChannel('archive_category');
  const archiveCategoryId = archiveCategoryOption ? archiveCategoryOption.id : null;
  
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  try {
    const pool = getPool();
    const guildId = interaction.guildId;
    const existing = settingsCache.get(guildId);
    
    if (existing) {
      try {
        const previousChannel = await interaction.guild.channels.fetch(existing.channelId);
        if (previousChannel) {
          const priorMessage = await previousChannel.messages.fetch(existing.messageId);
          if (priorMessage) {
            await priorMessage.delete().catch(() => null);
          }
        }
      } catch (cleanupErr) {
        console.warn('tickets: Failed to clean up previous lobby message', context, cleanupErr);
      }
    }

    const embed = buildLobbyEmbed(interaction.guild?.name || null);
    const components = buildLobbyComponents();
    const message = await channel.send({ embeds: [embed], components });
    
    await pool.query(
      'REPLACE INTO ticket_settings (guild_id, channel_id, message_id, archive_category_id) VALUES (?, ?, ?, ?)',
      [interaction.guildId, channel.id, message.id, archiveCategoryId]
    );

    settingsCache.set(interaction.guildId, {
      channelId: channel.id,
      messageId: message.id,
      archiveCategoryId
    });

    await interaction.editReply('Ticket lobby channel configured successfully.');
  } catch (err) {
    console.error('tickets: Failed to configure ticket lobby', context, err);
    await interaction.editReply('Failed to configure the ticket lobby channel. Please check my permissions.');
  }
}

/* istanbul ignore next */
async function handleSetArchive(interaction) {
  const category = interaction.options.getChannel('category', true);
  const context = `tickets:set-archive[guild=${interaction.guildId},interaction=${interaction.id}]`;
  
  if (category.type !== ChannelType.GuildCategory) {
    console.warn(`${context} rejected non-category channel type ${category.type}`);
    await interaction.reply({ content: 'Please choose a category channel for archives.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  try {
    const guildId = interaction.guildId;
    const settings = settingsCache.get(guildId);
    if (!settings) {
      await interaction.editReply('Ticket lobby is not configured yet. Use /ticket set-channel first.');
      return;
    }

    const pool = getPool();
    await pool.query(
      'UPDATE ticket_settings SET archive_category_id = ? WHERE guild_id = ?',
      [category.id, guildId]
    );

    settings.archiveCategoryId = category.id;
    settingsCache.set(guildId, settings);
    
    await interaction.editReply('Ticket archive category set to ' + category.toString() + '.');
  } catch (err) {
    await interaction.editReply('Failed to update the ticket archive category.');
  }
}

async function handleRolesAdd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const role = interaction.options.getRole('role', true);
    const guildId = interaction.guildId;
    const pool = getPool();

    await pool.query('REPLACE INTO ticket_roles (guild_id, role_id) VALUES (?, ?)', [guildId, role.id]);
    let set = rolesCache.get(guildId);
    if (!set) {
      set = new Set();
      rolesCache.set(guildId, set);
    }
    set.add(role.id);

    await interaction.editReply(`Added ${role.toString()} as a ticket moderator role.`);
  } catch (err) {
    console.error('tickets: Failed to add ticket role', err);
    await interaction.editReply('Failed to add the ticket moderator role.');
  }
}

async function handleRolesRemove(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const role = interaction.options.getRole('role', true);
    const guildId = interaction.guildId;
    const pool = getPool();

    await pool.query('DELETE FROM ticket_roles WHERE guild_id = ? AND role_id = ?', [guildId, role.id]);
    const set = rolesCache.get(guildId);
    if (set) {
      set.delete(role.id);
    }

    await interaction.editReply(`Removed ${role.toString()} from ticket moderator roles.`);
  } catch (err) {
    console.error('tickets: Failed to remove ticket role', err);
    await interaction.editReply('Failed to remove the ticket moderator role.');
  }
}

async function handleRolesList(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const guildId = interaction.guildId;
    const set = getModeratorRoles(guildId);
    if (!set || set.size === 0) {
      await interaction.editReply('No moderator roles configured. Use /ticket roles add to add one.');
      return;
    }

    const mentions = [...set].map(roleId => `<@&${roleId}>`).join('\n');
    await interaction.editReply(`Current ticket moderator roles:\n${mentions}`);
  } catch (err) {
    console.error('tickets: Failed to list ticket roles', err);
    await interaction.editReply('Failed to fetch ticket moderator roles.');
  }
}

async function handleTicketCommand(interaction) {
  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  /* istanbul ignore next */
  if (!subcommandGroup) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'set-channel') {
      await handleSetChannel(interaction);
    } else if (subcommand === 'set-archive') {
      await handleSetArchive(interaction);
    }
    return;
  }

  if (subcommandGroup === 'roles') {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'add') {
      await handleRolesAdd(interaction);
    } else if (subcommand === 'remove') {
      await handleRolesRemove(interaction);
    } else if (subcommand === 'list') {
      await handleRolesList(interaction);
    }
    return;
  }

  /* istanbul ignore next */
  console.warn('tickets: handleTicketCommand unexpected subcommand group', { subcommandGroup, guildId: interaction.guildId ?? 'unknown' });
}

/* istanbul ignore next */
function buildTicketModal() {
  return new ModalBuilder()
    .setCustomId('ticket:modal:create')
    .setTitle('Open a Support Ticket')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('ticket:subject')
          .setLabel('What do you need help with?')
          .setMinLength(10)
          .setMaxLength(400)
          .setRequired(true)
          .setStyle(TextInputStyle.Paragraph)
      )
    );
}

/* istanbul ignore next */
async function showTicketModal(interaction) {
  const modal = buildTicketModal();
  await interaction.showModal(modal);
}

/* istanbul ignore next */
function buildTicketEmbed(user, description, ticketId) {
  return new EmbedBuilder()
    .setTitle(`Ticket #${ticketId}`)
    .setDescription(description)
    .addFields({ name: 'Opened by', value: `<@${user.id}>`, inline: true })
    .setColor(0x2b2d31)
    .setTimestamp(new Date());
}

/* istanbul ignore next */
function buildChannelOverwrites(guild, userId, moderatorRoles) {
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: new PermissionsBitField([PermissionFlagsBits.ViewChannel]).bitfield
    },
    {
      id: userId,
      allow: new PermissionsBitField([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks
      ]).bitfield
    },
    {
      id: clientRef.user.id,
      allow: new PermissionsBitField([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages
      ]).bitfield
    }
  ];

  for (const roleId of moderatorRoles) {
    overwrites.push({
      id: roleId,
      allow: new PermissionsBitField([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages
      ]).bitfield
    });
  }

  return overwrites;
}

/* istanbul ignore next */
async function createTicket(interaction) {
  const guildSettings = settingsCache.get(interaction.guildId);
  if (!guildSettings) {
    await interaction.reply({ content: 'Ticket system is not configured for this server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const description = interaction.fields.getTextInputValue('ticket:subject');
  const pool = getPool();
  const guild = interaction.guild;
  const member = interaction.member;
  const moderatorRoles = getModeratorRoles(interaction.guildId);

  const [result] = await pool.query(
    'INSERT INTO tickets (guild_id, user_id, description) VALUES (?, ?, ?)',
    [interaction.guildId, interaction.user.id, description]
  );
  const ticketId = result.insertId;

  const displayName = member?.displayName || interaction.user.username;
  const channelName = buildTicketChannelName(displayName, ticketId);
  const lobbyChannel = await guild.channels.fetch(guildSettings.channelId).catch(() => null);

  if (!lobbyChannel || !lobbyChannel.parent) {
    await interaction.reply({ content: 'Unable to create the ticket channel. Please notify the moderators.', flags: MessageFlags.Ephemeral });
    return;
  }

  const overwrites = buildChannelOverwrites(guild, interaction.user.id, moderatorRoles);
  const ticketChannel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: lobbyChannel.parent,
    permissionOverwrites: overwrites
  });

  const embed = buildTicketEmbed(interaction.user, description, ticketId);
  const controls = buildTicketControls(ticketId, null);
  const moderatorRoleIds = Array.from(moderatorRoles);
  const mentionContent = [
    `<@${interaction.user.id}>`,
    ...moderatorRoleIds.map(roleId => `<@&${roleId}>`)
  ].join(' ');
  const controlMessage = await ticketChannel.send({
    content: mentionContent,
    embeds: [embed],
    components: controls,
    allowedMentions: {
      users: [interaction.user.id],
      roles: moderatorRoleIds
    }
  });

  await pool.query('UPDATE tickets SET channel_id = ?, control_message_id = ? WHERE id = ?', [ticketChannel.id, controlMessage.id, ticketId]);

  openTickets.set(ticketChannel.id, {
    id: ticketId,
    guildId: interaction.guildId,
    userId: interaction.user.id,
    claimedBy: null,
    controlMessageId: controlMessage.id
  });

  const lobbyComponents = buildLobbyComponents();
  await interaction.reply({ content: `Ticket created: ${ticketChannel.toString()}`, flags: MessageFlags.Ephemeral });
}

/* istanbul ignore next */
async function handleCreateButton(interaction) {
  const settings = settingsCache.get(interaction.guildId);
  if (!settings || settings.channelId !== interaction.channelId) {
    await interaction.reply({ content: 'Tickets can only be opened from the designated ticket channel.', flags: MessageFlags.Ephemeral });
    return;
  }

  await showTicketModal(interaction);
}

/* istanbul ignore next */
async function updateControlMessage(channel, ticketData, claimedByLabel, disabledClose = false) {
  if (!ticketData.controlMessageId) {
    return;
  }

  try {
    const message = await channel.messages.fetch(ticketData.controlMessageId);
    const components = buildTicketControls(ticketData.id, claimedByLabel);
    if (disabledClose) {
      components[0].components[1].setDisabled(true);
    }
    await message.edit({ components });
  } catch (err) {
    // message may have been deleted; ignore
  }
}

/* istanbul ignore next */
async function handleClaim(interaction, ticketId) {
  const ticketData = [...openTickets.values()].find(ticket => ticket.id === ticketId);
  if (!ticketData) {
    await interaction.reply({ content: 'Ticket could not be found or is already closed.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (!isModerator(interaction.guild, interaction.member)) {
    await interaction.reply({ content: 'Only ticket moderators can claim tickets.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (ticketData.claimedBy) {
    await interaction.reply({ content: 'This ticket has already been claimed.', flags: MessageFlags.Ephemeral });
    return;
  }

  const pool = getPool();
  await pool.query('UPDATE tickets SET claimed_by = ? WHERE id = ?', [interaction.user.id, ticketId]);
  ticketData.claimedBy = interaction.user.id;

  await updateControlMessage(interaction.channel, ticketData, interaction.member?.displayName || interaction.user.username);

  await interaction.reply({ content: `Ticket claimed by <@${interaction.user.id}>.` });
}

/* istanbul ignore next */
async function handleClose(interaction, ticketId) {
  const ticketData = [...openTickets.values()].find(ticket => ticket.id === ticketId);
  if (!ticketData) {
    await interaction.reply({ content: 'Ticket could not be found or is already closed.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (!isModerator(interaction.guild, interaction.member)) {
    await interaction.reply({ content: 'Only ticket moderators can close tickets.', flags: MessageFlags.Ephemeral });
    return;
  }

  const pool = getPool();
  await pool.query(
    'UPDATE tickets SET status = "closed", closed_at = NOW(), closed_by = ? WHERE id = ?',
    [interaction.user.id, ticketId]
  );

  const settings = settingsCache.get(interaction.guildId);
  const channel = interaction.channel;
  openTickets.delete(channel.id);

  const overwrites = channel.permissionOverwrites;
  overwrites.edit(ticketData.userId, {
    ViewChannel: false,
    SendMessages: false,
    AddReactions: false
  }).catch(() => null);

  const moderatorRoles = getModeratorRoles(interaction.guildId);
  for (const roleId of moderatorRoles) {
    overwrites.edit(roleId, {
      SendMessages: false,
      AddReactions: false
    }).catch(() => null);
  }

  overwrites.edit(interaction.guild.roles.everyone, {
    ViewChannel: false,
    SendMessages: false
  }).catch(() => null);

  if (settings?.archiveCategoryId) {
    await channel.setParent(settings.archiveCategoryId, { lockPermissions: false }).catch(() => null);
  }

  const claimedUser = ticketData.claimedBy ? interaction.client.users.cache.get(ticketData.claimedBy) : null;
  const claimedLabel = claimedUser?.username || null;
  await updateControlMessage(channel, ticketData, claimedLabel, true);
  await interaction.reply({ content: 'Ticket closed and archived.' });
}

async function handleButton(interaction) {
  if (interaction.customId === 'ticket:create') {
    await handleCreateButton(interaction);
    return;
  }

  const parts = interaction.customId.split(':');
  /* istanbul ignore next */
  if (parts.length !== 3 || parts[0] !== 'ticket') {
    console.warn('tickets: handleButton unhandled customId', { customId: interaction.customId });
    return;
  }

  const action = parts[1];
  const ticketId = Number(parts[2]);
  /* istanbul ignore next */
  if (Number.isNaN(ticketId)) {
    await interaction.reply({ content: 'Invalid ticket identifier.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (action === 'claim') {
    await handleClaim(interaction, ticketId);
    return;
  }

  if (action === 'close') {
    await handleClose(interaction, ticketId);
    return;
  }

  /* istanbul ignore next */
  console.warn('tickets: handleButton unexpected action', { action, customId: interaction.customId });
}

async function handleModalSubmit(interaction) {
  if (interaction.customId === 'ticket:modal:create') {
    await createTicket(interaction);
    return;
  }

  /* istanbul ignore next */
  console.warn('tickets: handleModalSubmit unhandled customId', { customId: interaction.customId });
}

async function handleInteraction(interaction) {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'ticket') {
      await handleTicketCommand(interaction);
    }
    return;
  }

  if (interaction.isButton()) {
    await handleButton(interaction);
    return;
  }

  if (interaction.isModalSubmit()) {
    await handleModalSubmit(interaction);
    return;
  }

  /* istanbul ignore next */
  console.warn('tickets: handleInteraction ignored interaction type', { type: interaction.type, guildId: interaction.guildId ?? 'unknown' });
}

/* istanbul ignore next */
async function initialize(client) {
  if (initialized) {
    return;
  }

  clientRef = client;
  const pool = getPool();
  await ensureSchema(pool);
  await loadCache(pool);
  
  client.on(Events.InteractionCreate, interaction => {
    handleInteraction(interaction).catch(err => {
      console.error('tickets: Failed to process interaction', err);
      if (interaction.isRepliable() && !interaction.replied) {
        interaction.reply({ content: 'An error occurred while handling that ticket action.', flags: MessageFlags.Ephemeral }).catch(() => null);
      }
    });
  });

  initialized = true;
}

/* istanbul ignore next */
async function ensureLobbyMessage(guildId) {
  const settings = settingsCache.get(guildId);
  if (!settings) {
    return;
  }

  if (!clientRef) {
    console.warn('tickets: ensureLobbyMessage called before client is ready', { guildId });
    return;
  }

  let guild;
  try {
    guild = await clientRef.guilds.fetch(guildId);
  } catch (err) {
    if (err?.code === 10004 || err?.status === 404) {
      console.info('tickets: Skipping lobby message bootstrap; guild is unreachable for this bot. Remove stale ticket settings if this guild is handled elsewhere.', { guildId });
    } else {
      console.warn('tickets: Failed to fetch guild while ensuring lobby message', { guildId }, err);
    }
    return;
  }

  let channel;
  try {
    channel = await guild.channels.fetch(settings.channelId);
  } catch (err) {
    console.warn('tickets: Failed to fetch lobby channel during ensureLobbyMessage', { guildId, channelId: settings.channelId }, err);
    return;
  }

  if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
    console.warn('tickets: Lobby channel missing or invalid during ensureLobbyMessage', { guildId, channelId: settings.channelId });
    return;
  }

  const embed = buildLobbyEmbed(guild.name);
  const components = buildLobbyComponents();

  if (settings.messageId) {
    try {
      const existingMessage = await channel.messages.fetch(settings.messageId);
      await existingMessage.edit({ embeds: [embed], components });
      return;
    } catch (err) {
      console.warn('tickets: Failed to edit existing lobby message, creating new one', { guildId, messageId: settings.messageId }, err);
    }
  }

  try {
    const sentMessage = await channel.send({ embeds: [embed], components });
    settings.messageId = sentMessage.id;
    settingsCache.set(guildId, settings);
    await getPool().query('UPDATE ticket_settings SET message_id = ? WHERE guild_id = ?', [sentMessage.id, guildId]);
  } catch (err) {
    console.error('tickets: Failed to create lobby message', { guildId, channelId: channel.id }, err);
  }
}

/* istanbul ignore next */
async function onReady(client) {
  clientRef = client;

  const ensurePromises = [];
  for (const guildId of settingsCache.keys()) {
    ensurePromises.push(ensureLobbyMessage(guildId));
  }

  if (ensurePromises.length > 0) {
    const results = await Promise.allSettled(ensurePromises);
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) {
      console.warn('tickets: Failed to ensure lobby messages for some guilds', failures);
    }
  }
}

module.exports = {
  getSlashCommandDefinitions,
  initialize,
  onReady,
  __testables: {
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
  }
};
