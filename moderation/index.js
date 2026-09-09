const { Events } = require('discord.js');
const { getPool } = require('../database');
const { respondEphemeral, ensureSchema } = require('./utils');
const { getSlashCommandDefinitions } = require('./commands');
const autoBanTrap = require('./autoBanTrap');
const roles = require('./handlers/roles');
const { handleInteraction } = require('./handlers/interaction');
const {
  handleMessageCreate: handleOrgLinkMessage,
  loadOrgForumCache
} = require('./handlers/orgLinks');

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
  await loadOrgForumCache(pool);

  autoBanTrap.registerAutoBanTrap(client);

  if (!messageListenerBound) {
    client.on(Events.MessageCreate, message => {
      handleOrgLinkMessage(message).catch(err => {
        console.error('moderation: org link moderation failed', err);
      });
    });
    console.info('[moderation] org link/referral monitor registered');
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
    memberHasRole: roles.memberHasRole,
    respondEphemeral,
    handleModCommand: roles.handleModCommand,
    handleInteraction,
    handleAutoBanRoleUpdate: autoBanTrap.handleGuildMemberUpdate,
    handleTrapConfigCommand: autoBanTrap.handleTrapConfigCommand,
    fetchTrapRoleId: autoBanTrap.fetchTrapRoleId,
    isTrapRoleNewlyAssigned: autoBanTrap.isTrapRoleNewlyAssigned,
    resetInitialization: () => {
      initialized = false;
      messageListenerBound = false;
    }
  }
};
