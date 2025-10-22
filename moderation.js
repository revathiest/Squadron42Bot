// moderation.js
// Provides moderation context menu commands (warn/kick/ban) with role-based access control and auditing.

const {
  ActionRowBuilder,
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  Events,
  GuildMember,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { getPool } = require('./database');

const ACTIONS = {
  warn: {
    label: 'Warn User'
  },
  kick: {
    label: 'Kick User'
  },
  ban: {
    label: 'Ban User'
  }
};

const PARDON_CONTEXT_LABEL = 'Pardon User';
const HISTORY_CONTEXT_LABEL = 'View Moderation History';

const roleCache = new Map(); // guildId -> Map(action -> Set(roleId))
let initialized = false;
let clientRef;

function ensureActionMap(guildId) {
  let actionMap = roleCache.get(guildId);
  if (!actionMap) {
    actionMap = new Map();
    roleCache.set(guildId, actionMap);
  }
  return actionMap;
}

function getActionRoles(guildId, action) {
  const actions = roleCache.get(guildId);
  return actions ? actions.get(action) || new Set() : new Set();
}

function addRoleToCache(guildId, action, roleId) {
  const actionMap = ensureActionMap(guildId);
  let roles = actionMap.get(action);
  if (!roles) {
    roles = new Set();
    actionMap.set(action, roles);
  }
  roles.add(roleId);
}

function removeRoleFromCache(guildId, action, roleId) {
  const actionMap = roleCache.get(guildId);
  if (!actionMap) {
    return;
  }

  const roles = actionMap.get(action);
  if (!roles) {
    return;
  }

  roles.delete(roleId);
  if (roles.size === 0) {
    actionMap.delete(action);
  }

  if (actionMap.size === 0) {
    roleCache.delete(guildId);
  }
}

/* istanbul ignore next */
async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS moderation_roles (
      guild_id VARCHAR(20) NOT NULL,
      action ENUM('warn', 'kick', 'ban') NOT NULL,
      role_id VARCHAR(20) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, action, role_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS moderation_actions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      guild_id VARCHAR(20) NOT NULL,
      action ENUM('warn', 'kick', 'ban', 'pardon') NOT NULL,
      target_id VARCHAR(20) NOT NULL,
      target_tag VARCHAR(40) DEFAULT NULL,
      executor_id VARCHAR(20) NOT NULL,
      executor_tag VARCHAR(40) DEFAULT NULL,
      reason TEXT NOT NULL,
      reference_message_url TEXT DEFAULT NULL,
      reference_message_content TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    ALTER TABLE moderation_actions
    MODIFY COLUMN action ENUM('warn', 'kick', 'ban', 'pardon') NOT NULL
  `).catch(err => {
    if (err?.code !== 'ER_BAD_FIELD_ERROR' && err?.code !== 'ER_CANT_MODIFY_USED_TABLE') {
      throw err;
    }
  });
}

/* istanbul ignore next */
async function loadRoleCache(pool) {
  roleCache.clear();
  const [rows] = await pool.query('SELECT guild_id, action, role_id FROM moderation_roles');
  for (const row of rows) {
    addRoleToCache(row.guild_id, row.action, row.role_id);
  }
}

function memberHasRole(member, roleId) {
  if (!member || !roleId) {
    return false;
  }

  const cache = member.roles?.cache;
  if (!cache) {
    return false;
  }

  if (typeof cache.has === 'function') {
    return cache.has(roleId);
  }

  if (typeof cache.some === 'function') {
    return cache.some(role => (role?.id ?? role) === roleId);
  }

  if (Array.isArray(cache)) {
    return cache.some(role => (role?.id ?? role) === roleId);
  }

  return false;
}

function hasActionPermission(guildId, member, action) {
  if (!member || !ACTIONS[action]) {
    return false;
  }

  const configuredRoles = getActionRoles(guildId, action);
  if (configuredRoles.size === 0) {
    return false;
  }

  for (const roleId of configuredRoles) {
    if (memberHasRole(member, roleId)) {
      return true;
    }
  }

  return false;
}

function parseReferenceInput(input) {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const urlMatch = trimmed.match(
    /^https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)(?:\/)?$/i
  );
  if (urlMatch) {
    return {
      guildId: urlMatch[1],
      channelId: urlMatch[2],
      messageId: urlMatch[3],
      raw: trimmed
    };
  }

  const idPair = trimmed.match(/^(\d+):(\d+)$/);
  if (idPair) {
    return {
      channelId: idPair[1],
      messageId: idPair[2],
      raw: trimmed
    };
  }

  return { raw: trimmed };
}

async function fetchReferenceMessage(client, guild, reference) {
  if (!reference || !reference.channelId || !reference.messageId || !guild) {
    return { url: reference?.raw ?? null, content: null };
  }

  if (reference.guildId && reference.guildId !== guild.id) {
    return { url: reference.raw, content: null };
  }

  try {
    const channel = await guild.channels.fetch(reference.channelId);
    if (!channel || typeof channel.messages?.fetch !== 'function') {
      return { url: reference.raw, content: null };
    }

    const message = await channel.messages.fetch(reference.messageId);
    if (!message) {
      return { url: reference.raw, content: null };
    }

    const content = typeof message.content === 'string' ? message.content : null;
    return {
      url: `https://discord.com/channels/${guild.id}/${reference.channelId}/${reference.messageId}`,
      content: content ? content.slice(0, 1900) : null
    };
  } catch (err) {
    console.warn('moderation: Failed to fetch reference message', {
      guildId: guild.id,
      channelId: reference.channelId,
      messageId: reference.messageId
    }, err);
    return { url: reference.raw, content: null };
  }
}

function buildRoleList(guildId) {
  const actionMap = roleCache.get(guildId);
  if (!actionMap || actionMap.size === 0) {
    return 'No moderation roles configured yet.';
  }

  const lines = [];
  for (const [action, roles] of actionMap.entries()) {
    if (!roles || roles.size === 0) {
      continue;
    }
    const mentions = Array.from(roles).map(roleId => `<@&${roleId}>`).join(', ');
    lines.push(`• **${ACTIONS[action].label}** → ${mentions}`);
  }

  return lines.length ? lines.join('\n') : 'No moderation roles configured yet.';
}

function buildRoleChoices(builder) {
  return builder
    .addStringOption(option =>
      option
        .setName('action')
        .setDescription('Moderation action to configure.')
        .setRequired(true)
        .addChoices(
          ...Object.entries(ACTIONS).map(([key, value]) => ({ name: value.label, value: key }))
        )
    )
    .addRoleOption(option =>
      option
        .setName('role')
        .setDescription('Role to add or remove.')
        .setRequired(true)
    );
}

function buildSlashCommandDefinition() {
  const builder = new SlashCommandBuilder()
    .setName('mod')
    .setDescription('Manage moderation roles for context actions.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommandGroup(group =>
      group
        .setName('roles')
        .setDescription('Manage which roles can warn, kick, or ban.')
        .addSubcommand(sub =>
          buildRoleChoices(
            sub
              .setName('add')
              .setDescription('Allow a role to use a moderation action.')
          )
        )
        .addSubcommand(sub =>
          buildRoleChoices(
            sub
              .setName('remove')
              .setDescription('Remove a role from a moderation action.')
          )
        )
        .addSubcommand(sub =>
          sub
              .setName('list')
              .setDescription('List configured moderation roles.')
        )
    );

  return builder.toJSON();
}

function buildContextCommand(action) {
  return new ContextMenuCommandBuilder()
    .setName(ACTIONS[action].label)
    .setType(ApplicationCommandType.User)
    .setDMPermission(false)
    .toJSON();
}

function buildPardonContextCommand() {
  return new ContextMenuCommandBuilder()
    .setName(PARDON_CONTEXT_LABEL)
    .setType(ApplicationCommandType.User)
    .setDMPermission(false)
    .toJSON();
}

function buildHistoryContextCommand() {
  return new ContextMenuCommandBuilder()
    .setName(HISTORY_CONTEXT_LABEL)
    .setType(ApplicationCommandType.User)
    .setDMPermission(false)
    .toJSON();
}

function getSlashCommandDefinitions() {
  return {
    guild: [
      buildSlashCommandDefinition(),
      buildContextCommand('warn'),
      buildContextCommand('kick'),
      buildContextCommand('ban'),
      buildPardonContextCommand(),
      buildHistoryContextCommand()
    ],
    global: []
  };
}

function buildReasonModal({ action, targetUser }) {
  const modal = new ModalBuilder()
    .setCustomId(`moderation:${action}:${targetUser.id}`)
    .setTitle(`${ACTIONS[action].label}`);

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason')
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(6)
    .setMaxLength(1024)
    .setRequired(true)
    .setPlaceholder('Describe why this action is being taken.');

  const referenceInput = new TextInputBuilder()
    .setCustomId('reference')
    .setLabel('Message link (optional)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder('Paste the message URL or channelId:messageId');

  modal.addComponents(
    new ActionRowBuilder().addComponents(reasonInput),
    new ActionRowBuilder().addComponents(referenceInput)
  );

  return modal;
}

function buildPardonModal(targetUser) {
  const modal = new ModalBuilder()
    .setCustomId(`moderation:pardon:${targetUser.id}`)
    .setTitle('Pardon User');

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason for pardon')
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(6)
    .setMaxLength(512)
    .setRequired(true)
    .setPlaceholder('Explain why this user is being pardoned.');

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
  return modal;
}

async function respondEphemeral(interaction, payload) {
  if (!interaction) {
    return;
  }

  const response = typeof payload === 'string'
    ? { content: payload, flags: MessageFlags.Ephemeral }
    : { ...payload, flags: MessageFlags.Ephemeral };

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(response).catch(() => null);
  }

  return interaction.reply(response).catch(() => null);
}

async function handleRoleAdd(interaction) {
  const action = interaction.options.getString('action', true);
  const role = interaction.options.getRole('role', true);
  const guildId = interaction.guildId;
  const pool = getPool();

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch {
    return;
  }

  try {
    await pool.query(
      'INSERT IGNORE INTO moderation_roles (guild_id, action, role_id) VALUES (?, ?, ?)',
      [guildId, action, role.id]
    );
    addRoleToCache(guildId, action, role.id);
    await interaction.editReply(`Added ${role} to the **${ACTIONS[action].label}** role list.`);
  } catch (err) {
    console.error('moderation: Failed to add moderation role', { guildId, action, roleId: role.id }, err);
    await interaction.editReply('Failed to add the moderation role. Please try again later.');
  }
}

async function handleRoleRemove(interaction) {
  const action = interaction.options.getString('action', true);
  const role = interaction.options.getRole('role', true);
  const guildId = interaction.guildId;
  const pool = getPool();

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch {
    return;
  }

  try {
    const [result] = await pool.query(
      'DELETE FROM moderation_roles WHERE guild_id = ? AND action = ? AND role_id = ?',
      [guildId, action, role.id]
    );
    if (result?.affectedRows) {
      removeRoleFromCache(guildId, action, role.id);
    }
    await interaction.editReply(`Removed ${role} from the **${ACTIONS[action].label}** role list.`);
  } catch (err) {
    /* istanbul ignore next */ {
      console.error('moderation: Failed to remove moderation role', { guildId, action, roleId: role.id }, err);
      await interaction.editReply('Failed to remove the moderation role. Please try again later.');
    }
  }
}

async function handleRoleList(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch {
    return;
  }

  const summary = buildRoleList(interaction.guildId);
  try {
    await interaction.editReply(summary);
  } catch (err) {
    /* istanbul ignore next */ {
      console.error('moderation: Failed to return moderation role list', { guildId: interaction.guildId }, err);
      await interaction.editReply('Failed to fetch moderation roles.');
    }
  }
}

async function handleModCommand(interaction) {
  const group = interaction.options.getSubcommandGroup(false);

  if (group === 'roles') {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'add') {
      return handleRoleAdd(interaction);
    }

    if (subcommand === 'remove') {
      return handleRoleRemove(interaction);
    }

    if (subcommand === 'list') {
      return handleRoleList(interaction);
    }
  }

  return respondEphemeral(interaction, 'Unsupported moderation command.');
}

function canModerateMember(invoker, targetMember) {
  if (!targetMember || !invoker) {
    return true;
  }

  if (!(invoker instanceof GuildMember) || !(targetMember instanceof GuildMember)) {
    if (!targetMember.roles?.highest || !invoker.roles?.highest) {
      return true;
    }
  }

  const invokerHighest = invoker.roles?.highest;
  const targetHighest = targetMember.roles?.highest;

  if (!invokerHighest || !targetHighest) {
    return true;
  }

  return invokerHighest.comparePositionTo(targetHighest) > 0;
}

async function handleActionRequest(interaction, action) {
  const guildId = interaction.guildId;
  const member = interaction.member;

  if (!guildId || !member) {
    return respondEphemeral(interaction, 'This command can only be used inside a guild.');
  }

  if (!hasActionPermission(guildId, member, action)) {
    return respondEphemeral(interaction, 'You are not allowed to use this moderation action.');
  }

  const targetUser = interaction.targetUser;
  if (!targetUser) {
    return respondEphemeral(interaction, 'Unable to identify the selected user.');
  }

  if (targetUser.id === interaction.user.id) {
    return respondEphemeral(interaction, 'You cannot perform moderation actions on yourself.');
  }

  if (targetUser.id === interaction.client.user.id) {
    return respondEphemeral(interaction, 'Nice try. I refuse to moderate myself.');
  }

  await interaction.showModal(buildReasonModal({ action, targetUser }));
}

async function validateContext(interaction, action, targetId) {
  const guild = interaction.guild;
  const guildId = interaction.guildId;

  if (!guild || !guildId) {
    await respondEphemeral(interaction, 'This moderation action must be used inside a guild.');
    return null;
  }

  const member = interaction.member || (await guild.members.fetch(interaction.user.id).catch(() => null));
  if (!member) {
    await respondEphemeral(interaction, 'Could not resolve your guild membership for permission checks.');
    return null;
  }

  if (!hasActionPermission(guildId, member, action)) {
    await respondEphemeral(interaction, 'You are not allowed to use this moderation action.');
    return null;
  }

  let targetMember = null;
  try {
    targetMember = await guild.members.fetch(targetId);
  } catch {
    targetMember = null;
  }

  if (targetMember?.id === interaction.user.id) {
    await respondEphemeral(interaction, 'You cannot perform moderation actions on yourself.');
    return null;
  }

  if (targetMember?.id === guild.ownerId) {
    await respondEphemeral(interaction, 'You cannot moderate the guild owner.');
    return null;
  }

  if (targetMember && !canModerateMember(member, targetMember)) {
    await respondEphemeral(interaction, 'This user has a higher or equal role. Adjust role hierarchy before attempting this action.');
    return null;
  }

  return { guild, member, targetMember };
}

async function logAction({ guildId, action, targetUser, moderator, reason, reference }) {
  const pool = getPool();
  try {
    await pool.query(
      `INSERT INTO moderation_actions
       (guild_id, action, target_id, target_tag, executor_id, executor_tag, reason, reference_message_url, reference_message_content)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        guildId,
        action,
        targetUser.id,
        targetUser.tag ?? null,
        moderator.id,
        moderator.tag ?? null,
        reason,
        reference?.url ?? reference?.raw ?? null,
        reference?.content ?? null
      ]
    );
  } catch (err) {
    console.error('moderation: Failed to record moderation action', { guildId, action }, err);
  }
}

async function dmUser(targetUser, action, reason, guildName) {
  if (!targetUser) {
    return;
  }

  try {
    await targetUser.send(
      `You have received a ${action.toUpperCase()}${guildName ? ` in ${guildName}` : ''}.\nReason: ${reason}`
    );
  } catch {
    // Silently ignore DM failures.
  }
}

async function executePardon({ interaction, targetUser, moderator, reason }) {
  await logAction({
    guildId: interaction.guildId,
    action: 'pardon',
    targetUser,
    moderator,
    reason,
    reference: null
  });

  await dmUser(targetUser, 'pardon', reason, interaction.guild?.name);
}

function hasHistoryPermission(guildId, member) {
  if (!member) {
    return false;
  }

  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) {
    return true;
  }

  return Object.keys(ACTIONS).some(action => hasActionPermission(guildId, member, action));
}

function toTimestamp(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatTimestamp(value) {
  const timestamp = toTimestamp(value);
  if (!timestamp) {
    return 'Unknown time';
  }

  const iso = new Date(timestamp).toISOString();
  return iso.replace('T', ' ').replace('Z', ' UTC');
}

function formatReason(reason) {
  if (!reason) {
    return 'No reason provided.';
  }

  const collapsed = reason.replace(/\s+/g, ' ').trim();
  if (!collapsed) {
    return 'No reason provided.';
  }

  if (collapsed.length > 180) {
    return `${collapsed.slice(0, 177)}...`;
  }

  return collapsed;
}

function filterEntriesForModerators(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }

  const latestPardon = entries.find(entry => entry.action === 'pardon');
  if (!latestPardon) {
    return entries.filter(entry => entry.action !== 'pardon');
  }

  const cutoff = toTimestamp(latestPardon.created_at);
  if (!cutoff) {
    return entries.filter(entry => entry.action !== 'pardon');
  }

  return entries.filter(entry => entry.action !== 'pardon' && toTimestamp(entry.created_at) > cutoff);
}

function buildHistoryLines(entries) {
  const lines = [];
  let length = 0;
  let truncated = false;

  for (const entry of entries) {
    const verb = entry.action?.toUpperCase?.() || 'UNKNOWN';
    const timestamp = formatTimestamp(entry.created_at);
    const moderator = entry.executor_tag || entry.executor_id || 'Unknown moderator';
    const reason = formatReason(entry.reason);
    const reference = entry.reference_message_url ? ` | Ref: ${entry.reference_message_url}` : '';
    const line = `• ${verb} | ${timestamp} | by ${moderator} | Reason: ${reason}${reference}`;

    if (length + line.length + 1 > 1800) {
      truncated = true;
      break;
    }

    lines.push(line);
    length += line.length + 1;
  }

  return { lines, truncated };
}

async function fetchHistoryRows(guildId, targetId) {
  const pool = getPool();
  const [result] = await pool.query(
    `SELECT action, reason, executor_tag, executor_id, reference_message_url, created_at
     FROM moderation_actions
     WHERE guild_id = ? AND target_id = ?
     ORDER BY created_at DESC`,
    [guildId, targetId]
  );
  return Array.isArray(result) ? result : [];
}

function buildHistoryContent({ targetLabel, rows, isAdministrator }) {
  const visibleEntries = isAdministrator ? rows : filterEntriesForModerators(rows);

  if (visibleEntries.length === 0) {
    return {
      empty: true,
      content: `No moderation history for ${targetLabel} since their last pardon.`
    };
  }

  const { lines, truncated } = buildHistoryLines(visibleEntries);
  let content = `Moderation history for ${targetLabel}:\n${lines.join('\n')}`;
  if (truncated) {
    content += '\nAdditional records were omitted for length.';
  }

  return { empty: false, content };
}

async function handlePardonContext(interaction) {
  const guildId = interaction.guildId;
  const guild = interaction.guild;
  const targetUser = interaction.targetUser;

  if (!guildId || !guild) {
    await respondEphemeral(interaction, 'This moderation action must be used inside a guild.');
    return;
  }

  if (!targetUser) {
    await respondEphemeral(interaction, 'Unable to identify the selected user.');
    return;
  }

  if (targetUser.id === interaction.user.id) {
    await respondEphemeral(interaction, 'You cannot issue a pardon to yourself.');
    return;
  }

  let member = interaction.member;
  if (!member) {
    try {
      member = await guild.members.fetch(interaction.user.id);
    } catch {
      member = null;
    }
  }

  if (!member?.permissions?.has?.(PermissionFlagsBits.Administrator)) {
    await respondEphemeral(interaction, 'You must be an administrator to pardon users.');
    return;
  }

  try {
    await interaction.showModal(buildPardonModal(targetUser));
  } catch (err) {
    /* istanbul ignore next */ {
      console.error('moderation: Failed to show pardon modal', { guildId, targetId: targetUser.id }, err);
      await respondEphemeral(interaction, 'Unable to open the pardon dialog. Please try again later.');
    }
  }
}

async function handleHistoryContext(interaction) {
  const targetUser = interaction.targetUser;
  const guildId = interaction.guildId;
  const guild = interaction.guild;

  if (!guildId || !guild) {
    await respondEphemeral(interaction, 'This command can only be used inside a guild.');
    return;
  }

  if (!targetUser) {
    await respondEphemeral(interaction, 'Unable to identify the selected user.');
    return;
  }

  let member = interaction.member;
  if (!member) {
    try {
      member = await guild.members.fetch(interaction.user.id);
    } catch {
      member = null;
    }
  }

  const isAdministrator = member?.permissions?.has?.(PermissionFlagsBits.Administrator);
  if (!isAdministrator && !hasHistoryPermission(guildId, member)) {
    await respondEphemeral(interaction, 'You are not allowed to view moderation history.');
    return;
  }

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch {
    return;
  }

  let rows = [];
  try {
    rows = await fetchHistoryRows(guildId, targetUser.id);
  } catch (err) {
    /* istanbul ignore next */ {
      console.error('moderation: Failed to fetch moderation history', { guildId, targetId: targetUser.id }, err);
      await interaction.editReply('Failed to fetch moderation history. Please try again later.');
    }
    return;
  }

  const targetLabel = targetUser.tag ?? targetUser.id;
  const message = buildHistoryContent({ targetLabel, rows, isAdministrator });
  await interaction.editReply(message.content);
}

async function handleWarn({ interaction, reason, reference, targetUser }) {
  if (!targetUser) {
    await respondEphemeral(interaction, 'Unable to warn that user; could not resolve their profile.');
    return;
  }

  await dmUser(targetUser, 'warning', reason, interaction.guild?.name);

  await logAction({
    guildId: interaction.guildId,
    action: 'warn',
    targetUser,
    moderator: interaction.user,
    reason,
    reference
  });

  await respondEphemeral(interaction, `Logged a warning for ${targetUser.tag}.`);
}

async function handleKick({ interaction, context, reason, reference, targetUser }) {
  const targetMember = context.targetMember;
  if (!targetMember) {
    await respondEphemeral(interaction, 'That user is no longer in the server.');
    return;
  }

  const botMember = interaction.guild.members.me;
  if (!botMember?.permissions?.has(PermissionFlagsBits.KickMembers)) {
    await respondEphemeral(interaction, 'I do not have permission to kick members. Update my role settings first.');
    return;
  }

  try {
    await targetMember.kick(reason);
    await dmUser(targetMember.user, 'kick', reason, interaction.guild?.name);
    await logAction({
      guildId: interaction.guildId,
      action: 'kick',
      targetUser: targetMember.user,
      moderator: interaction.user,
      reason,
      reference
    });
    await respondEphemeral(interaction, `Kicked ${targetMember.user.tag}.`);
  } catch (err) {
    console.error('moderation: Failed to kick user', { guildId: interaction.guildId, targetId: targetMember.id }, err);
    await respondEphemeral(interaction, 'Failed to kick that member. Check my permissions and try again.');
  }
}

async function handleBan({ interaction, context, reason, reference, targetUser }) {
  const targetMember = context.targetMember;
  const guild = interaction.guild;

  const botMember = guild.members.me;
  if (!botMember?.permissions?.has(PermissionFlagsBits.BanMembers)) {
    await respondEphemeral(interaction, 'I do not have permission to ban members. Update my role settings first.');
    return;
  }

  try {
    await guild.members.ban(targetUser.id, { reason });
    await dmUser(targetUser, 'ban', reason, interaction.guild?.name);
    await logAction({
      guildId: interaction.guildId,
      action: 'ban',
      targetUser,
      moderator: interaction.user,
      reason,
      reference
    });
    await respondEphemeral(interaction, `Banned ${targetUser.tag}.`);
  } catch (err) {
    console.error('moderation: Failed to ban user', { guildId: interaction.guildId, targetId: targetUser.id }, err);
    await respondEphemeral(interaction, 'Failed to ban that member. Check my permissions and try again.');
  }
}

async function handleModal(interaction) {
  const [prefix, action, targetId] = interaction.customId.split(':');
  if (prefix !== 'moderation' || (!ACTIONS[action] && action !== 'pardon') || !targetId) {
    return;
  }

  const reason = interaction.fields.getTextInputValue('reason')?.trim();

  if (!reason) {
    await respondEphemeral(interaction, 'A reason is required for this action.');
    return;
  }

  if (action === 'pardon') {
    const guild = interaction.guild;
    if (!guild) {
      await respondEphemeral(interaction, 'This moderation action must be used inside a guild.');
      return;
    }

    const member = interaction.member || (await guild.members.fetch(interaction.user.id).catch(() => null));
    if (!member?.permissions?.has?.(PermissionFlagsBits.Administrator)) {
      await respondEphemeral(interaction, 'You must be an administrator to pardon users.');
      return;
    }

    const targetUser =
      interaction.client.users.cache?.get(targetId) ||
      (await interaction.client.users.fetch(targetId).catch(() => null));

    if (!targetUser) {
      await respondEphemeral(interaction, 'Unable to resolve that user.');
      return;
    }

    await executePardon({
      interaction,
      targetUser,
      moderator: interaction.user,
      reason
    });

    await respondEphemeral(interaction, `Pardoned ${targetUser.tag ?? targetUser.id}. Prior moderation actions are now hidden from moderators.`);
    return;
  }

  const referenceInput = interaction.fields.getTextInputValue('reference');

  const context = await validateContext(interaction, action, targetId);
  if (!context) {
    return;
  }

  const reference = await fetchReferenceMessage(
    interaction.client,
    context.guild,
    parseReferenceInput(referenceInput)
  );

  const targetUser =
    context.targetMember?.user ||
    (await interaction.client.users.fetch(targetId).catch(() => null));

  if (!targetUser) {
    await respondEphemeral(interaction, 'Unable to resolve that user.');
    return;
  }

  const handlerMap = {
    warn: handleWarn,
    kick: handleKick,
    ban: handleBan
  };

  await handlerMap[action]({
    interaction,
    context,
    reason,
    reference,
    targetUser
  });
}

async function handleInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'mod') {
        await handleModCommand(interaction);
        return;
      }
    }

    if (interaction.isUserContextMenuCommand()) {
      if (interaction.commandName === ACTIONS.warn.label) {
        await handleActionRequest(interaction, 'warn');
        return;
      }

      if (interaction.commandName === ACTIONS.kick.label) {
        await handleActionRequest(interaction, 'kick');
        return;
      }

      if (interaction.commandName === ACTIONS.ban.label) {
        await handleActionRequest(interaction, 'ban');
        return;
      }

      if (interaction.commandName === PARDON_CONTEXT_LABEL) {
        await handlePardonContext(interaction);
        return;
      }

      if (interaction.commandName === HISTORY_CONTEXT_LABEL) {
        await handleHistoryContext(interaction);
        return;
      }
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('moderation:')) {
      await handleModal(interaction);
    }
  } catch (err) {
    /* istanbul ignore next */ console.error('moderation: Interaction handler failed', err);
    if (interaction.isRepliable()) {
      await respondEphemeral(interaction, 'An error occurred while processing that moderation action.');
    }
  }
}

/* istanbul ignore next */
async function initialize(client) {
  if (initialized) {
    return;
  }

  clientRef = client;
  const pool = getPool();
  await ensureSchema(pool);
  await loadRoleCache(pool);

  client.on(Events.InteractionCreate, interaction => {
    handleInteraction(interaction).catch(err => {
      console.error('moderation: Unhandled interaction error', err);
    });
  });

  initialized = true;
}

/* istanbul ignore next */
async function onReady(client) {
  if (!initialized) {
    await initialize(client);
  }

  clientRef = client;
}

module.exports = {
  getSlashCommandDefinitions,
  initialize,
  onReady,
  __testables: {
    ACTIONS,
    roleCache,
    addRoleToCache,
    removeRoleFromCache,
    memberHasRole,
    hasActionPermission,
    hasHistoryPermission,
    filterEntriesForModerators,
    buildHistoryLines,
    buildHistoryContent,
    fetchHistoryRows,
    buildRoleList,
    parseReferenceInput,
    fetchReferenceMessage,
    handleModCommand,
    handleActionRequest,
    handleInteraction,
    handleHistoryContext,
    handlePardonContext,
    handleModal,
    logAction
  }
};
