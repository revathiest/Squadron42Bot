// interactionRegistry.js
// Centralizes Discord interaction routing across all bot modules.

const { Events } = require('discord.js');

function formatModuleLabel(mod, index) {
  if (!mod) {
    return `module#${index}`;
  }
  if (typeof mod.name === 'string' && mod.name.trim()) {
    return mod.name;
  }
  if (typeof mod.getName === 'function') {
    try {
      const resolved = mod.getName();
      if (resolved) {
        return resolved;
      }
    } catch (err) {
      console.warn('interactionRegistry: Failed to resolve module name via getName()', err);
    }
  }
  if (mod.constructor && mod.constructor.name) {
    return mod.constructor.name;
  }
  return `module#${index}`;
}

function buildHandlerList(modules) {
  return modules
    .map((mod, index) => {
      if (!mod || typeof mod.handleInteraction !== 'function') {
        return null;
      }
      return {
        label: formatModuleLabel(mod, index),
        handle: mod.handleInteraction
      };
    })
    .filter(Boolean);
}

function registerInteractionHandlers(client, modules) {
  const handlers = buildHandlerList(modules);
  if (!handlers.length) {
    console.log('interactionRegistry: No interaction handlers registered.');
    return () => {};
  }

  const listener = async interaction => {
    for (const { label, handle } of handlers) {
      try {
        const result = await handle(interaction);
        if (result === true || interaction.replied || interaction.deferred) {
          return;
        }
      } catch (err) {
        console.error(`interactionRegistry: Handler for ${label} failed`, err);
      }
    }
  };

  client.on(Events.InteractionCreate, listener);

  return () => {
    if (typeof client.off === 'function') {
      client.off(Events.InteractionCreate, listener);
    }
  };
}

module.exports = {
  registerInteractionHandlers
};
