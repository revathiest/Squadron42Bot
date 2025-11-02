const { PermissionsBitField } = require('discord.js');
const {
  handleStatsCommand,
  handleLeaderboardCommand,
  handleSetPointsCommand,
  handleSetCooldownCommand,
  handleSetAnnouncementChannelCommand,
  handleToggleAnnouncementsCommand,
  handleToggleDmCommand,
  handleLevelSetCommand,
  handleLevelRemoveCommand,
  handleLevelListCommand
} = require('./commandHandlers');

function isAdmin(interaction) {
  if (!interaction.guild || !interaction.member) {
    return false;
  }

  try {
    return interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild);
  } catch {
    return false;
  }
}

async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'engagement') {
    return false;
  }

  const subcommandGroup = interaction.options.getSubcommandGroup(false);

  if (subcommandGroup === 'configure') {
    if (!isAdmin(interaction)) {
      await interaction.reply({
        content: 'You need the **Manage Server** permission to configure engagement settings.',
        ephemeral: true
      });
      return true;
    }

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'set-points':
        await handleSetPointsCommand(interaction);
        return true;
      case 'set-cooldown':
        await handleSetCooldownCommand(interaction);
        return true;
      case 'set-announcement-channel':
        await handleSetAnnouncementChannelCommand(interaction);
        return true;
      case 'toggle-announcements':
        await handleToggleAnnouncementsCommand(interaction);
        return true;
      case 'toggle-dm':
        await handleToggleDmCommand(interaction);
        return true;
      case 'level-set':
        await handleLevelSetCommand(interaction);
        return true;
      case 'level-remove':
        await handleLevelRemoveCommand(interaction);
        return true;
      case 'level-list':
        await handleLevelListCommand(interaction);
        return true;
      default:
        return false;
    }
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'stats':
      await handleStatsCommand(interaction);
      return true;
    case 'leaderboard':
      await handleLeaderboardCommand(interaction);
      return true;
    default:
      return false;
  }
}

module.exports = {
  handleInteraction
};
