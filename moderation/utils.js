const { MessageFlags } = require('discord.js');
const { getPool } = require('../database');

let rolesModule;

function getRolesModule() {
  if (!rolesModule) {
    rolesModule = require('./handlers/roles');
  }
  return rolesModule;
}

/* istanbul ignore next */
async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS moderation_roles (
      guild_id VARCHAR(20) NOT NULL,
      action VARCHAR(20) NOT NULL,
      role_id VARCHAR(20) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, action, role_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS moderation_actions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      guild_id VARCHAR(20) NOT NULL,
      action VARCHAR(20) NOT NULL,
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
    CREATE TABLE IF NOT EXISTS moderation_config (
      guild_id VARCHAR(20) NOT NULL PRIMARY KEY,
      trap_role_id VARCHAR(20) DEFAULT NULL,
      updated_by VARCHAR(20) DEFAULT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS moderation_org_posts (
      guild_id VARCHAR(20) NOT NULL,
      org_code VARCHAR(64) NOT NULL,
      channel_id VARCHAR(20) NOT NULL,
      message_id VARCHAR(20) NOT NULL,
      author_id VARCHAR(20) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, org_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS moderation_org_forum_channels (
      guild_id VARCHAR(20) NOT NULL,
      channel_id VARCHAR(20) NOT NULL,
      created_by VARCHAR(20) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, channel_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    ALTER TABLE moderation_roles
    MODIFY COLUMN action VARCHAR(20) NOT NULL
  `).catch(err => {
    if (err?.code !== 'ER_BAD_FIELD_ERROR' && err?.code !== 'ER_CANT_MODIFY_USED_TABLE') {
      throw err;
    }
  });
}

/* istanbul ignore next */
async function loadRoleCache(pool) {
  const { roleCache, addRoleToCache } = getRolesModule();
  roleCache.clear();
  const [rows] = await pool.query('SELECT guild_id, action, role_id FROM moderation_roles');
  for (const row of rows) {
    addRoleToCache(row.guild_id, row.action, row.role_id);
  }
}

async function respondEphemeral(interaction, payload) {
  if (!interaction) {
    return;
  }

  const response = typeof payload === 'string'
    ? { content: payload, flags: MessageFlags.Ephemeral }
    : { ...payload, flags: MessageFlags.Ephemeral };

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(response).catch(() => null);
  }

  return interaction.reply(response).catch(() => null);
}

async function logAction({ guildId, action, targetUser, moderator, reason }) {
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO moderation_actions
         (guild_id, action, target_id, target_tag, executor_id, executor_tag, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        guildId,
        action,
        targetUser.id,
        targetUser.tag ?? targetUser.username ?? null,
        moderator.id,
        moderator.tag ?? moderator.username ?? null,
        reason,
      ]
    );
  } catch (err) {
    console.error('moderation: failed to log action', { guildId, action, targetId: targetUser.id }, err);
  }
}

module.exports = {
  respondEphemeral,
  ensureSchema,
  loadRoleCache,
  logAction,
};
