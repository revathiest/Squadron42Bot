// spectrum/config.js
// Entry point coordinating Spectrum configuration persistence and command handling.

const { getPool } = require('../database');
const commands = require('./commands');
const store = require('./utils');
const handlers = require('./handlers/interaction');

let initialized = false;

async function initialize(client) {
  if (initialized) {
    return;
  }

  const pool = getPool();
  await store.ensureSchema(pool);
  await store.loadCache(pool);

  initialized = true;
}

async function onReady(client) {
  if (!initialized) {
    await initialize(client);
  }
}

function getSlashCommandDefinitions() {
  return commands.getSlashCommandDefinitions();
}

module.exports = {
  getSlashCommandDefinitions,
  initialize,
  onReady,
  handleInteraction: handlers.handleInteraction,
  fetchConfig: store.fetchConfig,
  setConfig: store.setConfig,
  clearConfig: store.clearConfig,
  getConfigsSnapshot: store.getConfigsSnapshot,
  handleSpectrumCommand: handlers.handleSpectrumCommand,
  __testables: {
    ensureSchema: store.ensureSchema,
    loadCache: store.loadCache,
    configCache: store.configCache
  }
};
