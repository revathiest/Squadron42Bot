const { EmbedBuilder, MessageFlags } = require('discord.js');
const { REFERRAL_REGEX, getPool } = require('../utils');

async function handleRegisterReferral(interaction) {
  const pool = getPool();
  const userId = interaction.user.id;
  const code = interaction.options.getString('code', true).trim().toUpperCase();

  if (!REFERRAL_REGEX.test(code)) {
    await interaction.reply({
      content: 'That code does not match the required format (STAR-XXXX-XXXX).',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const [duplicate] = await pool.query(
    'SELECT user_id FROM referral_codes WHERE code = ?',
    [code]
  );

  if (duplicate.length && duplicate[0].user_id !== userId) {
    await interaction.reply({
      content: 'That referral code is already registered by another user.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  await pool.query(
    `INSERT INTO referral_codes (user_id, code)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE code = VALUES(code), updated_at = CURRENT_TIMESTAMP`,
    [userId, code]
  );

  const embed = new EmbedBuilder()
    .setTitle('Referral Code Registered')
    .setDescription(`Your code **${code}** has been saved.`)
    .setColor(0x00ff99);

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  return true;
}

module.exports = {
  handleRegisterReferral
};
