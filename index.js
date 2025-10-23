// index.js
require('dotenv/config');
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { testConnection } = require('./database');
const commandManager = require('./commandManager');
const voiceRooms = require('./voiceRooms');
const tickets = require('./tickets');
const moderation = require('./moderation');

const commandModules = [voiceRooms, tickets, moderation];

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
