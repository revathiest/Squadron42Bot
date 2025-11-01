const { EmbedBuilder, MessageFlags } = require('discord.js');
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
      content: 'You already have a referral code registered; you cannot claim another one.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const [unclaimedRows] = await pool.query(`
    SELECT code FROM referral_codes
    WHERE code NOT IN (SELECT code FROM provided_codes)
  `);

  let availableCodes = unclaimedRows;

  if (!availableCodes.length) {
    await pool.query('TRUNCATE TABLE provided_codes');
    const [allRows] = await pool.query('SELECT code FROM referral_codes');
    availableCodes = allRows;
  }

  if (!availableCodes.length) {
    await interaction.reply({
      content: 'No referral codes are available right now. Try again later.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const randomIndex = Math.floor(Math.random() * availableCodes.length);
  const randomCode = availableCodes[randomIndex].code;

  await pool.query('INSERT INTO provided_codes (code) VALUES (?)', [randomCode]);

  const embed = new EmbedBuilder()
    .setTitle("Here's Your Referral Code")
    .setDescription(`Use **${randomCode}** when creating your account.`)
    .setColor(0x0099ff);

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  return true;
}

module.exports = {
  handleGetReferral
};
