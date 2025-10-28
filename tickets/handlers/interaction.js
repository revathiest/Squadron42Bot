const core = require('../core');

async function handleInteraction(interaction) {
  return core.handleInteraction(interaction);
}

module.exports = {
  handleInteraction
};
