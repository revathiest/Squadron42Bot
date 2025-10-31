const { getPool } = require('../database');

const configCache = new Map(); // guildId -> config snapshot

async function ensureSchema(pool = getPool()) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS spectrum_config (
      guild_id VARCHAR(20) NOT NULL PRIMARY KEY,
      announce_channel_id VARCHAR(20) NULL,
      forum_id VARCHAR(32) NULL,
      updated_by VARCHAR(20) NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    ALTER TABLE spectrum_config
      MODIFY guild_id VARCHAR(20) NOT NULL,
      MODIFY announce_channel_id VARCHAR(20) NULL,
      MODIFY updated_by VARCHAR(20) NULL
  `).catch(() => {});
}

function mapRowToConfig(row) {
  if (!row) {
    return null;
  }

  return {
    guildId: String(row.guild_id),
    announceChannelId: row.announce_channel_id ? String(row.announce_channel_id) : null,
    forumId: row.forum_id ? String(row.forum_id) : null,
    updatedBy: row.updated_by ? String(row.updated_by) : null,
    updatedAt: row.updated_at ? new Date(row.updated_at) : null
  };
}

async function loadCache(pool = getPool()) {
  const [rows] = await pool.query(`
    SELECT guild_id, announce_channel_id, forum_id, updated_by, updated_at
    FROM spectrum_config
  `);

  configCache.clear();
  for (const row of rows) {
    const config = mapRowToConfig(row);
    if (config) {
      configCache.set(config.guildId, config);
    }
  }
}

async function fetchConfig(guildId) {
  const key = String(guildId);
  const cached = configCache.get(key);
  if (cached) {
    return cached;
  }

  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT guild_id, announce_channel_id, forum_id, updated_by, updated_at FROM spectrum_config WHERE guild_id = ?',
    [key]
  );

  if (!rows.length) {
    return null;
  }

  const config = mapRowToConfig(rows[0]);
  if (config) {
    configCache.set(key, config);
  }

  return config;
}

async function setConfig(guildId, channelId, forumId, updatedBy) {
  const key = String(guildId);
  const current = configCache.get(key) || null;

  const nextChannelId = channelId === undefined
    ? current?.announceChannelId ?? null
    : (channelId ? String(channelId) : null);

  const nextForumId = forumId === undefined
    ? current?.forumId ?? null
    : (forumId ? String(forumId) : null);

  const pool = getPool();
  await pool.query(
    `
      INSERT INTO spectrum_config (guild_id, announce_channel_id, forum_id, updated_by)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        announce_channel_id = VALUES(announce_channel_id),
        forum_id = VALUES(forum_id),
        updated_by = VALUES(updated_by),
        updated_at = CURRENT_TIMESTAMP
    `,
    [key, nextChannelId, nextForumId, updatedBy ? String(updatedBy) : null]
  );

  const updatedConfig = {
    guildId: key,
    announceChannelId: nextChannelId,
    forumId: nextForumId,
    updatedBy: updatedBy ? String(updatedBy) : null,
    updatedAt: new Date()
  };

  configCache.set(key, updatedConfig);
  return updatedConfig;
}

async function clearConfig(guildId) {
  const key = String(guildId);
  const pool = getPool();
  await pool.query('DELETE FROM spectrum_config WHERE guild_id = ?', [key]);
  configCache.delete(key);
}

function getConfigsSnapshot() {
  return Array.from(configCache.values()).map(config => ({ ...config }));
}

module.exports = {
  ensureSchema,
  loadCache,
  fetchConfig,
  setConfig,
  clearConfig,
  getConfigsSnapshot,
  configCache
};
