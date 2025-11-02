const { Events, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getPool } = require('../database');
const { memberHasRole } = require('./handlers/roles');
const { handleBan } = require('./handlers/actions');

const TRAP_REASON = 'Assigned the configured moderation trap role.';

async function fetchTrapRoleId(guildId) {
  if (!guildId) {
    return null;
  }

  try {
    const pool = getPool();
    const [rows] = await pool.query(
      'SELECT trap_role_id FROM moderation_config WHERE guild_id = ? LIMIT 1',
      [guildId]
    );

    const roleId = rows?.[0]?.trap_role_id;
    return typeof roleId === 'string' && roleId.length > 0 ? roleId : null;
  } catch (err) {
    console.error('autoBanTrap: failed to load trap role', { guildId }, err);
    return null;
  }
}

async function setTrapRoleId(guildId, roleId, updatedBy) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO moderation_config (guild_id, trap_role_id, updated_by)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE trap_role_id = VALUES(trap_role_id), updated_by = VALUES(updated_by)`,
    [guildId, roleId, updatedBy ?? null]
  );
}

async function clearTrapRoleId(guildId, updatedBy) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO moderation_config (guild_id, trap_role_id, updated_by)
     VALUES (?, NULL, ?)
     ON DUPLICATE KEY UPDATE trap_role_id = VALUES(trap_role_id), updated_by = VALUES(updated_by)`,
    [guildId, updatedBy ?? null]
  );
}

async function handleTrapConfigCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch {
    return;
  }

  if (subcommand === 'set') {
    const role = interaction.options.getRole('role', true);
    try {
      await setTrapRoleId(guildId, role.id, interaction.user?.id);
      await interaction.editReply(`Marked ${role.toString()} as the trap role.`);
    } catch (err) {
      console.error('autoBanTrap: failed to set trap role', { guildId, roleId: role.id }, err);
      await interaction.editReply('Failed to update the trap role. Please try again later.');
    }
    return;
  }

  if (subcommand === 'clear') {
    try {
      await clearTrapRoleId(guildId, interaction.user?.id);
      await interaction.editReply('Cleared the configured trap role.');
    } catch (err) {
      console.error('autoBanTrap: failed to clear trap role', { guildId }, err);
      await interaction.editReply('Failed to clear the trap role. Please try again later.');
    }
    return;
  }

  await interaction.editReply('Unsupported trap role command.');
}

function isTrapRoleNewlyAssigned(oldMember, newMember, trapRoleId) {
  if (!trapRoleId) {
    return false;
  }

  if (!memberHasRole(newMember, trapRoleId)) {
    return false;
  }

  return !memberHasRole(oldMember, trapRoleId);
}

function buildSyntheticInteraction(guild, botUser) {
  return {
    guild,
    guildId: guild.id,
    user: botUser ?? { id: guild.members?.me?.id ?? null, tag: guild.members?.me?.user?.tag ?? null },
    deferred: true,
    replied: true,
    editReply: () => Promise.resolve(),
    reply: () => Promise.resolve(),
    followUp: () => Promise.resolve()
  };
}

async function handleGuildMemberUpdate(oldMember, newMember, client) {
  const guild = newMember?.guild;
  if (!guild || !newMember?.user) {
    return;
  }

  const guildId = guild.id;
  const trapRoleId = await fetchTrapRoleId(guildId);
  if (!trapRoleId) {
    return;
  }

  if (!isTrapRoleNewlyAssigned(oldMember, newMember, trapRoleId)) {
    return;
  }

  const botMember = guild.members?.me;
  if (!botMember?.permissions?.has?.(PermissionFlagsBits.BanMembers)) {
    console.warn('autoBanTrap: missing BanMembers permission', { guildId, trapRoleId });
    return;
  }

  const botHighest = botMember.roles?.highest;
  const targetHighest = newMember.roles?.highest;
  if (
    botHighest?.comparePositionTo &&
    targetHighest &&
    botHighest.comparePositionTo(targetHighest) <= 0
  ) {
    console.warn('autoBanTrap: role hierarchy prevents ban', { guildId, trapRoleId });
    return;
  }

  const targetUser = newMember.user;
  const interaction = buildSyntheticInteraction(guild, client?.user);

  try {
    await handleBan({
      interaction,
      context: {},
      reason: TRAP_REASON,
      reference: null,
      targetUser
    });
  } catch (err) {
    console.error('autoBanTrap: failed to execute trap ban', { guildId, userId: targetUser.id }, err);
  }
}

function registerAutoBanTrap(client) {
  client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
    handleGuildMemberUpdate(oldMember, newMember, client).catch(err => {
      console.error('autoBanTrap: listener error', {
        guildId: newMember?.guild?.id,
        userId: newMember?.id
      }, err);
    });
  });
}

module.exports = {
  registerAutoBanTrap,
  handleGuildMemberUpdate,
  fetchTrapRoleId,
  isTrapRoleNewlyAssigned,
  buildSyntheticInteraction,
  setTrapRoleId,
  clearTrapRoleId,
  handleTrapConfigCommand
};
