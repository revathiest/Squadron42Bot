const commands = require('./commands');
const watcher = require('./watcher/service');
const { handleInteraction } = require('./handlers/interaction');

async function initialize(client) {
  await watcher.initialize(client);
}

async function onReady(client) {
  await watcher.onReady(client);
}

function getSlashCommandDefinitions() {
  return commands.getSlashCommandDefinitions();
}

module.exports = {
  initialize,
  onReady,
  getSlashCommandDefinitions,
  handleInteraction,
};
