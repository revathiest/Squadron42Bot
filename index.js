// index.js
require('dotenv/config');
const { Client, GatewayIntentBits, Events, Partials } = require('discord.js');
const { testConnection } = require('./database');
const commandManager = require('./commandManager');
const { registerInteractionHandlers } = require('./interactionRegistry');
const voiceRooms = require('./voiceRooms');
const tickets = require('./tickets');
const moderation = require('./moderation');
const spectrum = require('./spectrum');
const referrals = require('./referrals');
const configStatus = require('./configStatus');
const embeds = require('./embeds');
const polls = require('./polls');
const engagement = require('./engagement');

const commandModules = [voiceRooms, tickets, moderation, spectrum, referrals, configStatus, embeds, polls, engagement];
const interactionModules = [voiceRooms, tickets, moderation, spectrum, referrals, configStatus, embeds, polls, engagement];

// Minimal intents: connect, manage guild state, and listen to voice updates
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // Required for role change detection
    GatewayIntentBits.GuildModeration,    // Needed to execute bans
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent // Required for message monitoring (org/referral enforcement)
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

registerInteractionHandlers(client, interactionModules);


// Fires once when the gateway is ready
client.once(Events.ClientReady, async c => {
  console.log('Logged in as %s.', c.user.tag);

  try {
    const connectedGuildIds = Array.from(c.guilds.cache.keys());
    await commandManager.registerAllCommands(c.token ?? token, commandModules, connectedGuildIds);
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
    await spectrum.onReady(c);
  } catch (err) {
    console.error('Failed to finalize spectrum watcher module:', err);
  }

  try {
    await configStatus.onReady(c);
  } catch (err) {
    console.error('Failed to finalize config status module:', err);
  }

  try {
    await embeds.onReady(c);
  } catch (err) {
    console.error('Failed to finalize embed template module:', err);
  }

  try {
    await polls.onReady(c);
  } catch (err) {
    console.error('Failed to finalize polls module:', err);
  }

  try {
    await engagement.onReady(c);
  } catch (err) {
    console.error('Failed to finalize engagement module:', err);
  }

    // --- Warm up member cache for all guilds ---
  for (const [guildId, guild] of c.guilds.cache) {
    try {
      await guild.members.fetch(); // populates the member cache
      console.log(`autoBanTrap: Cached members for ${guild.name} (${guildId})`);
    } catch (err) {
      console.warn(`autoBanTrap: Failed to fetch members for ${guild.name}:`, err.message);
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
    await spectrum.initialize(client);
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
    await configStatus.initialize(client);
  } catch (err) {
    console.error('Failed to initialize config status module:', err);
    process.exit(1);
  }

  try {
    await embeds.initialize(client);
  } catch (err) {
    console.error('Failed to initialize embed template module:', err);
    process.exit(1);
  }

  try {
    await polls.initialize(client);
  } catch (err) {
    console.error('Failed to initialize polls module:', err);
    process.exit(1);
  }

  try {
    await engagement.initialize(client);
  } catch (err) {
    console.error('Failed to initialize engagement module:', err);
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
