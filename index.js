// index.js
require('dotenv/config');
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { testConnection } = require('./database');
const commandManager = require('./commandManager');
const voiceRooms = require('./voiceRooms');
const tickets = require('./tickets');
const moderation = require('./moderation');
const spectrumWatcher = require('./spectrumWatcher');
const referrals = require('./referrals');

const commandModules = [voiceRooms, tickets, moderation, spectrumWatcher];

// Minimal intents: connect, manage guild state, and listen to voice updates
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // Required for role change detection
    GatewayIntentBits.GuildModeration,    // Needed to execute bans
    GatewayIntentBits.GuildVoiceStates
  ]
});


// Fires once when the gateway is ready
client.once(Events.ClientReady, async c => {
  console.log('Logged in as %s.', c.user.tag);

  try {
    await commandManager.registerAllCommands(c.token ?? token, commandModules);
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }

  try {
    await referrals.onReady(c);
  } catch (err) {
    console.error('Failed to finalize referrals module:', err);
  }

  try {
    await voiceRooms.onReady(c);
  } catch (err) {
    console.error('Failed to finalize voice room setup:', err);
  }

  try {
    await tickets.onReady(c);
  } catch (err) {
    console.error('Failed to finalize tickets module:', err);
  }

  try {
    await moderation.onReady(c);
  } catch (err) {
    console.error('Failed to finalize moderation module:', err);
  }

  try {
    await spectrumWatcher.onReady(c);
  } catch (err) {
    console.error('Failed to finalize spectrum watcher module:', err);
  }

    // --- Warm up member cache for all guilds ---
  for (const [guildId, guild] of c.guilds.cache) {
    try {
      await guild.members.fetch(); // populates the member cache
      console.log(`[autoBanTrap] Cached members for ${guild.name} (${guildId})`);
    } catch (err) {
      console.warn(`[autoBanTrap] Failed to fetch members for ${guild.name}:`, err.message);
    }
  }

});

const token = (process.env.DISCORD_TOKEN || '').trim();

if (!token) {
  console.error('DISCORD_TOKEN is not set. Skipping Discord login.');
  process.exit(1);
}

async function bootstrap() {
  try {
    await testConnection();
    console.log('Database connection established.');
  } catch (err) {
    console.error('Unable to connect to the database:', err.message);
    process.exit(1);
  }

  try {
    await voiceRooms.initialize(client);
  } catch (err) {
    console.error('Failed to initialize voice room module:', err);
    process.exit(1);
  }

  try {
    await tickets.initialize(client);
  } catch (err) {
    console.error('Failed to initialize tickets module:', err);
    process.exit(1);
  }

  try {
    await moderation.initialize(client);
  } catch (err) {
    console.error('Failed to initialize moderation module:', err);
    process.exit(1);
  }

  try {
    await spectrumWatcher.initialize(client);
  } catch (err) {
    console.error('Failed to initialize spectrum watcher module:', err);
    process.exit(1);
  }

  try {
    await referrals.initialize(client);
  } catch (err) {
    console.error('Failed to initialize referrals module:', err);
    process.exit(1);
  }

  try {
    await client.login(token);
  } catch (err) {
    console.error('Failed to log into Discord:', err);
    process.exit(1);
  }
}

bootstrap();

// Optional: keep things tidy
process.on('unhandledRejection', err => console.error('Unhandled promise rejection:', err));
process.on('SIGINT', () => { client.destroy(); process.exit(0); });
process.on('SIGTERM', () => { client.destroy(); process.exit(0); });
