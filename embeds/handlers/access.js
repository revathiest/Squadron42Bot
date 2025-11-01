const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const {
  allowRoleForGuild,
  removeRoleForGuild,
  listAllowedRoles
} = require('../utils');

async function handleAccessCommand(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: '❌ You need the **Administrator** permission to update embed access.',
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
    return true;
  }

  const subcommand = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.reply({
      content: '❌ This command can only be used inside a server.',
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

  if (subcommand === 'add') {
    const role = interaction.options.getRole('role', true);
    const added = await allowRoleForGuild(guildId, role.id, interaction.user.id);
    if (!added) {
      await interaction.editReply({
        content: `${role} is already allowed to upload embed templates.`
      }).catch(() => {});
    } else {
      await interaction.editReply({
        content: `✅ ${role} can now upload embed templates.`
      }).catch(() => {});
    }
    return true;
  }

  if (subcommand === 'remove') {
    const role = interaction.options.getRole('role', true);
    const removed = await removeRoleForGuild(guildId, role.id);
    if (!removed) {
      await interaction.editReply({
        content: `${role} was not on the embed template allow list.`
      }).catch(() => {});
    } else {
      await interaction.editReply({
        content: `✅ ${role} can no longer upload embed templates.`
      }).catch(() => {});
    }
    return true;
  }

  if (subcommand === 'list') {
    const roles = listAllowedRoles(guildId);
    if (!roles.length) {
      await interaction.editReply({
        content: 'No roles are currently allowed to upload embed templates.'
      }).catch(() => {});
      return true;
    }

    const mentions = roles.map(roleId => `<@&${roleId}>`).join('\n');
    await interaction.editReply({
      content: `Roles allowed to upload embed templates:\n${mentions}`
    }).catch(() => {});
    return true;
  }

  await interaction.editReply({
    content: '⚠️ Unknown subcommand.'
  }).catch(() => {});
  return true;
}

module.exports = {
  handleAccessCommand
};
