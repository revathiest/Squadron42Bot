const commands = require('./commands');
const { showConfigStatus } = require('./handlers/showStatus');
const { getModuleName } = require('./utils');

async function initialize() {
  // No schema to prepare for this module
}

async function onReady() {
  // Nothing to do post-login for now
}

function getSlashCommandDefinitions() {
  return commands.getSlashCommandDefinitions();
}

async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) {
    return false;
  }

  if (interaction.commandName !== 'config-status') {
    return false;
  }

  await showConfigStatus(interaction);
  return true;
}

module.exports = {
  initialize,
  onReady,
  getSlashCommandDefinitions,
  handleInteraction,
  getModuleName
};
