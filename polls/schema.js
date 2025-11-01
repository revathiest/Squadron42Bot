const { getPool } = require('../database');

async function ensureSchema(pool = getPool()) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS polls (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      guild_id VARCHAR(20) NOT NULL,
      channel_id VARCHAR(20) NOT NULL,
      message_id VARCHAR(20) DEFAULT NULL,
      owner_id VARCHAR(20) NOT NULL,
      question VARCHAR(512) NOT NULL,
      is_multi TINYINT(1) NOT NULL DEFAULT 0,
      expires_at DATETIME NOT NULL,
      closed_at DATETIME DEFAULT NULL,
      closed_by VARCHAR(20) DEFAULT NULL,
      closed_reason ENUM('expired', 'manual') DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_polls_guild (guild_id),
      KEY idx_polls_expires (expires_at),
      KEY idx_polls_message (message_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS poll_options (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      poll_id BIGINT UNSIGNED NOT NULL,
      position INT NOT NULL,
      label VARCHAR(256) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_poll_options_poll (poll_id),
      CONSTRAINT fk_poll_options_poll
        FOREIGN KEY (poll_id) REFERENCES polls(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS poll_votes (
      poll_id BIGINT UNSIGNED NOT NULL,
      option_id BIGINT UNSIGNED NOT NULL,
      user_id VARCHAR(20) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (poll_id, option_id, user_id),
      KEY idx_poll_votes_option (option_id),
      CONSTRAINT fk_poll_votes_poll
        FOREIGN KEY (poll_id) REFERENCES polls(id)
        ON DELETE CASCADE,
      CONSTRAINT fk_poll_votes_option
        FOREIGN KEY (option_id) REFERENCES poll_options(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS poll_allowed_roles (
      guild_id VARCHAR(20) NOT NULL,
      role_id VARCHAR(20) NOT NULL,
      created_by VARCHAR(20) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, role_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}

module.exports = {
  ensureSchema
};
