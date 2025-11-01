const { getSlashCommandDefinitions } = require('./commands');
const { handleInteraction } = require('./handlers/interaction');
const { registerTemplateListener } = require('./handlers/template');

let initialized = false;
let listener = null;

async function initialize(client) {
  if (initialized) {
    return;
  }

  if (client && !listener) {
    listener = registerTemplateListener(client);
  }

  initialized = true;
}

async function onReady(client) {
  if (!initialized) {
    await initialize(client);
  }
}

module.exports = {
  getSlashCommandDefinitions,
  initialize,
  onReady,
  handleInteraction,
  __testables: {
    reset() {
      initialized = false;
      listener = null;
    }
  }
};
