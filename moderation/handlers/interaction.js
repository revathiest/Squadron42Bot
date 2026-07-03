const { respondEphemeral } = require('../utils');
const { handleModCommand } = require('./roles');

async function handleInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'mod') {
      await handleModCommand(interaction);
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
