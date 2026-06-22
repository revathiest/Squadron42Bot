const { getPool } = require('../database');

async function ensureSchema() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS spam_config (
      guild_id              VARCHAR(30)           NOT NULL,
      enabled               TINYINT(1)            NOT NULL DEFAULT 0,
      alert_channel_id      VARCHAR(30),
      rate_limit_count      INT                   NOT NULL DEFAULT 5,
      rate_limit_window_ms  INT                   NOT NULL DEFAULT 5000,
      auto_action           ENUM('timeout','ban') NOT NULL DEFAULT 'timeout',
      timeout_duration_ms   BIGINT                NOT NULL DEFAULT 3600000,
      whitelist_role_ids    TEXT,
      whitelist_channel_ids TEXT,
      new_account_days      INT                   NOT NULL DEFAULT 3,
      PRIMARY KEY (guild_id)
    )
  `);
}

module.exports = { ensureSchema };
