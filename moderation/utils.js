const { MessageFlags } = require('discord.js');

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
      action ENUM('warn', 'kick', 'ban', 'timeout', 'pardon') NOT NULL,
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
    ALTER TABLE moderation_actions
    MODIFY COLUMN action ENUM('warn', 'kick', 'ban', 'timeout', 'pardon') NOT NULL
  `).catch(err => {
    if (err?.code !== 'ER_BAD_FIELD_ERROR' && err?.code !== 'ER_CANT_MODIFY_USED_TABLE') {
      throw err;
    }
  });
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

function parseReferenceInput(input) {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const urlMatch = trimmed.match(
    /^https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)(?:\/)?$/i
  );
  if (urlMatch) {
    return {
      guildId: urlMatch[1],
      channelId: urlMatch[2],
      messageId: urlMatch[3],
      raw: trimmed
    };
  }

  const idPair = trimmed.match(/^(\d+):(\d+)$/);
  if (idPair) {
    return {
      channelId: idPair[1],
      messageId: idPair[2],
      raw: trimmed
    };
  }

  return { raw: trimmed };
}

async function fetchReferenceMessage(client, guild, reference) {
  if (!reference || !reference.channelId || !reference.messageId || !guild) {
    return { url: reference?.raw ?? null, content: null };
  }

  if (reference.guildId && reference.guildId !== guild.id) {
    return { url: reference.raw, content: null };
  }

  try {
    const channel = await guild.channels.fetch(reference.channelId);
    if (!channel || typeof channel.messages?.fetch !== 'function') {
      return { url: reference.raw, content: null };
    }

    const message = await channel.messages.fetch(reference.messageId);
    if (!message) {
      return { url: reference.raw, content: null };
    }

    const content = typeof message.content === 'string' ? message.content : null;
    return {
      url: `https://discord.com/channels/${guild.id}/${reference.channelId}/${reference.messageId}`,
      content: content ? content.slice(0, 1900) : null
    };
  } catch (err) {
    console.warn('moderation: Failed to fetch reference message', {
      guildId: guild.id,
      channelId: reference.channelId,
      messageId: reference.messageId
    }, err);
    return { url: reference.raw, content: null };
  }
}

function toTimestamp(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatTimestamp(value) {
  const timestamp = toTimestamp(value);
  if (!timestamp) {
    return 'Unknown time';
  }

  const iso = new Date(timestamp).toISOString();
  return iso.replace('T', ' ').replace('Z', ' UTC');
}

function formatReason(reason) {
  if (!reason) {
    return 'No reason provided.';
  }

  const collapsed = reason.replace(/\s+/g, ' ').trim();
  if (!collapsed) {
    return 'No reason provided.';
  }

  if (collapsed.length > 180) {
    return `${collapsed.slice(0, 177)}...`;
  }

  return collapsed;
}

module.exports = {
  respondEphemeral,
  parseReferenceInput,
  fetchReferenceMessage,
  toTimestamp,
  formatTimestamp,
  formatReason,
  ensureSchema,
  loadRoleCache
};
