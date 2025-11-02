const { Events } = require('discord.js');
const commands = require('./commands');
const { ensureSchema } = require('./schema');
const { handleInteraction: handleCommandInteraction } = require('./handlers/interaction');
const { handleReactionAdd, handleReactionRemove } = require('./handlers/reactions');
const { handleReplyCreate, handleReplyDelete } = require('./handlers/replies');

let listenersRegistered = false;

async function initialize(client) {
  await ensureSchema();

  if (!listenersRegistered) {
    client.on(Events.MessageReactionAdd, (reaction, user) => {
      handleReactionAdd(client, reaction, user).catch(err => {
        console.error('[engagement] reaction add handler failed:', err);
      });
    });

    client.on(Events.MessageReactionRemove, (reaction, user) => {
      handleReactionRemove(client, reaction, user).catch(err => {
        console.error('[engagement] reaction remove handler failed:', err);
      });
    });

    client.on(Events.MessageCreate, message => {
      handleReplyCreate(client, message).catch(err => {
        console.error('[engagement] reply create handler failed:', err);
      });
    });

    client.on(Events.MessageDelete, message => {
      handleReplyDelete(message).catch(err => {
        console.error('[engagement] reply delete handler failed:', err);
      });
    });

    listenersRegistered = true;
  }
}

async function onReady() {
  // No-op for now; placeholder for future cache warm-up.
}

function getSlashCommandDefinitions() {
  return commands.getSlashCommandDefinitions();
}

async function handleInteraction(interaction) {
  return handleCommandInteraction(interaction);
}

module.exports = {
  initialize,
  onReady,
  getSlashCommandDefinitions,
  handleInteraction
};
