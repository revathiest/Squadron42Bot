const { getPool } = require('../database');
const { ACTIONS, PARDON_COMMAND_NAME, PARDON_COMMAND_DESCRIPTION, HISTORY_CONTEXT_LABEL } = require('./constants');
const { respondEphemeral, parseReferenceInput, fetchReferenceMessage, toTimestamp, formatTimestamp, formatReason } = require('./utils');
const { ensureSchema, loadRoleCache } = require('./schema');
const { getSlashCommandDefinitions } = require('./commands');
const autoBanTrap = require('./autoBanTrap');
const roles = require('./handlers/roles');
const actions = require('./handlers/actions');
const modals = require('./handlers/modal');
const history = require('./handlers/history');
const { handleInteraction } = require('./handlers/interaction');

let initialized = false;
let clientRef;

async function initialize(client) {
  if (initialized) {
    return;
  }

  clientRef = client;
  const pool = getPool();
  await ensureSchema(pool);
  await loadRoleCache(pool);

  autoBanTrap.registerAutoBanTrap(client);

  initialized = true;
}

async function onReady(client) {
  if (!initialized) {
    await initialize(client);
  }

  clientRef = client;
}

module.exports = {
  getSlashCommandDefinitions,
  initialize,
  onReady,
  handleInteraction,
  __testables: {
    ACTIONS,
    PARDON_COMMAND_NAME,
    PARDON_COMMAND_DESCRIPTION,
    HISTORY_CONTEXT_LABEL,
    roleCache: roles.roleCache,
    addRoleToCache: roles.addRoleToCache,
    removeRoleFromCache: roles.removeRoleFromCache,
    memberHasRole: roles.memberHasRole,
    hasActionPermission: roles.hasActionPermission,
    buildRoleList: roles.buildRoleList,
    buildRoleChoices: roles.buildRoleChoices,
    parseReferenceInput,
    fetchReferenceMessage,
    respondEphemeral,
    toTimestamp,
    formatTimestamp,
    formatReason,
    handleModCommand: roles.handleModCommand,
    handleActionRequest: modals.handleActionRequest,
    handlePardonCommand: modals.handlePardonCommand,
    handleModal: modals.handleModal,
    handleInteraction,
    handleHistoryContext: history.handleHistoryContext,
    handleAutoBanRoleUpdate: autoBanTrap.handleGuildMemberUpdate,
    handleTrapConfigCommand: autoBanTrap.handleTrapConfigCommand,
    fetchTrapRoleId: autoBanTrap.fetchTrapRoleId,
    isTrapRoleNewlyAssigned: autoBanTrap.isTrapRoleNewlyAssigned,
    buildSyntheticTrapInteraction: autoBanTrap.buildSyntheticInteraction,
    logAction: actions.logAction,
    hasHistoryPermission: history.hasHistoryPermission,
    filterEntriesForModerators: history.filterEntriesForModerators,
    buildHistoryLines: history.buildHistoryLines,
    buildHistoryContent: history.buildHistoryContent,
    fetchHistoryRows: history.fetchHistoryRows,
    handleWarn: actions.handleWarn,
    handleKick: actions.handleKick,
    handleBan: actions.handleBan,
    handleTimeout: actions.handleTimeout,
    executePardon: actions.executePardon
  }
};
