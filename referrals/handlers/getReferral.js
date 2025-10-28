const { EmbedBuilder } = require('discord.js');
const { getPool } = require('../utils');

async function handleGetReferral(interaction) {
  const pool = getPool();
  const userId = interaction.user.id;

  const [existing] = await pool.query(
    'SELECT code FROM referral_codes WHERE user_id = ?',
    [userId]
  );

  if (existing.length) {
    await interaction.reply({
      content: 'You already have a referral code registered — you cannot claim another one.',
      ephemeral: true
    });
    return true;
  }

  let [unusedCodes] = await pool.query(`
    SELECT code FROM referral_codes
    WHERE code NOT IN (SELECT code FROM provided_codes)
  `);

  if (!unusedCodes.length) {
    await pool.query('TRUNCATE TABLE provided_codes');
    [unusedCodes] = await pool.query('SELECT code FROM referral_codes');
  }

  if (!unusedCodes.length) {
    await interaction.reply({
      content: 'No referral codes are available right now. Try again later.',
      ephemeral: true
    });
    return true;
  }

  const randomCode = unusedCodes[Math.floor(Math.random() * unusedCodes.length)].code;

  await pool.query('INSERT INTO provided_codes (code) VALUES (?)', [randomCode]);

  const embed = new EmbedBuilder()
    .setTitle('Here’s Your Referral Code')
    .setDescription(`🎁 **${randomCode}**`)
    .setColor(0x0099ff);

  await interaction.reply({ embeds: [embed], ephemeral: true });
  return true;
}

module.exports = {
  handleGetReferral
};
