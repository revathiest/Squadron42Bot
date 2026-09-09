const {
  SlashCommandBuilder,
  ChannelType
} = require('discord.js');

function buildSlashCommandDefinition() {
  const builder = new SlashCommandBuilder()
    .setName('mod')
    .setDescription('Manage moderation settings.')
    .setDMPermission(false)
    .addSubcommandGroup(group =>
      group
        .setName('auto-ban')
        .setDescription('Configure the trap role that triggers an automatic ban when assigned.')
        .addSubcommand(sub =>
          sub
            .setName('set')
            .setDescription('Set the trap role.')
            .addRoleOption(option =>
              option
                .setName('role')
                .setDescription('Role that should trigger an automatic ban when assigned.')
                .setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('clear')
            .setDescription('Clear the configured trap role.')
        )
    );

  builder.addSubcommandGroup(group =>
    group
      .setName('org-promos')
      .setDescription('Manage which forum channels allow organization promotions.')
      .addSubcommand(sub =>
        sub
          .setName('add')
          .setDescription('Allow promotion threads in a forum channel.')
          .addChannelOption(option =>
            option
              .setName('channel')
              .setDescription('Forum channel where organization promotions are allowed.')
              .addChannelTypes(ChannelType.GuildForum)
              .setRequired(true)
          )
      )
      .addSubcommand(sub =>
        sub
          .setName('remove')
          .setDescription('Stop allowing promotions in a forum channel.')
          .addChannelOption(option =>
            option
              .setName('channel')
              .setDescription('Forum channel to remove.')
              .addChannelTypes(ChannelType.GuildForum)
              .setRequired(true)
          )
      )
  );

  return builder.toJSON();
}

function getSlashCommandDefinitions() {
  return {
    guild: [
      buildSlashCommandDefinition()
    ],
    global: []
  };
}

module.exports = {
  getSlashCommandDefinitions,
  buildSlashCommandDefinition
};

