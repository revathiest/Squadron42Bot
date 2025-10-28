const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');

function buildTicketCommand() {
  return new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Configure and manage the ticket system.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand(sub =>
      sub
        .setName('set-channel')
        .setDescription('Designate the ticket lobby channel (only one per guild).')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Channel where users can create tickets.')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
        .addChannelOption(option =>
          option
            .setName('archive_category')
            .setDescription('Category where closed tickets are moved.')
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('set-archive')
        .setDescription('Update the archive category for closed tickets.')
        .addChannelOption(option =>
          option
            .setName('category')
            .setDescription('Archive category for closed tickets.')
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true)
        )
    )
    .addSubcommandGroup(group =>
      group
        .setName('roles')
        .setDescription('Manage moderator roles for the ticket system.')
        .addSubcommand(sub =>
          sub
            .setName('add')
            .setDescription('Add a role that can manage tickets.')
            .addRoleOption(option =>
              option
                .setName('role')
                .setDescription('Role that can manage tickets.')
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('remove')
            .setDescription('Remove a moderator role from the ticket system.')
            .addRoleOption(option =>
              option
                .setName('role')
                .setDescription('Role to remove from ticket moderators.')
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('list')
            .setDescription('List current moderator roles for tickets.')
        )
    );
}

function getSlashCommandDefinitions() {
  return {
    global: [],
    guild: [buildTicketCommand()]
  };
}

module.exports = {
  getSlashCommandDefinitions
};
