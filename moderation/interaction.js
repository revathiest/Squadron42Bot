const { Events } = require('discord.js');
const { ACTIONS, PARDON_COMMAND_NAME, HISTORY_CONTEXT_LABEL } = require('./constants');
const { respondEphemeral } = require('./utils');
const { handleModCommand } = require('./roleConfig');
const { handleActionRequest, handlePardonCommand } = require('./actions/context');
const { handleModal } = require('./actions/modals');
const { handleHistoryContext } = require('./history/context');

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
function registerInteractionListener(client) {
  client.on(Events.InteractionCreate, interaction => {
    handleInteraction(interaction).catch(err => {
      console.error('moderation: Unhandled interaction error', err);
    });
  });
}

module.exports = {
  handleInteraction,
  registerInteractionListener
};
