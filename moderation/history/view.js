const { PermissionFlagsBits } = require('discord.js');
const { getPool } = require('../../database');
const { ACTIONS } = require('../constants');
const { hasActionPermission } = require('../roleCache');
const { toTimestamp, formatTimestamp, formatReason } = require('../utils');

function hasHistoryPermission(guildId, member) {
  if (!member) {
    return false;
  }

  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) {
    return true;
  }

  return Object.keys(ACTIONS).some(action => hasActionPermission(guildId, member, action));
}

function filterEntriesForModerators(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }

  const latestPardon = entries.find(entry => entry.action === 'pardon');
  if (!latestPardon) {
    return entries.filter(entry => entry.action !== 'pardon');
  }

  const cutoff = toTimestamp(latestPardon.created_at);
  if (!cutoff) {
    return entries.filter(entry => entry.action !== 'pardon');
  }

  return entries.filter(entry => entry.action !== 'pardon' && toTimestamp(entry.created_at) > cutoff);
}

function buildHistoryLines(entries) {
  const lines = [];
  let length = 0;
  let truncated = false;

  for (const entry of entries) {
    const verb = entry.action?.toUpperCase?.() || 'UNKNOWN';
    const timestamp = formatTimestamp(entry.created_at);
    const moderator = entry.executor_tag || entry.executor_id || 'Unknown moderator';
    const reason = formatReason(entry.reason);
    const reference = entry.reference_message_url ? ` | Ref: ${entry.reference_message_url}` : '';
    const line = `• ${verb} | ${timestamp} | by ${moderator} | Reason: ${reason}${reference}`;

    if (length + line.length + 1 > 1800) {
      truncated = true;
      break;
    }

    lines.push(line);
    length += line.length + 1;
  }

  return { lines, truncated };
}

async function fetchHistoryRows(guildId, targetId) {
  const pool = getPool();
  const [result] = await pool.query(
    `SELECT action, reason, executor_tag, executor_id, reference_message_url, created_at
     FROM moderation_actions
     WHERE guild_id = ? AND target_id = ?
     ORDER BY created_at DESC`,
    [guildId, targetId]
  );
  return Array.isArray(result) ? result : [];
}

function buildHistoryContent({ targetLabel, rows, isAdministrator }) {
  const visibleEntries = isAdministrator ? rows : filterEntriesForModerators(rows);

  if (visibleEntries.length === 0) {
    return {
      empty: true,
      content: `No moderation history for ${targetLabel} since their last pardon.`
    };
  }

  const { lines, truncated } = buildHistoryLines(visibleEntries);
  let content = `Moderation history for ${targetLabel}:\n${lines.join('\n')}`;
  if (truncated) {
    content += '\nAdditional records were omitted for length.';
  }

  return { empty: false, content };
}

module.exports = {
  hasHistoryPermission,
  filterEntriesForModerators,
  buildHistoryLines,
  buildHistoryContent,
  fetchHistoryRows
};
