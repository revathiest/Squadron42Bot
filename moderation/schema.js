const { addRoleToCache, roleCache } = require('./roleCache');

/* istanbul ignore next */
async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS moderation_roles (
      guild_id VARCHAR(20) NOT NULL,
      action ENUM('warn', 'kick', 'ban') NOT NULL,
      role_id VARCHAR(20) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, action, role_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS moderation_actions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      guild_id VARCHAR(20) NOT NULL,
      action ENUM('warn', 'kick', 'ban', 'pardon') NOT NULL,
      target_id VARCHAR(20) NOT NULL,
      target_tag VARCHAR(40) DEFAULT NULL,
      executor_id VARCHAR(20) NOT NULL,
      executor_tag VARCHAR(40) DEFAULT NULL,
      reason TEXT NOT NULL,
      reference_message_url TEXT DEFAULT NULL,
      reference_message_content TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    ALTER TABLE moderation_actions
    MODIFY COLUMN action ENUM('warn', 'kick', 'ban', 'pardon') NOT NULL
  `).catch(err => {
    if (err?.code !== 'ER_BAD_FIELD_ERROR' && err?.code !== 'ER_CANT_MODIFY_USED_TABLE') {
      throw err;
    }
  });
}

/* istanbul ignore next */
async function loadRoleCache(pool) {
  roleCache.clear();
  const [rows] = await pool.query('SELECT guild_id, action, role_id FROM moderation_roles');
  for (const row of rows) {
    addRoleToCache(row.guild_id, row.action, row.role_id);
  }
}

module.exports = {
  ensureSchema,
  loadRoleCache
};
