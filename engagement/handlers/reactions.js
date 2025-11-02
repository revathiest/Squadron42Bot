const utils = require('../utils');

async function handleReactionAdd(client, reaction, user) {
  if (!reaction || !user) {
    return;
  }

  try {
    if (reaction.partial) {
      await reaction.fetch();
    }
  } catch (err) {
    console.warn('[engagement] Failed to resolve partial reaction add:', err);
    return;
  }

  const message = reaction.message;

  if (!message.guildId || user.bot) {
    return;
  }

  try {
    if (message.partial) {
      await message.fetch();
    }
  } catch (err) {
    console.warn('[engagement] Failed to fetch message for reaction add:', err);
    return;
  }

  const targetUser = message.author;
  if (!targetUser || targetUser.bot || targetUser.id === user.id) {
    return;
  }

  const config = await utils.getGuildConfig(message.guildId);
  if (config.reactionPoints <= 0) {
    return;
  }

  const emoji = reaction.emoji;
  const emojiId = emoji?.id ?? null;
  const emojiName = emoji?.name ?? null;
  const emojiType = emojiId ? 'custom' : 'unicode';

  const result = await utils.recordReactionAdd({
    guildId: message.guildId,
    messageId: message.id,
    targetUserId: targetUser.id,
    sourceUserId: user.id,
    points: config.reactionPoints,
    cooldownSeconds: config.cooldownSeconds,
    emojiId,
    emojiName,
    emojiType
  });

  if (result?.awarded && result.levelUp) {
    await utils.dispatchLevelUpNotifications(client, {
      guildId: message.guildId,
      userId: targetUser.id,
      newLevel: result.newLevel,
      levelName: result.levelName,
      activePoints: result.activePoints
    });
  }
}

async function handleReactionRemove(client, reaction, user) {
  if (!reaction || !user) {
    return;
  }

  try {
    if (reaction.partial) {
      await reaction.fetch();
    }
  } catch (err) {
    console.warn('[engagement] Failed to resolve partial reaction remove:', err);
    return;
  }

  const message = reaction.message;

  if (!message.guildId || user.bot) {
    return;
  }

  if (message.partial) {
    try {
      await message.fetch();
    } catch (err) {
      console.warn('[engagement] Failed to fetch message for reaction removal:', err);
      return;
    }
  }

  const targetUserId = message.author?.id;
  if (!targetUserId || targetUserId === user.id) {
    return;
  }

  const config = await utils.getGuildConfig(message.guildId);
  if (config.reactionPoints <= 0) {
    return;
  }

  await utils.recordReactionRemoval({
    guildId: message.guildId,
    messageId: message.id,
    targetUserId,
    sourceUserId: user.id
  });
}

module.exports = {
  handleReactionAdd,
  handleReactionRemove
};
