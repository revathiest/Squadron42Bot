const commands = require('./commands');
const core = require('./core');
const { handleInteraction } = require('./handlers/interaction');

async function initialize(client) {
  await core.initialize(client);
}

async function onReady(client) {
  await core.onReady(client);
}

function getSlashCommandDefinitions() {
  return commands.getSlashCommandDefinitions();
}

module.exports = {
  initialize,
  onReady,
  getSlashCommandDefinitions,
  handleInteraction,
  __testables: {
    handleInteraction: core.handleInteraction,
    addTemplateToCache: core.addTemplateToCache,
    removeTemplateFromCache: core.removeTemplateFromCache,
    addTemporaryChannelToCache: core.addTemporaryChannelToCache,
    removeTemporaryChannelFromCache: core.removeTemporaryChannelFromCache,
    isTemplateChannel: core.isTemplateChannel,
    onVoiceStateUpdate: core.onVoiceStateUpdate,
    templateCache: core.templateCache,
    tempChannelCache: core.tempChannelCache
  }
};
