const { Events } = require('discord.js');
const { getPool } = require('../database');
const { ACTIONS, PARDON_COMMAND_NAME, PARDON_COMMAND_DESCRIPTION, HISTORY_CONTEXT_LABEL } = require('./constants');
const {
  respondEphemeral,
  parseReferenceInput,
  fetchReferenceMessage,
  toTimestamp,
  formatTimestamp,
  formatReason,
  ensureSchema,
  loadRoleCache
} = require('./utils');
const { getSlashCommandDefinitions } = require('./commands');
const autoBanTrap = require('./autoBanTrap');
const roles = require('./handlers/roles');
const actions = require('./handlers/actions');
const modals = require('./handlers/modal');
const history = require('./handlers/history');
const { handleInteraction } = require('./handlers/interaction');
const { handleMessageCreate: handleOrgLinkMessage } = require('./handlers/orgLinks');

let initialized = false;
let clientRef;
let messageListenerBound = false;

async function initialize(client) {
  if (initialized) {
    return;
  }

  clientRef = client;
  const pool = getPool();
  await ensureSchema(pool);
  await loadRoleCache(pool);

  autoBanTrap.registerAutoBanTrap(client);

  if (!messageListenerBound) {
    client.on(Events.MessageCreate, message => {
      const preview = typeof message?.content === 'string'
        ? message.content.slice(0, 200)
        : '';
      console.log('[moderation] messageCreate event received', {
        guildId: message?.guildId || null,
        channelId: message?.channelId || null,
        messageId: message?.id || null,
        authorId: message?.author?.id || null,
        contentPreview: preview
      });
      handleOrgLinkMessage(message).catch(err => {
        console.error('moderation: org link moderation failed', err);
      });
    });
    console.log('[moderation] org link/referral monitor registered');
    messageListenerBound = true;
  }

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
    resolveTimeoutChoice: modals.resolveTimeoutChoice,
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
    executePardon: actions.executePardon,
    resetInitialization: () => {
      initialized = false;
      messageListenerBound = false;
    }
  }
};
