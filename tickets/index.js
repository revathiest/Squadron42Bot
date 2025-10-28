const { Events } = require('discord.js');
const commands = require('./commands');
const core = require('./core');
const { handleInteraction: handleTicketInteraction } = require('./handlers/interaction');
const { handleMessageCreate } = require('./handlers/message');

let messageListenerBound = false;

async function initialize(client) {
  await core.initialize(client);

  if (!messageListenerBound) {
    client.on(Events.MessageCreate, message => {
      handleMessageCreate(message).catch(err => {
        console.error('tickets: lobby message handler failed', err);
      });
    });
    messageListenerBound = true;
  }
}

async function onReady(client) {
  await core.onReady(client);
}

function getSlashCommandDefinitions() {
  return commands.getSlashCommandDefinitions();
}

async function handleInteraction(interaction) {
  return handleTicketInteraction(interaction);
}

module.exports = {
  initialize,
  onReady,
  getSlashCommandDefinitions,
  handleInteraction,
  __testables: core.__testables
};
