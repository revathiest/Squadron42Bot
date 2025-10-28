// file: /referrals.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getPool } = require('./database');
const conn = getPool();

const REFERRAL_REGEX = /^STAR-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

async function initialize(client) {
  await ensureTables();
}

async function ensureTables() {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS referral_codes (
      user_id VARCHAR(32) PRIMARY KEY,
      code VARCHAR(15) UNIQUE NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await conn.query(`
    CREATE TABLE IF NOT EXISTS provided_codes (
      code VARCHAR(15) PRIMARY KEY,
      provided_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function buildRegisterCommand() {
  return new SlashCommandBuilder()
    .setName('register-referral-code')
    .setDescription('Register or update your Star Citizen referral code.')
    .addStringOption(opt =>
      opt.setName('code')
        .setDescription('Your referral code (format: STAR-XXXX-XXXX)')
        .setRequired(true)
    );
}

function buildGetCommand() {
  return new SlashCommandBuilder()
    .setName('get-referral-code')
    .setDescription('Get a random unused Star Citizen referral code from the pool.')
    .toJSON();
}

async function handleRegister(interaction) {
  const userId = interaction.user.id;
  const code = interaction.options.getString('code').trim().toUpperCase();

  if (!REFERRAL_REGEX.test(code)) {
    return interaction.reply({
      content: 'That code doesn’t match the required format (STAR-XXXX-XXXX).',
      ephemeral: true
    });
  }

  try {
    // Check if code already exists
    const [dup] = await conn.query('SELECT user_id FROM referral_codes WHERE code = ?', [code]);
    if (dup.length && dup[0].user_id !== userId) {
      return interaction.reply({
        content: 'That referral code is already registered by another user.',
        ephemeral: true
      });
    }

    await conn.query(
      `INSERT INTO referral_codes (user_id, code)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE code = VALUES(code), updated_at = CURRENT_TIMESTAMP`,
      [userId, code]
    );

    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('Referral Code Registered')
        .setDescription(`✅ Your code **${code}** has been saved.`)
        .setColor(0x00FF99)],
      ephemeral: true
    });
  } finally {
  }
}

async function handleGet(interaction) {
  const userId = interaction.user.id;

  try {
    // Prevent users who already have a code
    const [hasCode] = await conn.query('SELECT code FROM referral_codes WHERE user_id = ?', [userId]);
    if (hasCode.length) {
      return interaction.reply({
        content: 'You already have a referral code registered — you can’t claim one.',
        ephemeral: true
      });
    }

    let [unusedCodes] = await conn.query(`
      SELECT code FROM referral_codes
      WHERE code NOT IN (SELECT code FROM provided_codes)
    `);

    // Reset provided table if everything’s used
    if (unusedCodes.length === 0) {
      await conn.query('TRUNCATE TABLE provided_codes');
      [unusedCodes] = await conn.query(`
        SELECT code FROM referral_codes
      `);
    }

    if (unusedCodes.length === 0) {
      return interaction.reply({
        content: 'No referral codes are available right now. Try again later.',
        ephemeral: true
      });
    }

    // Pick one at random
    const randomCode = unusedCodes[Math.floor(Math.random() * unusedCodes.length)].code;

    await conn.query('INSERT INTO provided_codes (code) VALUES (?)', [randomCode]);

    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('Here’s Your Referral Code')
        .setDescription(`🎟️ **${randomCode}**`)
        .setColor(0x0099FF)],
      ephemeral: true
    });
  } finally {
  }
}

module.exports = {
  initialize,            // sets up tables (safe to run before login)
  onReady: async () => {}, // no-op for interface consistency
  getSlashCommandDefinitions: () => ({
    global: [buildRegisterCommand(), buildGetCommand()],
    guild: []
  }),
  handleInteraction: async interaction => {
    if (!interaction.isChatInputCommand()) {
      return false;
    }
    if (interaction.commandName === 'register-referral-code') {
      await handleRegister(interaction);
      return true;
    }
    if (interaction.commandName === 'get-referral-code') {
      await handleGet(interaction);
      return true;
    }
    return false;
  },
  __testables: { REFERRAL_REGEX }
};

