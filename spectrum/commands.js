const spectrumConfig = require('./config');

function getSlashCommandDefinitions() {
  return spectrumConfig.getSlashCommandDefinitions();
}

module.exports = {
  getSlashCommandDefinitions
};

