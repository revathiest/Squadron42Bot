const core = require('../core');

async function handleVoiceStateUpdate(oldState, newState) {
  await core.onVoiceStateUpdate(oldState, newState);
}

module.exports = {
  handleVoiceStateUpdate
};
