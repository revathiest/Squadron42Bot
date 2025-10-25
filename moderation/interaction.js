const { Events } = require('discord.js');
const { ACTIONS, PARDON_COMMAND_NAME, HISTORY_CONTEXT_LABEL } = require('./constants');
const { respondEphemeral } = require('./utils');
const { handleModCommand } = require('./roleConfig');
const { handleActionRequest, handlePardonCommand } = require('./actions/context');
const { handleConfigStatus } = require("../configstatus");
const { handleModal } = require('./actions/modals');
const { handleHistoryContext } = require('./history/context');
const referrals = require('../referrals');

async function handleInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'mod') {
        await handleModCommand(interaction);
        return;
      }

      if (interaction.commandName === PARDON_COMMAND_NAME) {
        await handlePardonCommand(interaction);
        return;
      }

      if(interaction.commandName === 'config-status') {
        await handleConfigStatus(interaction);
        return;
      }
    }

    if (interaction.isUserContextMenuCommand()) {
      if (interaction.commandName === ACTIONS.warn.label) {
        await handleActionRequest(interaction, 'warn');
        return;
      }

      if (interaction.commandName === ACTIONS.kick.label) {
        await handleActionRequest(interaction, 'kick');
        return;
      }

      if (interaction.commandName === ACTIONS.ban.label) {
        await handleActionRequest(interaction, 'ban');
        return;
      }

      if (interaction.commandName === ACTIONS.timeout.label) {
        await handleActionRequest(interaction, 'timeout');
        return;
      }

      if (interaction.commandName === HISTORY_CONTEXT_LABEL) {
        await handleHistoryContext(interaction);
        return;
      }
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('moderation:')) {
      await handleModal(interaction);
    }
  } catch (err) {
    console.error('moderation: Interaction handler failed', err);
    if (interaction.isRepliable()) {
      await respondEphemeral(interaction, 'An error occurred while processing that moderation action.');
    }
  }
}

/* istanbul ignore next */
function registerInteractionListener(client, commandModules = []) {
  client.on(Events.InteractionCreate, async interaction => {
    try {
      console.log('attempting to handle ' + interaction.commandName);
      await handleInteraction(interaction);
    } catch (err) {
      console.error('moderation: Unhandled interaction error', err);
    }

    try {
      await referrals.handleInteraction(interaction);
    } catch (err) {
      console.error('referrals: Unhandled interaction error', err);
    }

    for (const mod of commandModules) {
      if (typeof mod.handleInteraction === 'function') {
        try {
          await mod.handleInteraction(interaction);
        } catch (err) {
          console.error(`[${mod.constructor?.name || 'module'}] Unhandled interaction error:`, err);
        }
      }
    }
  });
}

module.exports = {
  handleInteraction,
  registerInteractionListener
};
