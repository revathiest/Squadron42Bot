const { loadConfig, sendAlert } = require('../utils');
const { checkRateLimit, checkDuplicates, checkMentionSpam, checkInviteLink, checkNewAccount } = require('../detector');
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

  const detections = [];

  if (checkRateLimit(guild.id, message.author.id, config.rate_limit_count, config.rate_limit_window_ms)) {
    detections.push(`rate limit (${config.rate_limit_count} msgs / ${config.rate_limit_window_ms / 1000}s)`);
  }

  if (checkDuplicates(guild.id, message.author.id, message.content)) {
    detections.push('repeated identical messages');
  }

  if (checkMentionSpam(message)) {
    detections.push(`mass mentions (${message.mentions.users.size + message.mentions.roles.size})`);
  }

  if (checkInviteLink(message.content) && checkNewAccount(member, config.new_account_days)) {
    detections.push('invite link from new account');
  }

  if (detections.length === 0) return;

  const reason = `Spam detection: ${detections.join('; ')}`;
  const savedContent = message.content;
  const channelId = channel.id;
  const botUser = guild.members.me?.user;

  try {
    await message.delete();
  } catch {
    // Message may already be deleted
  }

  try {
    if (config.auto_action === 'ban') {
      await member.ban({ reason });
    } else {
      await member.timeout(config.timeout_duration_ms, reason);
    }

    if (botUser) {
      await logAction({
        guildId: guild.id,
        action: config.auto_action,
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
      action: config.auto_action,
      messageContent: savedContent,
      channelId,
    });
  }
}

module.exports = { handleMessageCreate, setClient };
