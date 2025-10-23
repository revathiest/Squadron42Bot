const {
  SlashCommandBuilder,
  ContextMenuCommandBuilder,
  ApplicationCommandType
} = require('discord.js');
const { ACTIONS, PARDON_CONTEXT_LABEL, HISTORY_CONTEXT_LABEL } = require('./constants');
const { buildRoleChoices } = require('./roleConfig');

function buildSlashCommandDefinition() {
  const builder = new SlashCommandBuilder()
    .setName('mod')
    .setDescription('Manage moderation roles for context actions.')
    .setDMPermission(false)
    .addSubcommandGroup(group =>
      group
        .setName('roles')
        .setDescription('Manage which roles can warn, kick, or ban.')
        .addSubcommand(sub =>
          buildRoleChoices(
            sub
              .setName('add')
              .setDescription('Allow a role to use a moderation action.')
          )
        )
        .addSubcommand(sub =>
          buildRoleChoices(
            sub
              .setName('remove')
              .setDescription('Remove a role from a moderation action.')
          )
        )
        .addSubcommand(sub =>
          sub
            .setName('list')
            .setDescription('List configured moderation roles.')
        )
    )
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
        .addSubcommand(sub =>
          sub
            .setName('status')
            .setDescription('Show the configured trap role.')
        )
    );

  return builder.toJSON();
}

function buildActionContextCommand(action) {
  return new ContextMenuCommandBuilder()
    .setName(ACTIONS[action].label)
    .setType(ApplicationCommandType.User)
    .setDMPermission(false)
    .toJSON();
}

function buildPardonContextCommand() {
  return new ContextMenuCommandBuilder()
    .setName(PARDON_CONTEXT_LABEL)
    .setType(ApplicationCommandType.User)
    .setDMPermission(false)
    .toJSON();
}

function buildHistoryContextCommand() {
  return new ContextMenuCommandBuilder()
    .setName(HISTORY_CONTEXT_LABEL)
    .setType(ApplicationCommandType.User)
    .setDMPermission(false)
    .toJSON();
}

function getSlashCommandDefinitions() {
  return {
    guild: [
      buildSlashCommandDefinition(),
      buildActionContextCommand('warn'),
      buildActionContextCommand('kick'),
      buildActionContextCommand('ban'),
      buildPardonContextCommand(),
      buildHistoryContextCommand()
    ],
    global: []
  };
}

module.exports = {
  getSlashCommandDefinitions,
  buildSlashCommandDefinition,
  buildActionContextCommand,
  buildPardonContextCommand,
  buildHistoryContextCommand
};

