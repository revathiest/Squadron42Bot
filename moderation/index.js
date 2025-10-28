const { getPool } = require('../database');
const { ACTIONS, PARDON_COMMAND_NAME, PARDON_COMMAND_DESCRIPTION, HISTORY_CONTEXT_LABEL } = require('./constants');
const { respondEphemeral, parseReferenceInput, fetchReferenceMessage, toTimestamp, formatTimestamp, formatReason } = require('./utils');
const { roleCache, addRoleToCache, removeRoleFromCache, memberHasRole, hasActionPermission } = require('./roleCache');
const { ensureSchema, loadRoleCache } = require('./schema');
const { getSlashCommandDefinitions } = require('./commands');
const roleConfig = require('./roleConfig');
const autoBanTrap = require('./autoBanTrap');
const actionsContext = require('./actions/context');
const actionsModals = require('./actions/modals');
const actionHandlers = require('./actions/handlers');
const historyView = require('./history/view');
const historyContext = require('./history/context');
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
    roleCache,
    addRoleToCache,
    removeRoleFromCache,
    memberHasRole,
    hasActionPermission,
    buildRoleList: roleConfig.buildRoleList,
    buildRoleChoices: roleConfig.buildRoleChoices,
    parseReferenceInput,
    fetchReferenceMessage,
    respondEphemeral,
    toTimestamp,
    formatTimestamp,
    formatReason,
    handleModCommand: roleConfig.handleModCommand,
    handleActionRequest: actionsContext.handleActionRequest,
    handlePardonCommand: actionsContext.handlePardonCommand,
    handleModal: actionsModals.handleModal,
    handleInteraction,
    handleHistoryContext: historyContext.handleHistoryContext,
    handleAutoBanRoleUpdate: autoBanTrap.handleGuildMemberUpdate,
    handleTrapConfigCommand: autoBanTrap.handleTrapConfigCommand,
    fetchTrapRoleId: autoBanTrap.fetchTrapRoleId,
    isTrapRoleNewlyAssigned: autoBanTrap.isTrapRoleNewlyAssigned,
    buildSyntheticTrapInteraction: autoBanTrap.buildSyntheticInteraction,
    logAction: actionHandlers.logAction,
    hasHistoryPermission: historyView.hasHistoryPermission,
    filterEntriesForModerators: historyView.filterEntriesForModerators,
    buildHistoryLines: historyView.buildHistoryLines,
    buildHistoryContent: historyView.buildHistoryContent,
    fetchHistoryRows: historyView.fetchHistoryRows,
    handleWarn: actionHandlers.handleWarn,
    handleKick: actionHandlers.handleKick,
    handleBan: actionHandlers.handleBan,
    handleTimeout: actionHandlers.handleTimeout,
    executePardon: actionHandlers.executePardon
  }
};
