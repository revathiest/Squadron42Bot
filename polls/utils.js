const { Collection, MessageFlags } = require('discord.js');
const crypto = require('node:crypto');
const { getPool } = require('../database');
const { ensureSchema } = require('./schema');

const allowedRoleCache = new Map(); // guildId -> Set(roleId)

function getAllowedRoleSet(guildId) {
  if (!allowedRoleCache.has(guildId)) {
    allowedRoleCache.set(guildId, new Set());
  }
  return allowedRoleCache.get(guildId);
}

function clearRoleCache() {
  allowedRoleCache.clear();
}

async function loadRoleCache(pool = getPool()) {
  clearRoleCache();
  const [rows] = await pool.query('SELECT guild_id, role_id FROM poll_allowed_roles');
  for (const row of rows) {
    getAllowedRoleSet(row.guild_id).add(row.role_id);
  }
}

async function allowRoleForGuild(guildId, roleId, actorId, pool = getPool()) {
  await ensureSchema(pool);
  const roles = getAllowedRoleSet(guildId);
  if (roles.has(roleId)) {
    return false;
  }

  await pool.query(
    `INSERT INTO poll_allowed_roles (guild_id, role_id, created_by)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE created_at = created_at`,
    [guildId, roleId, actorId ?? null]
  );
  roles.add(roleId);
  return true;
}

async function removeRoleForGuild(guildId, roleId, pool = getPool()) {
  await ensureSchema(pool);
  const [result] = await pool.query(
    'DELETE FROM poll_allowed_roles WHERE guild_id = ? AND role_id = ?',
    [guildId, roleId]
  );
  if (result?.affectedRows) {
    const roles = allowedRoleCache.get(guildId);
    if (roles) {
      roles.delete(roleId);
      if (roles.size === 0) {
        allowedRoleCache.delete(guildId);
      }
    }
    return true;
  }
  return false;
}

function listAllowedRoles(guildId) {
  const roles = allowedRoleCache.get(guildId);
  if (!roles) {
    return [];
  }
  return Array.from(roles.values());
}

function memberHasAllowedRole(member) {
  const allowed = allowedRoleCache.get(member.guild.id);
  if (!allowed || allowed.size === 0) {
    return false;
  }
  const memberRoles = member.roles?.cache instanceof Collection ? member.roles.cache : new Collection(member.roles ?? []);
  return memberRoles.some(role => allowed.has(role.id));
}

function canMemberCreatePoll(member) {
  if (!member) {
    return false;
  }

  return memberHasAllowedRole(member);
}

function hasConfiguredPollRoles(guildId) {
  return (allowedRoleCache.get(guildId)?.size ?? 0) > 0;
}

function canMemberClosePoll(member, poll) {
  if (!member) {
    return false;
  }
  if (poll?.owner_id && member.id === poll.owner_id) {
    return true;
  }
  return memberHasAllowedRole(member);
}

function parseDurationComponent(token) {
  const match = token.trim().match(/^(\d+)\s*(d|day|days|h|hour|hours|m|min|mins|minute|minutes)$/i);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (Number.isNaN(value) || value <= 0) {
    return null;
  }

  if (unit.startsWith('d')) {
    return value * 24 * 60 * 60 * 1000;
  }
  if (unit.startsWith('h')) {
    return value * 60 * 60 * 1000;
  }
  return value * 60 * 1000;
}

function parseExpirationInput(raw, now = new Date()) {
  if (typeof raw !== 'string') {
    return null;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const durationTokens = trimmed.split(/[,;]/).flatMap(part => part.trim().split(/\s+/)).filter(Boolean);
  let totalMs = 0;
  let parsedDuration = true;
  if (durationTokens.length > 0) {
    for (const token of durationTokens) {
      const componentMs = parseDurationComponent(token);
      if (!componentMs) {
        parsedDuration = false;
        break;
      }
      totalMs += componentMs;
    }
  } else {
    parsedDuration = false;
  }

  if (parsedDuration && totalMs > 0) {
    const expiry = new Date(now.getTime() + totalMs);
    return expiry;
  }

  // Try absolute timestamp parsing.
  const isoCandidate = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  const parsedDate = new Date(isoCandidate);
  if (!Number.isNaN(parsedDate.getTime())) {
    return parsedDate;
  }

  return null;
}

function validateExpiration(expiry, now = new Date()) {
  if (!(expiry instanceof Date) || Number.isNaN(expiry.getTime())) {
    return { ok: false, error: 'Unable to parse the expiration time. Try a duration like "2h 30m" or an ISO timestamp.' };
  }

  const minMs = 60 * 1000; // 1 minute
  const maxMs = 30 * 24 * 60 * 60 * 1000; // 30 days
  const diff = expiry.getTime() - now.getTime();
  if (diff < minMs) {
    return { ok: false, error: 'The poll must last at least one minute.' };
  }
  if (diff > maxMs) {
    return { ok: false, error: 'Polls may not last longer than 30 days.' };
  }
  return { ok: true, value: expiry };
}

function formatCountdown(expiry, now = new Date()) {
  const diffMs = expiry.getTime() - now.getTime();
  const seconds = Math.max(0, Math.floor(diffMs / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (parts.length === 0) {
    parts.push(`${seconds % 60}s`);
  }
  return parts.join(' ');
}

function generateSessionId() {
  return crypto.randomUUID();
}

module.exports = {
  MessageFlags,
  allowRoleForGuild,
  removeRoleForGuild,
  listAllowedRoles,
  canMemberCreatePoll,
  hasConfiguredPollRoles,
  canMemberClosePoll,
  loadRoleCache,
  clearRoleCache,
  parseExpirationInput,
  validateExpiration,
  formatCountdown,
  generateSessionId
};
