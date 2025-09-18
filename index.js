// index.js
require('dotenv/config');
const { Client, GatewayIntentBits, Events } = require('discord.js');

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

// Log in using your token from .env
client.login(token);

// Optional: keep things tidy
process.on('unhandledRejection', err => console.error('Unhandled promise rejection:', err));
process.on('SIGINT', () => { client.destroy(); process.exit(0); });
