const { MessageFlags } = require('discord.js');
const { getPool } = require('../../database');
const { ACTIONS } = require('../constants');
const { respondEphemeral } = require('../utils');
const { handleOrgPromoCommand } = require('./promoChannels');

const roleCache = new Map(); // guildId -> Map(action -> Set(roleId))

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
  if (!member) {
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
    lines.push(`- **${ACTIONS[action].label}** -> ${mentions}`);
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
    console.error('moderation: Failed to remove moderation role', { guildId, action, roleId: role.id }, err);
    await interaction.editReply('Failed to remove the moderation role. Please try again later.');
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
    console.error('moderation: Failed to return moderation role list', { guildId: interaction.guildId }, err);
    await interaction.editReply('Failed to fetch moderation roles.');
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

  if (group === 'auto-ban') {
    const { handleTrapConfigCommand } = require('../autoBanTrap');
    return handleTrapConfigCommand(interaction);
  }

  if (group === 'org-promos') {
    return handleOrgPromoCommand(interaction);
  }

  return respondEphemeral(interaction, 'Unsupported moderation command.');
}

module.exports = {
  roleCache,
  addRoleToCache,
  removeRoleFromCache,
  getActionRoles,
  memberHasRole,
  hasActionPermission,
  buildRoleList,
  buildRoleChoices,
  handleRoleAdd,
  handleRoleRemove,
  handleRoleList,
  handleModCommand
};
