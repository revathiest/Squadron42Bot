// commandManager.js
// Aggregates and registers slash commands across modules, clearing old definitions first.

const { REST, Routes } = require('discord.js');

function collectCommands(modules) {
  const global = [];
  const guild = [];

  for (const mod of modules) {
    if (typeof mod.getSlashCommandDefinitions !== 'function') {
      continue;
    }

    const definitions = mod.getSlashCommandDefinitions();
    if (!definitions || typeof definitions !== 'object') {
      continue;
    }

    if (Array.isArray(definitions.global)) {
      global.push(...definitions.global);
    }

    if (Array.isArray(definitions.guild)) {
      guild.push(...definitions.guild);
    }
  }

  return { global, guild };
}

async function registerAllCommands(token, modules) {
  const applicationId = process.env.APPLICATION_ID;
  const guildId = process.env.GUILD_ID;

  if (!applicationId) {
    console.warn('commandManager: APPLICATION_ID is not set; skipping slash command registration.');
    return;
  }

  if (!token) {
    console.warn('commandManager: Missing bot token; cannot register slash commands.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(token);
  const { global: globalCommands, guild: guildCommands } = collectCommands(modules);

  // Always clear existing definitions to avoid duplicates or stale commands.
  try {
    await rest.put(Routes.applicationCommands(applicationId), { body: [] });
    console.log('commandManager: Cleared global slash commands.');
  } catch (err) {
    console.error('commandManager: Failed to clear global slash commands', err);
  }

  if (guildId) {
    try {
      await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: [] });
      console.log(`commandManager: Cleared slash commands for guild ${guildId}.`);
    } catch (err) {
      console.error(`commandManager: Failed to clear slash commands for guild ${guildId}`, err);
    }
  } else if (guildCommands.length) {
    console.warn('commandManager: Guild-specific commands defined but GUILD_ID is missing; they will not be registered.');
  }

  if (globalCommands.length) {
    try {
      await rest.put(Routes.applicationCommands(applicationId), { body: globalCommands });
      console.log(`commandManager: Registered ${globalCommands.length} global slash command(s).`);
    } catch (err) {
      console.error('commandManager: Failed to register global slash commands', err);
    }
  }

  if (guildCommands.length && guildId) {
    try {
      await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: guildCommands });
      console.log(`commandManager: Registered ${guildCommands.length} guild slash command(s).`);
    } catch (err) {
      console.error(`commandManager: Failed to register guild slash commands for guild ${guildId}`, err);
    }
  }
}

module.exports = {
  registerAllCommands
};
