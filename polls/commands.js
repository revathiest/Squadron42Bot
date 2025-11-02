const { SlashCommandBuilder } = require('discord.js');

function getSlashCommandDefinitions() {
  const builder = new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create and manage interactive polls.')
    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('Start the guided poll creator.'))
    .addSubcommandGroup(group =>
      group
        .setName('access')
        .setDescription('Manage which roles may create polls.')
        .addSubcommand(sub =>
          sub
            .setName('add')
            .setDescription('Allow a role to create polls.')
            .addRoleOption(opt =>
              opt
                .setName('role')
                .setDescription('Role that should be allowed to create polls.')
                .setRequired(true)))
        .addSubcommand(sub =>
          sub
            .setName('remove')
            .setDescription('Remove a role from the allow list.')
            .addRoleOption(opt =>
              opt
                .setName('role')
                .setDescription('Role to remove from the allow list.')
                .setRequired(true))));

  return {
    global: [],
    guild: [builder]
  };
}

module.exports = {
  getSlashCommandDefinitions
};
