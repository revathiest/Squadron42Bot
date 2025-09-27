// index.js
require('dotenv/config');
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { testConnection } = require('./database');

// Minimal intents: we just want to connect and exist
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// Fires once when the gateway is ready
client.once(Events.ClientReady, c => {
  console.log('Logged in as %s. Standing by, doing absolutely nothing.', c.user.tag);
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
