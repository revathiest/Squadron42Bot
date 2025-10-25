// commandManager.js
// Aggregates and registers slash commands across modules, clearing old definitions first.

const { REST, Routes } = require('discord.js');

function collectCommands(modules) {
  const global = [];
  const guild = [];

  modules.forEach((mod, index) => {
    if (!mod || typeof mod.getSlashCommandDefinitions !== 'function') {
      return;
    }

    let definitions;
    try {
      definitions = mod.getSlashCommandDefinitions();
    } catch (err) {
      console.error(`commandManager: Failed to read command definitions from module #${index}`, err);
      return;
    }

    if (!definitions || typeof definitions !== 'object') {
      return;
    }

    if (Array.isArray(definitions.global)) {
      global.push(...definitions.global);
    }

    if (Array.isArray(definitions.guild)) {
      guild.push(...definitions.guild);
    }
  });

  return { global, guild };
}

function logCommandList(label, commands) {
  const names = commands.map(cmd => cmd?.name ?? '(unknown)').join(', ') || 'none';
  console.log(`commandManager: ${label} => ${names}`);
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

  logCommandList('requested global command set', globalCommands);
  if (guildId) {
    logCommandList(`requested guild(${guildId}) command set`, guildCommands);
  }

  try {
    await rest.put(Routes.applicationCommands(applicationId), { body: [] });
    console.log('commandManager: Cleared global slash commands.');
  } catch (err) {
    console.error('commandManager: Failed to clear global slash commands', err);
  }

  if (guildId && process.env.CLEAR_GUILD_COMMANDS === 'true') {
    try {
      await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: [] });
      console.log(`commandManager: Cleared slash commands for guild ${guildId}.`);
    } catch (err) {
      console.error(`commandManager: Failed to clear slash commands for guild ${guildId}`, err);
    }
  } else if (!guildId) {
    console.warn('commandManager: Guild-specific commands defined but GUILD_ID is missing; they will not be cleared.');
  } else if (process.env.CLEAR_GUILD_COMMANDS === 'false') {
    console.log('commandManager: Guild-specific commands not deleted. Forced command clearing disabled.')
  }

  if (globalCommands.length) {
    try {
      await rest.put(Routes.applicationCommands(applicationId), { body: globalCommands });
      console.log(`commandManager: Registered ${globalCommands.length} global slash command(s).`);
      logCommandList('registered global commands', globalCommands);
    } catch (err) {
      console.error('commandManager: Failed to register global slash commands', err);
      logCommandList('failed global commands', globalCommands);
    }
  } else {
    console.log('commandManager: No global commands to register.');
  }

  if (guildCommands.length && guildId && process.env.FORCE_REREGISTER === 'true') {
    try {
      await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: guildCommands });
      console.log(`commandManager: Registered ${guildCommands.length} guild slash command(s).`);
      logCommandList(`registered guild(${guildId}) commands`, guildCommands);
    } catch (err) {
      console.error(`commandManager: Failed to register guild slash commands for guild ${guildId}`, err);
      logCommandList(`failed guild(${guildId}) commands`, guildCommands);
    }
  } else if (!guildCommands.length) {
    console.log(`commandManager: No guild commands to register for guild ${guildId}.`);
  } else if (process.env.FORCE_REREGISTER === 'false'){
    console.log(`commandManager: Guild commands not registered.  Forced reregister disabled.`);
  } else if (!guildId) {
    console.log(`commandManager: Guild-specific commands defined but GUILD_ID is missing; they will not be registered.`);
  }
}

module.exports = {
  registerAllCommands,
  collectCommands
};
