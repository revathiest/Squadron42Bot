const { Events } = require('discord.js');
const { ensureSchema } = require('./schema');
const { getSlashCommandDefinitions } = require('./commands');
const { handleInteraction: handleSlashInteraction } = require('./handlers/interaction');
const { handleMessageCreate, setClient } = require('./handlers/messageHandler');

let initialized = false;
let messageListenerBound = false;

async function initialize(client) {
  if (initialized) return;

  await ensureSchema();

  if (!messageListenerBound) {
    setClient(client);
    client.on(Events.MessageCreate, message => {
      handleMessageCreate(message).catch(err => {
        console.error('[spamDetection] Message handler error:', err);
      });
    });
    console.info('[spamDetection] Message monitor registered.');
    messageListenerBound = true;
  }

  initialized = true;
}

async function onReady(client) {
  if (!initialized) await initialize(client);
}

function handleInteraction(interaction) {
  return handleSlashInteraction(interaction);
}

module.exports = {
  initialize,
  onReady,
  getSlashCommandDefinitions,
  handleInteraction,
  __testables: {
    resetInitialization: () => {
      initialized = false;
      messageListenerBound = false;
    },
  },
};
