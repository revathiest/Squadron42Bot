const { SlashCommandBuilder } = require('discord.js');

function buildAccessCommand() {
  return new SlashCommandBuilder()
    .setName('embed-access')
    .setDescription('Manage which roles can upload embed templates.')
    .setDMPermission(false)
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Allow a role to upload embed templates.')
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('Role that should be allowed to upload embed templates.')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Remove a role from the upload allow list.')
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('Role to remove from the embed template allow list.')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('List roles that are allowed to upload embed templates.')
    );
}

function getSlashCommandDefinitions() {
  return {
    guild: [buildAccessCommand()],
    global: []
  };
}

module.exports = {
  getSlashCommandDefinitions
};
