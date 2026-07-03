const { getPool } = require('../database');

const configCache = new Map(); // guildId -> { guildId, channelId, updatedBy, updatedAt }

async function ensureSchema(pool = getPool()) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sq42news_config (
      guild_id VARCHAR(20) NOT NULL PRIMARY KEY,
      channel_id VARCHAR(20) NULL,
      updated_by VARCHAR(20) NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

function mapRow(row) {
  if (!row) return null;
  return {
    guildId: String(row.guild_id),
    channelId: row.channel_id ? String(row.channel_id) : null,
    updatedBy: row.updated_by ? String(row.updated_by) : null,
    updatedAt: row.updated_at ? new Date(row.updated_at) : null,
  };
}

async function loadCache(pool = getPool()) {
  const [rows] = await pool.query(
    'SELECT guild_id, channel_id, updated_by, updated_at FROM sq42news_config'
  );
  configCache.clear();
  for (const row of rows) {
    const config = mapRow(row);
    if (config) configCache.set(config.guildId, config);
  }
}

async function fetchConfig(guildId) {
  const key = String(guildId);
  if (configCache.has(key)) return configCache.get(key);

  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT guild_id, channel_id, updated_by, updated_at FROM sq42news_config WHERE guild_id = ?',
    [key]
  );
  if (!rows.length) return null;

  const config = mapRow(rows[0]);
  if (config) configCache.set(key, config);
  return config;
}

async function setConfig(guildId, channelId, updatedBy) {
  const key = String(guildId);
  const pool = getPool();

  await pool.query(
    `INSERT INTO sq42news_config (guild_id, channel_id, updated_by)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       channel_id = VALUES(channel_id),
       updated_by = VALUES(updated_by),
       updated_at = CURRENT_TIMESTAMP`,
    [key, channelId ? String(channelId) : null, updatedBy ? String(updatedBy) : null]
  );

  const config = {
    guildId: key,
    channelId: channelId ? String(channelId) : null,
    updatedBy: updatedBy ? String(updatedBy) : null,
    updatedAt: new Date(),
  };
  configCache.set(key, config);
  return config;
}

async function clearConfig(guildId) {
  const key = String(guildId);
  const pool = getPool();
  await pool.query('DELETE FROM sq42news_config WHERE guild_id = ?', [key]);
  configCache.delete(key);
}

function getConfigsSnapshot() {
  return Array.from(configCache.values()).map(c => ({ ...c }));
}

module.exports = {
  configCache,
  ensureSchema,
  loadCache,
  fetchConfig,
  setConfig,
  clearConfig,
  getConfigsSnapshot,
};
