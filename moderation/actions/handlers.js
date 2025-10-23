const { PermissionFlagsBits } = require('discord.js');
const { getPool } = require('../../database');
const { respondEphemeral } = require('../utils');

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
    // ignore DM failures
  }
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
  const guild = interaction.guild;
  const botMember = guild.members.me;


  if (!botMember?.permissions?.has(PermissionFlagsBits.BanMembers)) {
    console.log('Missing BanMembers permission.');
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
    console.log(`Banned ${targetUser.tag}. Assigned a honey trap role.`);
  } catch (err) {
    console.error('moderation: Failed to ban user', { guildId: interaction.guildId, targetId: targetUser.id }, err);
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

module.exports = {
  logAction,
  dmUser,
  handleWarn,
  handleKick,
  handleBan,
  executePardon
};
