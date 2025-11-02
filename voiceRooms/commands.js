const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');

function buildCommand() {
  return new SlashCommandBuilder()
    .setName('voice-rooms')
    .setDescription('Manage dynamic voice room templates for this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand(sub =>
      sub
        .setName('set-template')
        .setDescription('Designate a lobby voice channel that spawns personal rooms.')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('The lobby voice channel members will join to create a room.')
            .addChannelTypes(ChannelType.GuildVoice)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('clear-template')
        .setDescription('Remove a lobby channel from the dynamic voice room list.')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Lobby channel to remove.')
            .addChannelTypes(ChannelType.GuildVoice)
            .setRequired(true)
        )
    );
}

function getSlashCommandDefinitions() {
  return {
    global: [],
    guild: [buildCommand()]
  };
}

module.exports = {
  getSlashCommandDefinitions
};
