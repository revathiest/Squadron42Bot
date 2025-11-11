// commandManager.js
// Aggregates and registers slash commands across modules, clearing old definitions first.

/* c8 ignore start */

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

function serializeCommands(commands) {
  return commands.map(cmd => (typeof cmd?.toJSON === 'function' ? cmd.toJSON() : cmd));
}

async function registerAllCommands(token, modules, guildIds = []) {
  const applicationId = process.env.APPLICATION_ID;

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

  const uniqueGuildIds = Array.isArray(guildIds)
    ? Array.from(new Set(guildIds.filter(Boolean)))
    : [];

  logCommandList('requested global command set', globalCommands);
  if (uniqueGuildIds.length) {
    logCommandList('requested guild command set', guildCommands);
  } else if (guildCommands.length) {
    /* c8 ignore next */
    console.log('commandManager: Guild command definitions present but no connected guilds were supplied.');
  }

  try {
    await rest.put(Routes.applicationCommands(applicationId), { body: [] });
    /* c8 ignore next */
    console.log('commandManager: Cleared global slash commands.');
  } catch (err) {
    /* c8 ignore next */
    console.error('commandManager: Failed to clear global slash commands', err);
  }

  const clearGuildCommands = process.env.CLEAR_GUILD_COMMANDS;
  if (clearGuildCommands === 'true' && uniqueGuildIds.length) {
    for (const guildId of uniqueGuildIds) {
      try {
        await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: [] });
        /* c8 ignore next */
        console.log(`commandManager: Cleared slash commands for guild ${guildId}.`);
      } catch (err) {
        /* c8 ignore next */
        console.error(`commandManager: Failed to clear slash commands for guild ${guildId}`, err);
      }
    }
  } else if (clearGuildCommands === 'true' && guildCommands.length) {
    /* c8 ignore next */
    console.log('commandManager: CLEAR_GUILD_COMMANDS requested but no connected guilds were provided; skipping guild clears.');
  } else if (clearGuildCommands === 'false') {
    /* c8 ignore next */
    console.log('commandManager: Guild-specific commands not deleted. Forced command clearing disabled.');
  }

  if (globalCommands.length) {
    try {
      await rest.put(Routes.applicationCommands(applicationId), { body: serializeCommands(globalCommands) });
      /* c8 ignore next */
      console.log(`commandManager: Registered ${globalCommands.length} global slash command(s).`);
      /* c8 ignore next */
      logCommandList('registered global commands', globalCommands);
    } catch (err) {
      /* c8 ignore next */
      console.error('commandManager: Failed to register global slash commands', err);
      logCommandList('failed global commands', globalCommands);
    }
  } else {
    /* c8 ignore next */
    console.log('commandManager: No global commands to register.');
  }

  const forceRegister = process.env.FORCE_REREGISTER;
  if (guildCommands.length && forceRegister === 'true' && uniqueGuildIds.length) {
    for (const guildId of uniqueGuildIds) {
      try {
        await rest.put(
          Routes.applicationGuildCommands(applicationId, guildId),
          { body: serializeCommands(guildCommands) }
        );
        console.log(`commandManager: Registered ${guildCommands.length} guild slash command(s) for guild ${guildId}.`);
        logCommandList(`registered guild(${guildId}) commands`, guildCommands);
      } catch (err) {
        console.error(`commandManager: Failed to register guild slash commands for guild ${guildId}`, err);
        logCommandList(`failed guild(${guildId}) commands`, guildCommands);
      }
    }
  /* c8 ignore next */
  } else if (!guildCommands.length) {
    console.log('commandManager: No guild commands to register.');
  /* c8 ignore next */
  } else if (forceRegister === 'false') {
    console.log('commandManager: Guild commands not registered.  Forced reregister disabled.');
  /* c8 ignore next */
  } else if (!uniqueGuildIds.length) {
    console.log('commandManager: Skipping guild command registration; no connected guilds available.');
  }
}

module.exports = {
  registerAllCommands,
  collectCommands
};

/* c8 ignore end */
