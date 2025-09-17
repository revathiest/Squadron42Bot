// index.js
require('dotenv/config');
const { Client, GatewayIntentBits, Events } = require('discord.js');

// Minimal intents: we just want to connect and exist
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// Fires once when the gateway is ready
client.once(Events.ClientReady, c => {
  console.log(`✅ Logged in as ${c.user.tag}. Standing by, doing absolutely nothing.`);
});

// Log in using your token from .env
client.login(process.env.DISCORD_TOKEN);

// Optional: keep things tidy
process.on('unhandledRejection', err => console.error('Unhandled promise rejection:', err));
process.on('SIGINT', () => { client.destroy(); process.exit(0); });
