const {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

function buildCommandDefinition() {
  return new SlashCommandBuilder()
    .setName('spectrum')
    .setDescription('Configure Spectrum Watcher announcements for this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand(sub =>
      sub
        .setName('set-channel')
        .setDescription('Select the channel where new Spectrum threads will be announced.')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Announcement channel')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement
            )
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('set-forum')
        .setDescription('Configure which RSI Spectrum forum to watch.')
        .addStringOption(option =>
          option
            .setName('forum_id')
            .setDescription('Forum ID from Spectrum (e.g. 123456)')
            .setMinLength(1)
            .setMaxLength(32)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Show the current Spectrum Watcher configuration.')
    )
    .addSubcommand(sub =>
      sub
        .setName('clear')
        .setDescription('Remove Spectrum Watcher configuration for this server.')
    )
    .addSubcommand(sub =>
      sub
        .setName('post-latest')
        .setDescription('Immediately post the latest Spectrum thread to the configured channel.')
    );
}

function getSlashCommandDefinitions() {
  return {
    global: [],
    guild: [buildCommandDefinition()]
  };
}

module.exports = {
  getSlashCommandDefinitions,
  buildCommandDefinition
};
