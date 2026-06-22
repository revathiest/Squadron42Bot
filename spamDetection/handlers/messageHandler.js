const { loadConfig, sendAlert } = require('../utils');
const {
  checkRateLimit,
  checkDuplicates,
  checkCrossChannelDuplicate,
  checkSpamPatterns,
  checkMentionSpam,
  checkInviteLink,
  getTrustTier,
  getRequiredSignals,
  TRUST,
} = require('../detector');
const { logAction } = require('../../moderation/handlers/actions');

let clientRef = null;

function setClient(client) {
  clientRef = client;
}

async function handleMessageCreate(message) {
  if (!message.guild || message.author.bot) return;

  const { guild, member, channel } = message;
  if (!member) return;

  const config = await loadConfig(guild.id);
  if (!config.enabled) return;

  if (config.whitelistChannelIds.includes(channel.id)) return;
  if (config.whitelistRoleIds.some(id => member.roles.cache.has(id))) return;

  const tier = getTrustTier(member, config);
  const threshold = config.signal_threshold ?? 2;
  const required = getRequiredSignals(tier, threshold);

  const detections = [];

  if (checkRateLimit(guild.id, message.author.id, config.rate_limit_count, config.rate_limit_window_ms)) {
    detections.push(`rate limit (${config.rate_limit_count} msgs / ${config.rate_limit_window_ms / 1000}s)`);
  }

  if (checkDuplicates(guild.id, message.author.id, message.content)) {
    detections.push('repeated identical messages');
  }

  if (checkCrossChannelDuplicate(guild.id, message.author.id, channel.id, message.content)) {
    detections.push('same message sent to multiple channels');
  }

  for (const match of checkSpamPatterns(message.content)) {
    detections.push(`spam pattern: ${match}`);
  }

  if (checkMentionSpam(message)) {
    detections.push(`mass mentions (${message.mentions.users.size + message.mentions.roles.size})`);
  }

  if (checkInviteLink(message.content)) {
    detections.push('Discord invite link');
  }

  const isEstablished = tier === TRUST.ESTABLISHED;
  const hitsSecondary = isEstablished && detections.length >= threshold && detections.length < required;
  const hitsPrimary = detections.length >= required;

  if (!hitsSecondary && !hitsPrimary) return;

  const actionToTake = hitsSecondary ? (config.secondary_action ?? 'timeout') : config.auto_action;
  const reasonPrefix = hitsSecondary ? 'Possible account compromise' : 'Spam detection';
  const reason = `${reasonPrefix} [${tier}]: ${detections.join('; ')}`;
  const savedContent = message.content;
  const channelId = channel.id;
  const botUser = guild.members.me?.user;

  try {
    await message.delete();
  } catch {
    // Message may already be deleted
  }

  try {
    if (actionToTake === 'ban') {
      await member.ban({ reason });
    } else {
      await member.timeout(config.timeout_duration_ms, reason);
    }

    if (botUser) {
      await logAction({
        guildId: guild.id,
        action: actionToTake,
        targetUser: message.author,
        moderator: botUser,
        reason,
      });
    }
  } catch (err) {
    console.error('[spamDetection] Failed to execute action on', message.author.id, ':', err.message);
  }

  if (config.alert_channel_id && clientRef) {
    await sendAlert(clientRef, guild.id, config.alert_channel_id, {
      member,
      reason,
      action: actionToTake,
      messageContent: savedContent,
      channelId,
      tier,
    });
  }
}

module.exports = { handleMessageCreate, setClient };
