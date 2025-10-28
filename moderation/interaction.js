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
        return true;
      }

      if (interaction.commandName === PARDON_COMMAND_NAME) {
        await handlePardonCommand(interaction);
        return true;
      }
    }

    if (interaction.isUserContextMenuCommand()) {
      if (interaction.commandName === ACTIONS.warn.label) {
        await handleActionRequest(interaction, 'warn');
        return true;
      }

      if (interaction.commandName === ACTIONS.kick.label) {
        await handleActionRequest(interaction, 'kick');
        return true;
      }

      if (interaction.commandName === ACTIONS.ban.label) {
        await handleActionRequest(interaction, 'ban');
        return true;
      }

      if (interaction.commandName === ACTIONS.timeout.label) {
        await handleActionRequest(interaction, 'timeout');
        return true;
      }

      if (interaction.commandName === HISTORY_CONTEXT_LABEL) {
        await handleHistoryContext(interaction);
        return true;
      }
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('moderation:')) {
      await handleModal(interaction);
      return true;
    }
  } catch (err) {
    console.error('moderation: Interaction handler failed', err);
    if (interaction.isRepliable()) {
      await respondEphemeral(interaction, 'An error occurred while processing that moderation action.');
    }
    return true;
  }

  return false;
}

module.exports = {
  handleInteraction
};
