const commands = require('./commands');
const { ensureTables } = require('./utils');
const { handleRegisterReferral } = require('./handlers/registerReferral');
const { handleGetReferral } = require('./handlers/getReferral');

async function initialize() {
  await ensureTables();
}

async function onReady() {
  // No post-login work required.
}

function getSlashCommandDefinitions() {
  return commands.getSlashCommandDefinitions();
}

async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) {
    return false;
  }

  if (interaction.commandName === 'register-referral-code') {
    return handleRegisterReferral(interaction);
  }

  if (interaction.commandName === 'get-referral-code') {
    return handleGetReferral(interaction);
  }

  return false;
}

module.exports = {
  initialize,
  onReady,
  getSlashCommandDefinitions,
  handleInteraction
};
