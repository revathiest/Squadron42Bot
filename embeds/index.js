const { getSlashCommandDefinitions } = require('./commands');
const { handleInteraction } = require('./handlers/interaction');
const { registerTemplateListener } = require('./handlers/template');
const { ensureSchema, loadRoleCache, clearRoleCache } = require('./utils');

let initialized = false;
let listener = null;

async function initialize(client) {
  if (initialized) {
    return;
  }

  await ensureSchema();
  await loadRoleCache();

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
      clearRoleCache();
    }
  }
};
