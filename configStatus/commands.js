const { SlashCommandBuilder } = require('discord.js');

function buildCommand() {
  return new SlashCommandBuilder()
    .setName('config-status')
    .setDescription('Show all active system configurations.')
    .setDMPermission(false);
}

function getSlashCommandDefinitions() {
  return {
    global: [],
    guild: [buildCommand()]
  };
}

module.exports = {
  getSlashCommandDefinitions
};
