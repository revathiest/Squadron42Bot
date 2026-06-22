const { EmbedBuilder } = require('discord.js');
const { getPool } = require('../database');

const configCache = new Map();

function getDefaultConfig(guildId) {
  return {
    guild_id: guildId,
    enabled: false,
    alert_channel_id: null,
    rate_limit_count: 5,
    rate_limit_window_ms: 5000,
    auto_action: 'timeout',
    timeout_duration_ms: 3600000,
    whitelistRoleIds: [],
    whitelistChannelIds: [],
    new_account_days: 3,
    signal_threshold: 2,
    established_member_days: 30,
  };
}

async function loadConfig(guildId) {
  if (configCache.has(guildId)) return configCache.get(guildId);

  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM spam_config WHERE guild_id = ?', [guildId]);

  if (rows.length === 0) {
    const config = getDefaultConfig(guildId);
    configCache.set(guildId, config);
    return config;
  }

  const row = rows[0];
  const config = {
    ...row,
    enabled: Boolean(row.enabled),
    whitelistRoleIds: JSON.parse(row.whitelist_role_ids || '[]'),
    whitelistChannelIds: JSON.parse(row.whitelist_channel_ids || '[]'),
  };

  configCache.set(guildId, config);
  return config;
}

function invalidateCache(guildId) {
  configCache.delete(guildId);
}

async function upsertConfig(guildId, updates) {
  const pool = getPool();
  const keys = Object.keys(updates);
  const values = Object.values(updates);

  await pool.query(
    `INSERT INTO spam_config (guild_id, ${keys.join(', ')})
     VALUES (?, ${keys.map(() => '?').join(', ')})
     ON DUPLICATE KEY UPDATE ${keys.map(k => `${k} = VALUES(${k})`).join(', ')}`,
    [guildId, ...values]
  );

  invalidateCache(guildId);
}

async function sendAlert(client, guildId, alertChannelId, { member, reason, action, messageContent, channelId, tier }) {
  if (!alertChannelId) return;

  try {
    const channel = await client.channels.fetch(alertChannelId);
    if (!channel?.isTextBased()) return;

    const accountAgeDays = Math.floor((Date.now() - member.user.createdTimestamp) / 86_400_000);

    const embed = new EmbedBuilder()
      .setTitle('Spam Detection Alert')
      .setColor(action === 'ban' ? 0xff2222 : 0xff8c00)
      .addFields(
        { name: 'User', value: `<@${member.id}> (${member.user.tag})`, inline: true },
        { name: 'Action', value: action === 'ban' ? '🔨 Banned' : '⏱️ Timed out (1h)', inline: true },
        { name: 'Channel', value: `<#${channelId}>`, inline: true },
        { name: 'Account Age', value: `${accountAgeDays} day${accountAgeDays !== 1 ? 's' : ''}`, inline: true },
        { name: 'Trust Tier', value: tier ?? 'unknown', inline: true },
        { name: 'Reason', value: reason },
      )
      .setTimestamp();

    if (messageContent) {
      embed.addFields({ name: 'Message Content', value: messageContent.slice(0, 1024) });
    }

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('[spamDetection] Failed to send alert:', err.message);
  }
}

module.exports = { loadConfig, invalidateCache, upsertConfig, sendAlert, getDefaultConfig };
