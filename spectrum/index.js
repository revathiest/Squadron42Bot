const commands = require('./commands');
const watcher = require('./watcher/service');
const spectrumConfig = require('./config');

async function initialize(client) {
  await spectrumConfig.initialize(client);
  await watcher.initialize(client);
}

async function onReady(client) {
  await spectrumConfig.onReady(client);
  await watcher.onReady(client);
}

function getSlashCommandDefinitions() {
  return commands.getSlashCommandDefinitions();
}

async function handleInteraction(interaction) {
  return watcher.handleInteraction(interaction);
}

module.exports = {
  initialize,
  onReady,
  getSlashCommandDefinitions,
  handleInteraction,
  postLatestThreadForGuild: watcher.postLatestThreadForGuild,
  getLatestThreadSnapshot: watcher.getLatestThreadSnapshot,
  checkForNewThreads: watcher.checkForNewThreads
};

