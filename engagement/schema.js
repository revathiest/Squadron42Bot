const { getPool } = require('../database');

async function ensureColumn(pool, table, column, definition) {
  const [rows] = await pool.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
  if (!rows.length) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

async function ensureSchema() {
  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS engagement_scores (
      guild_id VARCHAR(32) NOT NULL,
      user_id VARCHAR(32) NOT NULL,
      active_points INT NOT NULL DEFAULT 0,
      current_level INT NOT NULL DEFAULT 0,
      last_awarded_at DATETIME NULL,
      PRIMARY KEY (guild_id, user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS engagement_events (
      guild_id VARCHAR(32) NOT NULL,
      message_id VARCHAR(32) NOT NULL,
      engagement_type VARCHAR(16) NOT NULL,
      source_user_id VARCHAR(32) NOT NULL,
      target_user_id VARCHAR(32) NOT NULL,
      points INT NOT NULL DEFAULT 0,
      active TINYINT(1) NOT NULL DEFAULT 0,
      reaction_count INT NOT NULL DEFAULT 0,
      last_triggered_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, message_id, engagement_type, source_user_id, target_user_id),
      INDEX idx_engagement_target (guild_id, target_user_id),
      INDEX idx_engagement_cooldown (guild_id, source_user_id, target_user_id, last_triggered_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await ensureColumn(pool, 'engagement_events', 'emoji_id', "emoji_id VARCHAR(64) DEFAULT NULL");
  await ensureColumn(pool, 'engagement_events', 'emoji_name', "emoji_name VARCHAR(191) DEFAULT NULL");
  await ensureColumn(pool, 'engagement_events', 'emoji_type', "emoji_type VARCHAR(16) DEFAULT NULL");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS engagement_config (
      guild_id VARCHAR(32) NOT NULL,
      reaction_points INT NOT NULL DEFAULT 1,
      reply_points INT NOT NULL DEFAULT 5,
      cooldown_seconds INT NOT NULL DEFAULT 60,
      announce_channel_id VARCHAR(32) DEFAULT NULL,
      announce_enabled TINYINT(1) NOT NULL DEFAULT 0,
      dm_enabled TINYINT(1) NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS engagement_levels (
      guild_id VARCHAR(32) NOT NULL,
      level_rank INT NOT NULL,
      level_name VARCHAR(191) NOT NULL,
      points_required INT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, level_rank),
      UNIQUE KEY idx_points_unique (guild_id, points_required)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

module.exports = {
  ensureSchema
};
