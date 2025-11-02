const utils = require('../utils');

async function handleReplyCreate(client, message) {
  if (!message.guildId || message.author.bot || !message.reference) {
    return;
  }

  const referenced = await message.fetchReference().catch(() => null);
  if (!referenced || referenced.author?.bot || referenced.author?.id === message.author.id) {
    return;
  }

  const config = await utils.getGuildConfig(message.guildId);
  if (config.replyPoints <= 0) {
    return;
  }

  const result = await utils.recordReplyCreate({
    guildId: message.guildId,
    replyMessageId: message.id,
    sourceUserId: message.author.id,
    targetUserId: referenced.author.id,
    points: config.replyPoints,
    cooldownSeconds: config.cooldownSeconds
  });

  if (result?.awarded && result.levelUp) {
    await utils.dispatchLevelUpNotifications(client, {
      guildId: message.guildId,
      userId: referenced.author.id,
      newLevel: result.newLevel,
      levelName: result.levelName,
      activePoints: result.activePoints
    });
  }
}

async function handleReplyDelete(message) {
  if (!message.guildId) {
    return;
  }

  await utils.recordReplyRemoval({
    guildId: message.guildId,
    replyMessageId: message.id
  });
}

module.exports = {
  handleReplyCreate,
  handleReplyDelete
};
