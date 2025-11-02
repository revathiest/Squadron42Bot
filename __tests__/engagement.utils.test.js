jest.mock('../database', () => {
  const pool = {
    query: jest.fn()
  };
  return {
    getPool: () => pool,
    __pool: pool
  };
});

const database = require('../database');
const utils = require('../engagement/utils');

const storage = {
  config: new Map(),
  scores: new Map(),
  events: new Map(),
  levels: new Map()
};

function scoreKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function eventKey(guildId, messageId, type, sourceUserId, targetUserId) {
  return `${guildId}:${messageId}:${type}:${sourceUserId}:${targetUserId}`;
}

function toRowConfig(config) {
  if (!config) return [];
  return [{
    reaction_points: config.reactionPoints,
    reply_points: config.replyPoints,
    cooldown_seconds: config.cooldownSeconds,
    announce_channel_id: config.announceChannelId,
    announce_enabled: config.announceEnabled ? 1 : 0,
    dm_enabled: config.dmEnabled ? 1 : 0
  }];
}

function handleQuery(sql, params = []) {
  const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

  if (normalized.startsWith('select') && normalized.includes('from engagement_config')) {
    const guildId = params[0];
    return Promise.resolve([toRowConfig(storage.config.get(guildId))]);
  }

  if (normalized.startsWith('insert into engagement_config')) {
    const [guildId, reactionPoints, replyPoints, cooldownSeconds, announceChannelId, announceEnabled, dmEnabled] = params;
    storage.config.set(guildId, {
      reactionPoints,
      replyPoints,
      cooldownSeconds,
      announceChannelId,
      announceEnabled: Boolean(announceEnabled),
      dmEnabled: Boolean(dmEnabled)
    });
    return Promise.resolve([[{ affectedRows: 1 }]]);
  }

  if (normalized.startsWith('select level_rank')) {
    const guildId = params[0];
    const levels = storage.levels.get(guildId) ?? [];
    return Promise.resolve([levels.map(level => ({
      level_rank: level.levelRank,
      level_name: level.levelName,
      points_required: level.pointsRequired
    }))]);
  }

  if (normalized.startsWith('insert into engagement_levels')) {
    const [guildId, levelRank, levelName, pointsRequired] = params;
    const levels = storage.levels.get(guildId) ?? [];
    const existingIndex = levels.findIndex(level => level.levelRank === levelRank);
    if (existingIndex >= 0) {
      levels[existingIndex] = { levelRank, levelName, pointsRequired };
    } else {
      levels.push({ levelRank, levelName, pointsRequired });
    }
    levels.sort((a, b) => a.pointsRequired - b.pointsRequired);
    storage.levels.set(guildId, levels);
    return Promise.resolve([[{ affectedRows: 1 }]]);
  }

  if (normalized.startsWith('delete from engagement_levels')) {
    const [guildId, levelRank] = params;
    const levels = storage.levels.get(guildId) ?? [];
    const nextLevels = levels.filter(level => level.levelRank !== levelRank);
    storage.levels.set(guildId, nextLevels);
    return Promise.resolve([{ affectedRows: levels.length !== nextLevels.length ? 1 : 0 }]);
  }

  if (normalized.startsWith('insert into engagement_scores')) {
    const [guildId, userId, points] = params;
    const key = scoreKey(guildId, userId);
    const entry = storage.scores.get(key) ?? {
      guildId,
      userId,
      activePoints: 0,
      currentLevel: 0,
      lastAwardedAt: null
    };
    entry.activePoints += points;
    entry.lastAwardedAt = new Date();
    storage.scores.set(key, entry);
    return Promise.resolve([[{ affectedRows: 1 }]]);
  }

  if (normalized.startsWith('select active_points, current_level from engagement_scores')) {
    const [guildId, userId] = params;
    const entry = storage.scores.get(scoreKey(guildId, userId));
    if (!entry) {
      return Promise.resolve([[]]);
    }
    return Promise.resolve([[
      {
        active_points: entry.activePoints,
        current_level: entry.currentLevel
      }
    ]]);
  }

  if (normalized.startsWith('update engagement_scores set current_level')) {
    const [level, guildId, userId] = params;
    const entry = storage.scores.get(scoreKey(guildId, userId));
    if (entry) {
      entry.currentLevel = level;
      entry.lastAwardedAt = new Date();
    }
    return Promise.resolve([[{ affectedRows: entry ? 1 : 0 }]]);
  }

  if (normalized.startsWith('update engagement_scores set active_points')) {
    const [deduct, guildId, userId] = params;
    const entry = storage.scores.get(scoreKey(guildId, userId));
    if (entry) {
      entry.activePoints = Math.max(entry.activePoints - deduct, 0);
    }
    return Promise.resolve([[{ affectedRows: entry ? 1 : 0 }]]);
  }

  if (normalized.startsWith('select active_points, current_level, last_awarded_at from engagement_scores')) {
    const [guildId, userId] = params;
    const entry = storage.scores.get(scoreKey(guildId, userId));
    if (!entry) {
      return Promise.resolve([[]]);
    }
    return Promise.resolve([[
      {
        active_points: entry.activePoints,
        current_level: entry.currentLevel,
        last_awarded_at: entry.lastAwardedAt
      }
    ]]);
  }

  if (normalized.startsWith('select user_id, active_points, current_level from engagement_scores')) {
    const [guildId, limit] = params;
    const candidates = Array.from(storage.scores.values())
      .filter(entry => entry.guildId === guildId)
      .sort((a, b) => {
        if (b.activePoints === a.activePoints) {
          return b.currentLevel - a.currentLevel;
        }
        return b.activePoints - a.activePoints;
      })
      .slice(0, limit)
      .map(entry => ({
        user_id: entry.userId,
        active_points: entry.activePoints,
        current_level: entry.currentLevel
      }));
    return Promise.resolve([candidates]);
  }

  if (normalized.startsWith('select active, reaction_count, last_triggered_at, points from engagement_events')) {
    const [guildId, messageId, sourceUserId, targetUserId] = params;
    const key = eventKey(guildId, messageId, 'reaction', sourceUserId, targetUserId);
    const event = storage.events.get(key);
    return Promise.resolve([event ? [{
      active: event.active ? 1 : 0,
      reaction_count: event.reactionCount,
      last_triggered_at: event.lastTriggeredAt,
      points: event.points
    }] : []]);
  }

  if (normalized.startsWith('select reaction_count, active, points from engagement_events')) {
    const [guildId, messageId, sourceUserId, targetUserId] = params;
    const key = eventKey(guildId, messageId, 'reaction', sourceUserId, targetUserId);
    const event = storage.events.get(key);
    return Promise.resolve([event ? [{
      reaction_count: event.reactionCount,
      active: event.active ? 1 : 0,
      points: event.points
    }] : []]);
  }

  if (normalized.startsWith('insert into engagement_events') && normalized.includes("values (?, ?, 'reaction'")) {
    const [guildId, messageId, sourceUserId, targetUserId, points, lastTriggeredAt, emojiId, emojiName, emojiType] = params;
    const key = eventKey(guildId, messageId, 'reaction', sourceUserId, targetUserId);
    storage.events.set(key, {
      type: 'reaction',
      guildId,
      messageId,
      sourceUserId,
      targetUserId,
      points,
      active: true,
      reactionCount: 1,
      lastTriggeredAt,
      emojiId,
      emojiName,
      emojiType
    });
    return Promise.resolve([[{ affectedRows: 1 }]]);
  }

  if (normalized.startsWith('update engagement_events set reaction_count = ?, active = ?, points = ?, last_triggered_at')) {
    const [reactionCount, activeFlag, points, lastTriggeredAt, emojiId, emojiName, emojiType, guildId, messageId, sourceUserId, targetUserId] = params;
    const key = eventKey(guildId, messageId, 'reaction', sourceUserId, targetUserId);
    const event = storage.events.get(key);
    if (event) {
      event.reactionCount = reactionCount;
      event.active = Boolean(activeFlag);
      event.points = points;
      event.lastTriggeredAt = lastTriggeredAt;
      event.emojiId = emojiId;
      event.emojiName = emojiName;
      event.emojiType = emojiType;
    }
    return Promise.resolve([[{ affectedRows: event ? 1 : 0 }]]);
  }

  if (normalized.startsWith('update engagement_events set reaction_count = ?, active = ?')) {
    const [reactionCount, activeFlag, guildId, messageId, sourceUserId, targetUserId] = params;
    const key = eventKey(guildId, messageId, 'reaction', sourceUserId, targetUserId);
    const event = storage.events.get(key);
    if (event) {
      event.reactionCount = reactionCount;
      event.active = Boolean(activeFlag);
    }
    return Promise.resolve([[{ affectedRows: event ? 1 : 0 }]]);
  }

  if (normalized.startsWith('select last_triggered_at from engagement_events')) {
    const [guildId, sourceUserId, targetUserId] = params;
    const matches = Array.from(storage.events.values())
      .filter(event =>
        event.guildId === guildId &&
        event.type === 'reply' &&
        event.sourceUserId === sourceUserId &&
        event.targetUserId === targetUserId)
      .sort((a, b) => (b.lastTriggeredAt ?? 0) - (a.lastTriggeredAt ?? 0));
    if (!matches.length) {
      return Promise.resolve([[]]);
    }
    return Promise.resolve([[
      { last_triggered_at: matches[0].lastTriggeredAt }
    ]]);
  }

  if (normalized.startsWith('insert into engagement_events') && normalized.includes("values (?, ?, 'reply'")) {
    const [guildId, messageId, sourceUserId, targetUserId, points, activeFlag, lastTriggeredAt] = params;
    const key = eventKey(guildId, messageId, 'reply', sourceUserId, targetUserId);
    storage.events.set(key, {
      type: 'reply',
      guildId,
      messageId,
      sourceUserId,
      targetUserId,
      points,
      active: Boolean(activeFlag),
      reactionCount: 0,
      lastTriggeredAt
    });
    return Promise.resolve([[{ affectedRows: 1 }]]);
  }

  if (normalized.startsWith('select target_user_id, points, active from engagement_events')) {
    const [guildId, messageId] = params;
    const candidates = Array.from(storage.events.values()).filter(event =>
      event.guildId === guildId &&
      event.messageId === messageId &&
      event.type === 'reply'
    );
    if (!candidates.length) {
      return Promise.resolve([[]]);
    }
    const event = candidates[0];
    return Promise.resolve([[
      {
        target_user_id: event.targetUserId,
        points: event.points,
        active: event.active ? 1 : 0
      }
    ]]);
  }

  if (normalized.startsWith('update engagement_events set active = 0')) {
    const [guildId, messageId] = params;
    for (const event of storage.events.values()) {
      if (event.guildId === guildId && event.messageId === messageId && event.type === 'reply') {
        event.active = false;
      }
    }
    return Promise.resolve([[{ affectedRows: 1 }]]);
  }

  throw new Error(`Unhandled query: ${sql}`);
}

function resetStorage() {
  storage.config.clear();
  storage.scores.clear();
  storage.events.clear();
  storage.levels.clear();
  utils.__clearCaches();
  database.__pool.query.mockImplementation(handleQuery);
}

beforeEach(() => {
  resetStorage();
  jest.useFakeTimers().setSystemTime(new Date('2025-01-01T00:00:00Z'));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('engagement reactions', () => {
  test('awards points once and keeps level sticky after removal', async () => {
    const result = await utils.recordReactionAdd({
      guildId: 'guild-1',
      messageId: 'msg-1',
      targetUserId: 'user-target',
      sourceUserId: 'user-source',
      points: 30,
      cooldownSeconds: 10,
      emojiId: null,
      emojiName: '❤️',
      emojiType: 'unicode'
    });

    expect(result.awarded).toBe(true);
    expect(result.levelUp).toBe(true);
    expect(result.newLevel).toBe(1);
    expect(result.levelName).toBe('Level 1');

    await utils.recordReactionRemoval({
      guildId: 'guild-1',
      messageId: 'msg-1',
      targetUserId: 'user-target',
      sourceUserId: 'user-source'
    });

    const stats = await utils.getMemberStats('guild-1', 'user-target');
    expect(stats.activePoints).toBe(0);
    expect(stats.currentLevel).toBe(1);
  });

  test('respects reaction cooldown before re-awarding', async () => {
    await utils.recordReactionAdd({
      guildId: 'guild-2',
      messageId: 'msg-2',
      targetUserId: 'poster',
      sourceUserId: 'fan',
      points: 5,
      cooldownSeconds: 60,
      emojiId: null,
      emojiName: '🔥',
      emojiType: 'unicode'
    });

    await utils.recordReactionRemoval({
      guildId: 'guild-2',
      messageId: 'msg-2',
      targetUserId: 'poster',
      sourceUserId: 'fan'
    });

    const second = await utils.recordReactionAdd({
      guildId: 'guild-2',
      messageId: 'msg-2',
      targetUserId: 'poster',
      sourceUserId: 'fan',
      points: 5,
      cooldownSeconds: 60,
      emojiId: null,
      emojiName: '🔥',
      emojiType: 'unicode'
    });
    expect(second.awarded).toBe(false);

    // Advance past cooldown and retry after removing the temporary reaction.
    await utils.recordReactionRemoval({
      guildId: 'guild-2',
      messageId: 'msg-2',
      targetUserId: 'poster',
      sourceUserId: 'fan'
    });

    const key = eventKey('guild-2', 'msg-2', 'reaction', 'fan', 'poster');
    const event = storage.events.get(key);
    event.lastTriggeredAt = new Date(Date.now() - 120 * 1000);

    const third = await utils.recordReactionAdd({
      guildId: 'guild-2',
      messageId: 'msg-2',
      targetUserId: 'poster',
      sourceUserId: 'fan',
      points: 5,
      cooldownSeconds: 60,
      emojiId: null,
      emojiName: '🔥',
      emojiType: 'unicode'
    });
    expect(third.awarded).toBe(true);

    const stats = await utils.getMemberStats('guild-2', 'poster');
    expect(stats.activePoints).toBe(5);
  });
});

describe('engagement replies', () => {
  test('awards once per reply and obeys cooldown', async () => {
    const first = await utils.recordReplyCreate({
      guildId: 'guild-3',
      replyMessageId: 'reply-1',
      sourceUserId: 'replier',
      targetUserId: 'poster',
      points: 20,
      cooldownSeconds: 120
    });
    expect(first.awarded).toBe(true);

    const second = await utils.recordReplyCreate({
      guildId: 'guild-3',
      replyMessageId: 'reply-2',
      sourceUserId: 'replier',
      targetUserId: 'poster',
      points: 20,
      cooldownSeconds: 120
    });
    expect(second.awarded).toBe(false);

    await utils.recordReplyRemoval({
      guildId: 'guild-3',
      replyMessageId: 'reply-1'
    });

    const stats = await utils.getMemberStats('guild-3', 'poster');
    expect(stats.activePoints).toBe(0);
  });
});

describe('configuration and reporting', () => {
  test('updates configuration values and caches them', async () => {
    const initial = await utils.getGuildConfig('guild-4');
    expect(initial.reactionPoints).toBeGreaterThan(0);

    await utils.updateGuildPoints('guild-4', { reactionPoints: 3, replyPoints: 7 });
    await utils.updateGuildCooldown('guild-4', 90);
    await utils.updateAnnouncementChannel('guild-4', 'channel-1');
    await utils.updateAnnouncementToggle('guild-4', true);
    await utils.updateDmToggle('guild-4', true);

    const updated = await utils.getGuildConfig('guild-4');
    expect(updated).toEqual({
      reactionPoints: 3,
      replyPoints: 7,
      cooldownSeconds: 90,
      announceChannelId: 'channel-1',
      announceEnabled: true,
      dmEnabled: true
    });
  });

  test('produces a sorted leaderboard', async () => {
    await utils.recordReactionAdd({
      guildId: 'guild-5',
      messageId: 'm-1',
      targetUserId: 'alice',
      sourceUserId: 's1',
      points: 10,
      cooldownSeconds: 0,
      emojiId: null,
      emojiName: '🔥',
      emojiType: 'unicode'
    });
    await utils.recordReactionAdd({
      guildId: 'guild-5',
      messageId: 'm-2',
      targetUserId: 'bob',
      sourceUserId: 's2',
      points: 5,
      cooldownSeconds: 0,
      emojiId: null,
      emojiName: '🔥',
      emojiType: 'unicode'
    });

    const leaderboard = await utils.getLeaderboard('guild-5', 10);
    expect(leaderboard.map(entry => entry.userId)).toEqual(['alice', 'bob']);
    expect(leaderboard[0].levelName).toBe('Unranked');
  });

  test('custom level definitions drive progression and titles', async () => {
    await utils.upsertLevelDefinition('guild-7', { levelRank: 1, levelName: 'Recruit', pointsRequired: 5 });
    await utils.upsertLevelDefinition('guild-7', { levelRank: 2, levelName: 'Pilot', pointsRequired: 20 });

    const award = await utils.recordReactionAdd({
      guildId: 'guild-7',
      messageId: 'engage-1',
      targetUserId: 'ace',
      sourceUserId: 'fan',
      points: 5,
      cooldownSeconds: 0,
      emojiId: null,
      emojiName: '🚀',
      emojiType: 'unicode'
    });

    expect(award.levelUp).toBe(true);
    expect(award.levelName).toBe('Recruit');

    await utils.recordReactionRemoval({
      guildId: 'guild-7',
      messageId: 'engage-1',
      targetUserId: 'ace',
      sourceUserId: 'fan'
    });

    const stats = await utils.getMemberStats('guild-7', 'ace');
    expect(stats.currentLevel).toBe(1);
    expect(stats.levelName).toBe('Recruit');
    expect(stats.nextThreshold).toBe(20);
    expect(stats.nextLevelName).toBe('Pilot');

    const leaderboard = await utils.getLeaderboard('guild-7', 5);
    expect(leaderboard[0].levelName).toBe('Recruit');

    const definitions = await utils.listLevelDefinitions('guild-7');
    expect(definitions).toEqual([
      { levelRank: 1, levelName: 'Recruit', pointsRequired: 5 },
      { levelRank: 2, levelName: 'Pilot', pointsRequired: 20 }
    ]);

    const removed = await utils.removeLevelDefinition('guild-7', 2);
    expect(removed).toBe(true);
    const remaining = await utils.listLevelDefinitions('guild-7');
    expect(remaining).toEqual([{ levelRank: 1, levelName: 'Recruit', pointsRequired: 5 }]);
  });

  test('dispatches notifications according to configuration', async () => {
    await utils.updateGuildPoints('guild-6', { reactionPoints: 1, replyPoints: 1 });
    await utils.updateGuildCooldown('guild-6', 60);
    await utils.updateAnnouncementChannel('guild-6', 'chan-123');
    await utils.updateAnnouncementToggle('guild-6', true);
    await utils.updateDmToggle('guild-6', true);

    const sendChannel = jest.fn().mockResolvedValue(undefined);
    const sendDm = jest.fn().mockResolvedValue(undefined);
    const client = {
      channels: {
        fetch: jest.fn().mockResolvedValue({
          isTextBased: () => true,
          send: sendChannel
        })
      },
      users: {
        fetch: jest.fn().mockResolvedValue({
          send: sendDm
        })
      }
    };

  await utils.dispatchLevelUpNotifications(client, {
    guildId: 'guild-6',
    userId: 'user-6',
    newLevel: 2,
    levelName: 'Ace',
    activePoints: 75
  });

    expect(client.channels.fetch).toHaveBeenCalledWith('chan-123');
    expect(sendChannel).toHaveBeenCalledTimes(1);
    expect(client.users.fetch).toHaveBeenCalledWith('user-6');
    expect(sendDm).toHaveBeenCalledTimes(1);
  });
});
