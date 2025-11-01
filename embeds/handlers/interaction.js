const { handleAccessCommand } = require('./access');

async function handleInteraction(interaction) {
  if (interaction?.isChatInputCommand?.() && interaction.commandName === 'embed-access') {
    await handleAccessCommand(interaction);
    return true;
  }

  return false;
}

module.exports = {
  handleInteraction
};
