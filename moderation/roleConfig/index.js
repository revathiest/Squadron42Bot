const { MessageFlags } = require('discord.js');
const { getPool } = require('../../database');
const { ACTIONS } = require('../constants');
const { handleTrapConfigCommand } = require('../autoBanTrap');
const {
  roleCache,
  addRoleToCache,
  removeRoleFromCache
} = require('../roleCache');
const { respondEphemeral } = require('../utils');

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
    return handleTrapConfigCommand(interaction);
  }

  return respondEphemeral(interaction, 'Unsupported moderation command.');
}

module.exports = {
  buildRoleList,
  buildRoleChoices,
  handleModCommand,
  handleRoleAdd,
  handleRoleRemove,
  handleRoleList
};

