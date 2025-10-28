const { SlashCommandBuilder } = require('discord.js');

function buildRegisterCommand() {
  return new SlashCommandBuilder()
    .setName('register-referral-code')
    .setDescription('Register or update your Star Citizen referral code.')
    .addStringOption(option =>
      option
        .setName('code')
        .setDescription('Your referral code (format: STAR-XXXX-XXXX)')
        .setRequired(true)
    );
}

function buildGetCommand() {
  return new SlashCommandBuilder()
    .setName('get-referral-code')
    .setDescription('Get a random unused Star Citizen referral code from the pool.');
}

function getSlashCommandDefinitions() {
  return {
    global: [buildRegisterCommand(), buildGetCommand()],
    guild: []
  };
}

module.exports = {
  getSlashCommandDefinitions
};
