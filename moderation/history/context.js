const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { respondEphemeral } = require('../utils');
const {
  hasHistoryPermission,
  fetchHistoryRows,
  buildHistoryContent
} = require('./view');

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
    console.error('moderation: Failed to fetch moderation history', { guildId, targetId: targetUser.id }, err);
    await interaction.editReply('Failed to fetch moderation history. Please try again later.');
    return;
  }

  const targetLabel = targetUser.tag ?? targetUser.id;
  const message = buildHistoryContent({ targetLabel, rows, isAdministrator });
  await interaction.editReply(message.content);
}

module.exports = {
  handleHistoryContext
};
