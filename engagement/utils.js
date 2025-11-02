const { EmbedBuilder } = require('discord.js');
const { getPool } = require('../database');

const DEFAULT_REACTION_POINTS = 1;
const DEFAULT_REPLY_POINTS = 5;
const DEFAULT_COOLDOWN_SECONDS = 60;

const CONFIG_CACHE = new Map();
const LEVEL_CACHE = new Map();

function normalizeConfigRow(row) {
  if (!row) {
    return {
      reactionPoints: DEFAULT_REACTION_POINTS,
      replyPoints: DEFAULT_REPLY_POINTS,
      cooldownSeconds: DEFAULT_COOLDOWN_SECONDS,
      announceChannelId: null,
      announceEnabled: false,
      dmEnabled: false
    };
  }

  return {
    reactionPoints: Number(row.reaction_points ?? DEFAULT_REACTION_POINTS),
    replyPoints: Number(row.reply_points ?? DEFAULT_REPLY_POINTS),
    cooldownSeconds: Number(row.cooldown_seconds ?? DEFAULT_COOLDOWN_SECONDS),
    announceChannelId: row.announce_channel_id ?? null,
    announceEnabled: Boolean(row.announce_enabled),
    dmEnabled: Boolean(row.dm_enabled)
  };
}

async function getGuildConfig(guildId) {
  if (CONFIG_CACHE.has(guildId)) {
    return CONFIG_CACHE.get(guildId);
  }

  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT reaction_points, reply_points, cooldown_seconds, announce_channel_id, announce_enabled, dm_enabled FROM engagement_config WHERE guild_id = ? LIMIT 1',
    [guildId]
  );

  const config = normalizeConfigRow(rows[0]);
  CONFIG_CACHE.set(guildId, config);
  return config;
}

async function upsertConfig(guildId, updates) {
  const pool = getPool();
  const current = await getGuildConfig(guildId);
  const next = { ...current, ...updates };

  await pool.query(
    `INSERT INTO engagement_config (
      guild_id, reaction_points, reply_points, cooldown_seconds, announce_channel_id, announce_enabled, dm_enabled
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      reaction_points = VALUES(reaction_points),
      reply_points = VALUES(reply_points),
      cooldown_seconds = VALUES(cooldown_seconds),
      announce_channel_id = VALUES(announce_channel_id),
      announce_enabled = VALUES(announce_enabled),
      dm_enabled = VALUES(dm_enabled)`,
    [
      guildId,
      next.reactionPoints,
      next.replyPoints,
      next.cooldownSeconds,
      next.announceChannelId,
      next.announceEnabled ? 1 : 0,
      next.dmEnabled ? 1 : 0
    ]
  );

  CONFIG_CACHE.set(guildId, next);
  return next;
}

async function getGuildLevels(guildId) {
  if (LEVEL_CACHE.has(guildId)) {
    return LEVEL_CACHE.get(guildId);
  }

  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT level_rank, level_name, points_required
     FROM engagement_levels
     WHERE guild_id = ?
     ORDER BY points_required ASC`,
    [guildId]
  );

  const levels = rows.map(row => ({
    levelRank: Number(row.level_rank),
    levelName: row.level_name,
    pointsRequired: Number(row.points_required)
  }));

  LEVEL_CACHE.set(guildId, levels);
  return levels;
}

function clearLevelCache(guildId) {
  if (guildId) {
    LEVEL_CACHE.delete(guildId);
  } else {
    LEVEL_CACHE.clear();
  }
}

async function upsertLevelDefinition(guildId, { levelRank, levelName, pointsRequired }) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO engagement_levels (guild_id, level_rank, level_name, points_required)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       level_name = VALUES(level_name),
       points_required = VALUES(points_required)`,
    [guildId, levelRank, levelName, pointsRequired]
  );

  clearLevelCache(guildId);
  return getGuildLevels(guildId);
}

async function removeLevelDefinition(guildId, levelRank) {
  const pool = getPool();
  const [result] = await pool.query(
    'DELETE FROM engagement_levels WHERE guild_id = ? AND level_rank = ?',
    [guildId, levelRank]
  );

  clearLevelCache(guildId);
  return result.affectedRows > 0;
}

async function listLevelDefinitions(guildId) {
  return getGuildLevels(guildId);
}

const LEVEL_BASE = 25;
const LEVEL_EXPONENT = 1.5;

function getThresholdForLevel(level) {
  return Math.max(1, Math.round(LEVEL_BASE * Math.pow(level, LEVEL_EXPONENT)));
}

function getNextThreshold(currentLevel) {
  return getThresholdForLevel(currentLevel + 1);
}

function fallbackLevelName(levelRank) {
  return levelRank === 0 ? 'Unranked' : `Level ${levelRank}`;
}

function resolveLevelName(levels, levelRank) {
  if (!levels || !levels.length) {
    return fallbackLevelName(levelRank);
  }

  const match = levels.find(level => level.levelRank === levelRank);
  return match ? match.levelName : fallbackLevelName(levelRank);
}

async function computeLevelState(guildId, activePoints, currentLevel) {
  const levels = await getGuildLevels(guildId);

  if (!levels.length) {
    let newLevel = currentLevel;
    let nextThreshold = getThresholdForLevel(newLevel + 1);

    while (activePoints >= nextThreshold) {
      newLevel += 1;
      nextThreshold = getThresholdForLevel(newLevel + 1);
    }

    return {
      newLevel,
      levelName: fallbackLevelName(newLevel),
      nextThreshold,
      nextLevelName: fallbackLevelName(newLevel + 1)
    };
  }

  let newLevel = currentLevel;
  let levelName = levels.find(level => level.levelRank === currentLevel)?.levelName ?? fallbackLevelName(currentLevel);

  for (const level of levels) {
    if (activePoints >= level.pointsRequired && level.levelRank > newLevel) {
      newLevel = level.levelRank;
      levelName = level.levelName;
    }
  }

  let nextLevel = levels
    .filter(level => level.levelRank > newLevel)
    .sort((a, b) => a.pointsRequired - b.pointsRequired)[0];

  if (!nextLevel && newLevel === 0 && levels.length) {
    nextLevel = levels[0];
  }

  return {
    newLevel,
    levelName,
    nextThreshold: nextLevel ? nextLevel.pointsRequired : null,
    nextLevelName: nextLevel ? nextLevel.levelName : null
  };
}

async function addPoints(guildId, userId, points) {
  const pool = getPool();

  await pool.query(
    `INSERT INTO engagement_scores (guild_id, user_id, active_points, current_level, last_awarded_at)
     VALUES (?, ?, ?, 0, NOW())
     ON DUPLICATE KEY UPDATE
       active_points = engagement_scores.active_points + VALUES(active_points),
       last_awarded_at = NOW()`,
    [guildId, userId, points]
  );

  const [rows] = await pool.query(
    'SELECT active_points, current_level FROM engagement_scores WHERE guild_id = ? AND user_id = ? LIMIT 1',
    [guildId, userId]
  );

  if (!rows.length) {
    return { levelUp: false, newLevel: 0, levelName: fallbackLevelName(0), activePoints: 0, nextThreshold: getNextThreshold(0), nextLevelName: fallbackLevelName(1) };
  }

  const activePoints = Number(rows[0].active_points ?? 0);
  const currentLevel = Number(rows[0].current_level ?? 0);

  const levelState = await computeLevelState(guildId, activePoints, currentLevel);
  const { newLevel, levelName, nextThreshold, nextLevelName } = levelState;

  if (newLevel > currentLevel) {
    await pool.query(
      'UPDATE engagement_scores SET current_level = ?, last_awarded_at = NOW() WHERE guild_id = ? AND user_id = ?',
      [newLevel, guildId, userId]
    );
    return { levelUp: true, newLevel, levelName, activePoints, nextThreshold, nextLevelName };
  }

  return { levelUp: false, newLevel: currentLevel, levelName: fallbackLevelName(currentLevel), activePoints, nextThreshold, nextLevelName };
}

async function removePoints(guildId, userId, points) {
  if (points <= 0) {
    return;
  }

  const pool = getPool();
  await pool.query(
    'UPDATE engagement_scores SET active_points = GREATEST(active_points - ?, 0) WHERE guild_id = ? AND user_id = ?',
    [points, guildId, userId]
  );
}

function calculateCooldownStatus(lastTriggered, cooldownSeconds) {
  if (!lastTriggered) {
    return { cooledDown: true, secondsSince: Infinity };
  }

  const now = Date.now();
  const elapsed = Math.floor((now - new Date(lastTriggered).getTime()) / 1000);
  return {
    cooledDown: elapsed >= cooldownSeconds,
    secondsSince: elapsed
  };
}

async function recordReactionAdd({ guildId, messageId, targetUserId, sourceUserId, points, cooldownSeconds, emojiId, emojiName, emojiType }) {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT active, reaction_count, last_triggered_at, points
     FROM engagement_events
     WHERE guild_id = ? AND message_id = ? AND engagement_type = 'reaction'
       AND source_user_id = ? AND target_user_id = ?
     LIMIT 1`,
    [guildId, messageId, sourceUserId, targetUserId]
  );

  const now = new Date();

  if (!rows.length) {
    await pool.query(
      `INSERT INTO engagement_events
        (guild_id, message_id, engagement_type, source_user_id, target_user_id, points, active, reaction_count, last_triggered_at, emoji_id, emoji_name, emoji_type, created_at, updated_at)
       VALUES (?, ?, 'reaction', ?, ?, ?, 1, 1, ?, ?, ?, ?, NOW(), NOW())`,
      [guildId, messageId, sourceUserId, targetUserId, points, now, emojiId ?? null, emojiName ?? null, emojiType ?? null]
    );

    const score = await addPoints(guildId, targetUserId, points);
    return { awarded: true, ...score };
  }

  const existing = rows[0];
  const reactionCount = Number(existing.reaction_count ?? 0) + 1;
  const wasActive = Boolean(existing.active);
  const cooldown = calculateCooldownStatus(existing.last_triggered_at, cooldownSeconds);
  const shouldAward = !wasActive && cooldown.cooledDown && points > 0;
  const nextActive = wasActive || shouldAward;
  const lastTriggered = shouldAward ? now : existing.last_triggered_at;

  await pool.query(
    `UPDATE engagement_events
     SET reaction_count = ?, active = ?, points = ?, last_triggered_at = ?, emoji_id = ?, emoji_name = ?, emoji_type = ?, updated_at = NOW()
     WHERE guild_id = ? AND message_id = ? AND engagement_type = 'reaction'
       AND source_user_id = ? AND target_user_id = ?`,
    [reactionCount, nextActive ? 1 : 0, points, lastTriggered, emojiId ?? null, emojiName ?? null, emojiType ?? null, guildId, messageId, sourceUserId, targetUserId]
  );

  if (!shouldAward) {
    return { awarded: false };
  }

  const score = await addPoints(guildId, targetUserId, points);
  return { awarded: true, ...score };
}

async function recordReactionRemoval({ guildId, messageId, targetUserId, sourceUserId }) {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT reaction_count, active, points
     FROM engagement_events
     WHERE guild_id = ? AND message_id = ? AND engagement_type = 'reaction'
       AND source_user_id = ? AND target_user_id = ?
     LIMIT 1`,
    [guildId, messageId, sourceUserId, targetUserId]
  );

  if (!rows.length) {
    return;
  }

  const existing = rows[0];
  const currentCount = Math.max(Number(existing.reaction_count ?? 1) - 1, 0);
  const wasActive = Boolean(existing.active);

  await pool.query(
    `UPDATE engagement_events
     SET reaction_count = ?, active = ?, updated_at = NOW()
     WHERE guild_id = ? AND message_id = ? AND engagement_type = 'reaction'
       AND source_user_id = ? AND target_user_id = ?`,
    [currentCount, currentCount > 0 && wasActive ? 1 : 0, guildId, messageId, sourceUserId, targetUserId]
  );

  if (currentCount === 0 && wasActive) {
    await removePoints(guildId, targetUserId, Number(existing.points ?? 0));
  }
}

async function recordReplyCreate({ guildId, replyMessageId, targetUserId, sourceUserId, points, cooldownSeconds }) {
  const pool = getPool();

  const [recentRows] = await pool.query(
    `SELECT last_triggered_at
     FROM engagement_events
     WHERE guild_id = ? AND engagement_type = 'reply'
       AND source_user_id = ? AND target_user_id = ?
     ORDER BY last_triggered_at DESC
     LIMIT 1`,
    [guildId, sourceUserId, targetUserId]
  );

  const now = new Date();
  const cooldown = calculateCooldownStatus(recentRows[0]?.last_triggered_at, cooldownSeconds);
  const shouldAward = cooldown.cooledDown && points > 0;

  await pool.query(
    `INSERT INTO engagement_events
      (guild_id, message_id, engagement_type, source_user_id, target_user_id, points, active, reaction_count, last_triggered_at, created_at, updated_at)
     VALUES (?, ?, 'reply', ?, ?, ?, ?, 0, ?, NOW(), NOW())`,
    [guildId, replyMessageId, sourceUserId, targetUserId, points, shouldAward ? 1 : 0, now]
  );

  if (!shouldAward) {
    return { awarded: false };
  }

  const score = await addPoints(guildId, targetUserId, points);
  return { awarded: true, ...score };
}

async function recordReplyRemoval({ guildId, replyMessageId }) {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT target_user_id, points, active
     FROM engagement_events
     WHERE guild_id = ? AND message_id = ? AND engagement_type = 'reply'
     LIMIT 1`,
    [guildId, replyMessageId]
  );

  if (!rows.length) {
    return;
  }

  const event = rows[0];

  await pool.query(
    `UPDATE engagement_events
     SET active = 0, updated_at = NOW()
     WHERE guild_id = ? AND message_id = ? AND engagement_type = 'reply'`,
    [guildId, replyMessageId]
  );

  if (event.active) {
    await removePoints(guildId, event.target_user_id, Number(event.points ?? 0));
  }
}

async function getMemberStats(guildId, userId) {
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT active_points, current_level, last_awarded_at FROM engagement_scores WHERE guild_id = ? AND user_id = ? LIMIT 1',
    [guildId, userId]
  );

  if (!rows.length) {
    return null;
  }

  const activePoints = Number(rows[0].active_points ?? 0);
  const currentLevel = Number(rows[0].current_level ?? 0);
  const levelState = await computeLevelState(guildId, activePoints, currentLevel);

  return {
    activePoints,
    currentLevel,
    levelName: levelState.levelName,
    nextThreshold: levelState.nextThreshold,
    nextLevelName: levelState.nextLevelName,
    updatedAt: rows[0].last_awarded_at ? new Date(rows[0].last_awarded_at) : new Date()
  };
}

async function getLeaderboard(guildId, limit = 10) {
  const pool = getPool();
  const levels = await getGuildLevels(guildId);
  const [rows] = await pool.query(
    `SELECT user_id, active_points, current_level
     FROM engagement_scores
     WHERE guild_id = ?
     ORDER BY active_points DESC, current_level DESC
     LIMIT ?`,
    [guildId, limit]
  );

  return rows.map(row => ({
    userId: row.user_id,
    activePoints: Number(row.active_points ?? 0),
    currentLevel: Number(row.current_level ?? 0),
    levelName: resolveLevelName(levels, Number(row.current_level ?? 0))
  }));
}

async function updateGuildPoints(guildId, { reactionPoints, replyPoints }) {
  await upsertConfig(guildId, {
    reactionPoints,
    replyPoints
  });
}

async function updateGuildCooldown(guildId, cooldownSeconds) {
  await upsertConfig(guildId, { cooldownSeconds });
}

async function updateAnnouncementChannel(guildId, channelId) {
  await upsertConfig(guildId, { announceChannelId: channelId });
}

async function updateAnnouncementToggle(guildId, enabled) {
  await upsertConfig(guildId, { announceEnabled: enabled });
}

async function updateDmToggle(guildId, enabled) {
  await upsertConfig(guildId, { dmEnabled: enabled });
}

async function dispatchLevelUpNotifications(client, { guildId, userId, newLevel, levelName, activePoints }) {
  if (!client) {
    return;
  }

  const config = await getGuildConfig(guildId);
  const mention = `<@${userId}>`;
  const resolvedName = levelName ?? fallbackLevelName(newLevel);

  if (config.announceEnabled && config.announceChannelId) {
    try {
      const channel = await client.channels.fetch(config.announceChannelId).catch(() => null);
      if (channel && channel.isTextBased()) {
        await channel.send({
          content: `${mention} just reached **${resolvedName}**!`,
          allowedMentions: { users: [userId] }
        });
      }
    } catch (err) {
      console.warn('[engagement] Failed to send level-up announcement:', err);
    }
  }

  if (config.dmEnabled) {
    try {
      const user = await client.users.fetch(userId);
      const embed = new EmbedBuilder()
        .setTitle('Level Up!')
        .setDescription(`You reached **${resolvedName}** by generating ${activePoints} points of excitement.`)
        .setColor(0x00AEFF);

      await user.send({ embeds: [embed] }).catch(() => null);
    } catch (err) {
      console.warn('[engagement] Failed to DM level-up notification:', err);
    }
  }
}

module.exports = {
  getGuildConfig,
  getGuildLevels,
  listLevelDefinitions,
  upsertLevelDefinition,
  removeLevelDefinition,
  recordReactionAdd,
  recordReactionRemoval,
  recordReplyCreate,
  recordReplyRemoval,
  getMemberStats,
  getLeaderboard,
  updateGuildPoints,
  updateGuildCooldown,
  updateAnnouncementChannel,
  updateAnnouncementToggle,
  updateDmToggle,
  dispatchLevelUpNotifications,
  getNextThreshold,
  __clearCaches: () => {
    CONFIG_CACHE.clear();
    LEVEL_CACHE.clear();
  }
};
