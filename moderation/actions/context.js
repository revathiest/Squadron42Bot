const { PermissionFlagsBits } = require('discord.js');
const { ACTIONS } = require('../constants');
const { respondEphemeral } = require('../utils');
const { buildReasonModal, buildPardonModal } = require('./modals');
const { hasActionPermission } = require('../roleCache');

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
    console.error('moderation: Failed to show pardon modal', { guildId, targetId: targetUser.id }, err);
    await respondEphemeral(interaction, 'Unable to open the pardon dialog. Please try again later.');
  }
}

module.exports = {
  handleActionRequest,
  handlePardonContext
};
