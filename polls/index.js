const commands = require('./commands');
const { ensureSchema } = require('./schema');
const { loadRoleCache } = require('./utils');
const { handleCreateCommand, handleControlButton, handleModalSubmission, handleSelectMenu } = require('./handlers/create');
const { handleAccessCommand } = require('./handlers/access');
const { handleVote } = require('./handlers/vote');
const { handleCloseButton } = require('./handlers/manage');
const { processExpiredPolls, startScheduler } = require('./scheduler');

let initialized = false;

async function initialize(client) {
  if (initialized) {
    return;
  }

  await ensureSchema();
  await loadRoleCache();
  startScheduler(client);
  initialized = true;
}

async function onReady(client) {
  await processExpiredPolls(client).catch(err => {
    console.error('[polls] Failed to process overdue polls on ready:', err);
  });
}

function getSlashCommandDefinitions() {
  return commands.getSlashCommandDefinitions();
}

async function handleInteraction(interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === 'poll') {
    if (interaction.options.getSubcommandGroup(false) === 'access') {
      return handleAccessCommand(interaction);
    }

    if (interaction.options.getSubcommand() === 'create') {
      return handleCreateCommand(interaction);
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith('polls:ctrl:')) {
      return handleControlButton(interaction);
    }
    if (interaction.customId.startsWith('polls:close:')) {
      return handleCloseButton(interaction);
    }
    if (interaction.customId.startsWith('polls:vote:')) {
      return handleVote(interaction);
    }
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('polls:modal:')) {
    return handleModalSubmission(interaction);
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('polls:select:')) {
    return handleSelectMenu(interaction);
  }

  return false;
}

module.exports = {
  initialize,
  onReady,
  getSlashCommandDefinitions,
  handleInteraction
};
