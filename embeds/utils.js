const { EmbedBuilder } = require('discord.js');
const http = require('node:http');
const https = require('node:https');
const { getPool } = require('../database');

const MAX_TEMPLATE_BYTES = 128 * 1024; // 128 KB ceiling per template file.
const NAMED_COLORS = {
  red: 0xed4245,
  blue: 0x3b82f6,
  green: 0x2ecc71,
  gold: 0xf59e0b,
  orange: 0xf97316,
  purple: 0x9b59b6,
  teal: 0x14b8a6,
  aqua: 0x1abc9c,
  yellow: 0xf1c40f,
  white: 0xffffff,
  black: 0x000000,
  gray: 0x95a5a6,
  grey: 0x95a5a6,
  silver: 0xbdc3c7,
  navy: 0x1f2937,
  cyan: 0x22d3ee,
  pink: 0xec4899
};

const allowedRoleCache = new Map();

function getAllowedRoleSet(guildId) {
  if (!allowedRoleCache.has(guildId)) {
    allowedRoleCache.set(guildId, new Set());
  }
  return allowedRoleCache.get(guildId);
}

function clearRoleCache() {
  allowedRoleCache.clear();
}

function addRoleToCache(guildId, roleId) {
  const set = getAllowedRoleSet(guildId);
  set.add(roleId);
}

function removeRoleFromCache(guildId, roleId) {
  if (!allowedRoleCache.has(guildId)) {
    return;
  }
  const set = allowedRoleCache.get(guildId);
  set.delete(roleId);
  if (set.size === 0) {
    allowedRoleCache.delete(guildId);
  }
}

async function ensureSchema(pool = getPool()) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS embed_allowed_roles (
      guild_id VARCHAR(20) NOT NULL,
      role_id VARCHAR(20) NOT NULL,
      created_by VARCHAR(20) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, role_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}

async function loadRoleCache(pool = getPool()) {
  clearRoleCache();
  const [rows] = await pool.query('SELECT guild_id, role_id FROM embed_allowed_roles');
  for (const row of rows) {
    addRoleToCache(row.guild_id, row.role_id);
  }
}

async function allowRoleForGuild(guildId, roleId, actorId, pool = getPool()) {
  await ensureSchema(pool);
  const current = getAllowedRoleSet(guildId);
  if (current.has(roleId)) {
    return false;
  }

  await pool.query(
    `INSERT INTO embed_allowed_roles (guild_id, role_id, created_by)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE created_at = created_at`,
    [guildId, roleId, actorId ?? null]
  );

  addRoleToCache(guildId, roleId);
  return true;
}

async function removeRoleForGuild(guildId, roleId, pool = getPool()) {
  await ensureSchema(pool);
  const [result] = await pool.query(
    'DELETE FROM embed_allowed_roles WHERE guild_id = ? AND role_id = ?',
    [guildId, roleId]
  );

  if (result?.affectedRows) {
    removeRoleFromCache(guildId, roleId);
    return true;
  }

  return false;
}

function listAllowedRoles(guildId) {
  const set = allowedRoleCache.get(guildId);
  if (!set) {
    return [];
  }
  return Array.from(set);
}

function canMemberUseTemplates(member) {
  if (!member || !member.guild) {
    return false;
  }

  const allowed = allowedRoleCache.get(member.guild.id);
  if (!allowed || allowed.size === 0) {
    return false;
  }

  const roleCache = member.roles?.cache;
  if (!roleCache) {
    return false;
  }

  const roleMatcher = (candidate) => {
    const roleId = typeof candidate === 'string' ? candidate : candidate?.id;
    return roleId && allowed.has(roleId);
  };

  if (typeof roleCache.has === 'function') {
    for (const roleId of allowed) {
      if (roleCache.has(roleId)) {
        return true;
      }
    }
  } else if (typeof roleCache.some === 'function') {
    if (roleCache.some(roleMatcher)) {
      return true;
    }
  } else if (Array.isArray(roleCache)) {
    if (roleCache.some(roleMatcher)) {
      return true;
    }
  }

  return false;
}

function createEmptyState() {
  return {
    title: null,
    url: null,
    color: null,
    descriptionLines: [],
    fields: [],
    thumbnail: null,
    image: null,
    author: null, // { name, url, icon }
    footer: null, // { text, icon }
    timestamp: null
  };
}

function embedHasContent(state) {
  if (!state) {
    return false;
  }

  if (state.title || state.url || state.color || state.thumbnail || state.image || state.author || state.footer || state.timestamp) {
    return true;
  }

  if (state.fields.length > 0) {
    return true;
  }

  const description = (state.descriptionLines || []).join('\n').trim();
  return Boolean(description);
}

function parseColor(input) {
  if (!input) {
    return null;
  }

  const value = input.trim().toLowerCase();
  if (!value) {
    return null;
  }

  if (NAMED_COLORS[value] !== undefined) {
    return NAMED_COLORS[value];
  }

  const hexMatch = value.match(/^#?([0-9a-f]{6})$/i);
  if (hexMatch) {
    return parseInt(hexMatch[1], 16);
  }

  throw new Error(`Unsupported color value "${input}". Use a hex code (e.g. #FF9900) or one of: ${Object.keys(NAMED_COLORS).join(', ')}`);
}

function normaliseLine(line) {
  return typeof line === 'string' ? line.replace(/\r?\n/g, '').trim() : '';
}

function parseField(line) {
  const match = line.match(/^\*\s*([^*]+?):\*\s*(.*)$/);
  if (!match) {
    return null;
  }

  const name = match[1].trim();
  if (!name) {
    throw new Error('Field name cannot be empty.');
  }

  let rawValue = match[2].trim();
  let inline = false;
  const inlineMatch = rawValue.match(/\|\s*inline$/i);
  if (inlineMatch) {
    inline = true;
    rawValue = rawValue.slice(0, inlineMatch.index).trim();
  }

  if (!rawValue) {
    throw new Error(`Field "${name}" must include a value.`);
  }

  return { name, value: rawValue, inline };
}

function applyFooter(state, value) {
  const parts = value.split('|').map(part => part.trim()).filter(Boolean);
  const text = parts[0] || '';
  const icon = parts[1] || null;

  if (!text) {
    throw new Error('Footer text cannot be empty.');
  }

  state.footer = { text, icon };
}

function applyAuthor(state, value) {
  const parts = value.split('|').map(part => part.trim());
  const name = parts[0];
  if (!name) {
    throw new Error('Author directive requires a name.');
  }

  state.author = {
    name,
    url: parts[1] || null,
    icon: parts[2] || null
  };
}

function parseTimestamp(value) {
  if (!value) {
    throw new Error('Timestamp value cannot be empty.');
  }

  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'now' || trimmed === 'current' || trimmed === 'auto') {
    return new Date();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid timestamp "${value}". Use "now" or an ISO date like 2024-03-25T18:30:00Z.`);
  }

  return parsed;
}

function finaliseState(state, output) {
  if (!embedHasContent(state)) {
    return;
  }

  const embed = new EmbedBuilder();

  if (state.title) {
    embed.setTitle(state.title);
  }

  if (state.url) {
    embed.setURL(state.url);
  }

  if (state.color) {
    embed.setColor(state.color);
  }

  const description = state.descriptionLines.join('\n').trim();
  if (description) {
    embed.setDescription(description);
  }

  for (const field of state.fields) {
    embed.addFields({ name: field.name, value: field.value, inline: field.inline });
  }

  if (state.thumbnail) {
    embed.setThumbnail(state.thumbnail);
  }

  if (state.image) {
    embed.setImage(state.image);
  }

  if (state.author) {
    const parts = {};
    if (state.author.name) {
      parts.name = state.author.name;
    }
    if (state.author.url) {
      parts.url = state.author.url;
    }
    if (state.author.icon) {
      parts.iconURL = state.author.icon;
    }
    embed.setAuthor(parts);
  }

  if (state.footer) {
    const footerData = { text: state.footer.text };
    if (state.footer.icon) {
      footerData.iconURL = state.footer.icon;
    }
    embed.setFooter(footerData);
  }

  if (state.timestamp) {
    embed.setTimestamp(state.timestamp);
  }

  output.push(embed);
}

function parseTemplateText(rawText) {
  if (typeof rawText !== 'string') {
    throw new Error('Template content must be text.');
  }

  const text = rawText.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const embeds = [];
  let state = createEmptyState();

  const findNextNonEmpty = (startIndex) => {
    for (let i = startIndex; i < lines.length; i += 1) {
      const trimmed = lines[i].trim();
      if (trimmed.length === 0) {
        continue;
      }
      return trimmed;
    }
    return null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const original = lines[i];
    const trimmed = original.trim();

    if (!trimmed) {
      state.descriptionLines.push('');
      continue;
    }

    if (/^#\s*Title\s*:/i.test(trimmed)) {
      if (embedHasContent(state)) {
        finaliseState(state, embeds);
        state = createEmptyState();
      }
      state.title = trimmed.replace(/^#\s*Title\s*:/i, '').trim();
      continue;
    }

    const directiveMatch = trimmed.match(/^@\s*([a-z-]+)\s*:\s*(.+)$/i);
    if (directiveMatch) {
      const key = directiveMatch[1].toLowerCase();
      const value = directiveMatch[2].trim();
      switch (key) {
        case 'color':
          state.color = parseColor(value);
          break;
        case 'thumbnail':
          state.thumbnail = value;
          break;
        case 'image':
          state.image = value;
          break;
        case 'author':
          applyAuthor(state, value);
          break;
        case 'url':
          state.url = value;
          break;
        case 'timestamp':
          state.timestamp = parseTimestamp(value);
          break;
        default:
          throw new Error(`Unknown directive "@${key}".`);
      }
      continue;
    }

    if (trimmed === '---') {
      const upcoming = findNextNonEmpty(i + 1);
      if (upcoming && /^Footer\s*:/i.test(upcoming)) {
        continue;
      }

      // Treat as an embed separator.
      finaliseState(state, embeds);
      state = createEmptyState();
      continue;
    }

    if (/^Footer\s*:/i.test(trimmed)) {
      applyFooter(state, trimmed.replace(/^Footer\s*:/i, '').trim());
      continue;
    }

    const field = parseField(trimmed);
    if (field) {
      state.fields.push(field);
      continue;
    }

    // All other lines belong to the description.
    state.descriptionLines.push(original);
  }

  finaliseState(state, embeds);

  if (embeds.length > 10) {
    throw new Error('Discord only supports up to 10 embeds per message. Please split your template into multiple files.');
  }

  return embeds;
}

function buildEmbedsFromText(rawText) {
  return parseTemplateText(rawText);
}

function isLikelyTemplate(text) {
  if (typeof text !== 'string') {
    return false;
  }

  const content = text.trim();
  if (!content) {
    return false;
  }

  const directivePattern = /^@\s*[a-z-]+\s*:/im;
  const titlePattern = /^#\s*Title\s*:/im;
  const footerPattern = /^Footer\s*:/im;
  const fieldPattern = /^\*\s*[^*]+:\*\s+/im;

  return (
    directivePattern.test(content) ||
    titlePattern.test(content) ||
    footerPattern.test(content) ||
    fieldPattern.test(content)
  );
}

function isTemplateAttachment(attachment) {
  if (!attachment || typeof attachment !== 'object') {
    return false;
  }

  const name = (attachment.name || '').toLowerCase();
  const contentType = (attachment.contentType || '').toLowerCase();

  if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.markdown')) {
    return true;
  }

  if (contentType.startsWith('text/')) {
    return true;
  }

  return false;
}

function downloadAttachmentText(url) {
  return new Promise((resolve, reject) => {
    if (typeof url !== 'string' || url.length === 0) {
      reject(new Error('Attachment URL is missing.'));
      return;
    }

    const client = url.startsWith('https') ? https : http;
    const request = client.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 400) {
        reject(new Error(`Failed to download template (HTTP ${response.statusCode}).`));
        response.resume();
        return;
      }

      let total = 0;
      const chunks = [];
      response.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_TEMPLATE_BYTES) {
          request.destroy();
          reject(new Error('Template file is too large (limit 128 KB).'));
          return;
        }
        chunks.push(chunk);
      });

      response.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });

    request.on('error', (err) => reject(err));
  });
}

module.exports = {
  ensureSchema,
  loadRoleCache,
  allowRoleForGuild,
  removeRoleForGuild,
  listAllowedRoles,
  canMemberUseTemplates,
  clearRoleCache,
  buildEmbedsFromText,
  downloadAttachmentText,
  isTemplateAttachment,
  parseTemplateText,
  parseColor,
  isLikelyTemplate,
  __testables: {
    NAMED_COLORS,
    allowedRoleCache,
    clearRoleCache,
    addRoleToCache,
    removeRoleFromCache
  }
};
