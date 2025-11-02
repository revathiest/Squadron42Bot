const { MessageFlags, allowRoleForGuild, removeRoleForGuild } = require('../utils');
const { PermissionFlagsBits } = require('discord.js');

async function handleAccessCommand(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: 'You need the **Manage Server** permission to change poll access.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const subcommand = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (subcommand === 'add') {
    const role = interaction.options.getRole('role', true);
    const added = await allowRoleForGuild(guildId, role.id, interaction.user.id);
    await interaction.reply({
      content: added
        ? `✅ ${role} can now create polls.`
        : `${role} is already allowed to create polls.`,
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (subcommand === 'remove') {
    const role = interaction.options.getRole('role', true);
    const removed = await removeRoleForGuild(guildId, role.id);
    await interaction.reply({
      content: removed
        ? `✅ ${role} can no longer create polls.`
        : `${role} was not on the poll creator allow list.`,
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  return false;
}

module.exports = {
  handleAccessCommand
};
