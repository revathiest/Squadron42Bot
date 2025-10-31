const { ChannelType } = require('discord.js');
const { getPool } = require('../../database');

const ORG_REGEX = /https:\/\/robertsspaceindustries\.com\/en\/orgs\/([A-Z0-9-]+)/gi;
const REFERRAL_REGEX = /\bSTAR-[A-Z0-9]{4}-[A-Z0-9]{4}\b/gi;

const orgForumCache = new Map(); // guildId -> Set(channelId)
const missingForumNotice = new Set(); // guildIds warned about missing configuration

function getParentForumId(channel) {
  if (!channel) {
    return null;
  }

  switch (channel.type) {
    case ChannelType.PublicThread:
    case ChannelType.PrivateThread:
    case ChannelType.AnnouncementThread:
      return channel.parentId || null;
    case ChannelType.GuildForum:
      return channel.id;
    default:
      return null;
  }
}

function getCachedOrgForums(guildId) {
  return orgForumCache.get(guildId) || null;
}

function setOrgForums(guildId, channelIds) {
  const set = new Set(channelIds);
  orgForumCache.set(guildId, set);
  return set;
}

function addOrgForumToCache(guildId, channelId) {
  const existing = orgForumCache.get(guildId);
  if (existing) {
    existing.add(channelId);
    return existing;
  }
  const set = new Set([channelId]);
  orgForumCache.set(guildId, set);
  return set;
}

function removeOrgForumFromCache(guildId, channelId) {
  const existing = orgForumCache.get(guildId);
  if (!existing) {
    return false;
  }
  const deleted = existing.delete(channelId);
  if (existing.size === 0) {
    orgForumCache.delete(guildId);
  }
  return deleted;
}

function clearOrgForumCache() {
  orgForumCache.clear();
  missingForumNotice.clear();
}

async function loadOrgForumCache(pool = getPool()) {
  const [rows] = await pool.query('SELECT guild_id, channel_id FROM moderation_org_forum_channels');
  orgForumCache.clear();
  for (const row of rows) {
    addOrgForumToCache(row.guild_id, row.channel_id);
  }
  missingForumNotice.clear();
}

async function fetchOrgForums(guildId, pool = getPool()) {
  const [rows] = await pool.query(
    'SELECT channel_id FROM moderation_org_forum_channels WHERE guild_id = ?',
    [guildId]
  );
  return setOrgForums(guildId, rows.map(row => row.channel_id));
}

async function getOrgForums(guildId) {
  if (!guildId) {
    return new Set();
  }

  const cached = getCachedOrgForums(guildId);
  if (cached) {
    return cached;
  }

  return fetchOrgForums(guildId);
}

async function allowOrgForumChannel(guildId, channelId, createdBy) {
  const pool = getPool();
  const [result] = await pool.query(
    `
      INSERT INTO moderation_org_forum_channels (guild_id, channel_id, created_by)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        created_by = VALUES(created_by),
        created_at = CURRENT_TIMESTAMP
    `,
    [guildId, channelId, createdBy ?? null]
  );

  addOrgForumToCache(guildId, channelId);
  missingForumNotice.delete(guildId);

  return Boolean(result?.affectedRows);
}

async function disallowOrgForumChannel(guildId, channelId) {
  const pool = getPool();
  const [result] = await pool.query(
    'DELETE FROM moderation_org_forum_channels WHERE guild_id = ? AND channel_id = ?',
    [guildId, channelId]
  );

  const deleted = removeOrgForumFromCache(guildId, channelId);
  if (deleted && !orgForumCache.has(guildId)) {
    missingForumNotice.delete(guildId);
  }

  return Boolean(result?.affectedRows);
}

async function listOrgForumChannels(guildId) {
  const forums = await getOrgForums(guildId);
  return Array.from(forums);
}

async function deleteMessage(message, reason) {
  try {
    await message.delete(reason);
    return true;
  } catch (err) {
    console.error('moderation: failed to delete message', {
      guildId: message.guildId,
      channelId: message.channelId,
      messageId: message.id,
      reason,
      err: err?.message
    });
    return false;
  }
}

async function notifyUser(user, content) {
  if (!user) {
    return;
  }

  try {
    await user.send(content);
  } catch (err) {
    // Ignore DM failures (user may have DMs disabled).
  }
}

async function fetchOrgRecord(guildId, orgCode) {
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT guild_id, org_code, channel_id, message_id, author_id FROM moderation_org_posts WHERE guild_id = ? AND org_code = ?',
    [guildId, orgCode]
  );
  return rows[0] || null;
}

async function upsertOrgRecord({ guildId, orgCode, channelId, messageId, authorId }, { force } = {}) {
  const pool = getPool();

  if (force) {
    await pool.query(
      `
        INSERT INTO moderation_org_posts (guild_id, org_code, channel_id, message_id, author_id)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          channel_id = VALUES(channel_id),
          message_id = VALUES(message_id),
          author_id = VALUES(author_id),
          created_at = CURRENT_TIMESTAMP
      `,
      [guildId, orgCode, channelId, messageId, authorId]
    );
  } else {
    await pool.query(
      `
        INSERT INTO moderation_org_posts (guild_id, org_code, channel_id, message_id, author_id)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE message_id = message_id
      `,
      [guildId, orgCode, channelId, messageId, authorId]
    );
  }
}

async function buildOrgReference(client, record) {
  if (!record) {
    return null;
  }

  try {
    const channel = await client.channels.fetch(record.channel_id);
    if (!channel || !channel.isTextBased()) {
      return null;
    }

    const originalMessage = await channel.messages.fetch(record.message_id);
    if (!originalMessage) {
      return null;
    }

    return {
      url: `https://discord.com/channels/${originalMessage.guildId}/${originalMessage.channelId}/${originalMessage.id}`,
      message: originalMessage
    };
  } catch (err) {
    return null;
  }
}

async function maybeDeleteEmptyThread(channel, reason) {
  if (!channel || typeof channel.isThread !== 'function' || !channel.isThread()) {
    return;
  }

  try {
    const messages = await channel.messages.fetch({ limit: 2 });
    if (messages.size === 0) {
      await channel.delete(reason);
      console.info('[moderation] deleted empty thread after moderation action', {
        threadId: channel.id,
        parentId: channel.parentId,
        reason
      });
    }
  } catch (err) {
    console.error('moderation: failed to prune empty thread', {
      threadId: channel?.id,
      reason,
      err: err?.message
    });
  }
}

async function handleReferralCodes(message) {
  REFERRAL_REGEX.lastIndex = 0;
  const matches = message.content.match(REFERRAL_REGEX);
  if (!matches || !matches.length) {
    return false;
  }

  const deleted = await deleteMessage(
    message,
    'Referral codes must be shared via slash commands.'
  );

  if (deleted) {
    console.info('[moderation] removed referral code message', {
      guildId: message.guildId,
      channelId: message.channelId,
      messageId: message.id,
      codes: matches
    });
    await notifyUser(
      message.author,
      'Referral codes should be shared using `/register-referral-code` and `/get-referral-code`. Your message was removed to keep channels tidy.'
    );
    await maybeDeleteEmptyThread(message.channel, 'Referral code message removed');
  } else {
    console.error('moderation: failed to remove referral code message', {
      guildId: message.guildId,
      channelId: message.channelId,
      messageId: message.id,
      codes: matches
    });
  }

  return true;
}

async function handleOrgLinks(message) {
  const forums = await getOrgForums(message.guildId);

  ORG_REGEX.lastIndex = 0;
  const codes = [];
  let match;
  while ((match = ORG_REGEX.exec(message.content)) !== null) {
    const code = match[1]?.toUpperCase();
    if (code && !codes.includes(code)) {
      codes.push(code);
    }
  }

  if (!codes.length) {
    return;
  }

  const parentForumId = getParentForumId(message.channel);
  if (!parentForumId || !forums.has(parentForumId)) {
    if (!forums.size && !missingForumNotice.has(message.guildId)) {
      missingForumNotice.add(message.guildId);
      console.info(
        'moderation: no org promotion forums configured for guild; org links will be removed until /mod org-promos add is used.',
        { guildId: message.guildId }
      );
    }

    const deleted = await deleteMessage(
      message,
      'Organization links are restricted to the configured forum channels.'
    );
    if (deleted) {
      console.info('[moderation] removed org link posted outside forum', {
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
        orgCodes: codes
      });
      if (forums.size) {
        const channelMentions = Array.from(forums).map(id => `<#${id}>`).join(', ');
        await notifyUser(
          message.author,
          `Organization links are restricted to the configured forum channels: ${channelMentions}.`
        );
      } else {
        await notifyUser(
          message.author,
          'Organization links are restricted to the promotion forum configured by the moderation team. Please contact a moderator for assistance.'
        );
      }
      await maybeDeleteEmptyThread(message.channel, 'Organization link removed outside forum');
    }
    return;
  }

  for (const code of codes) {
    const existing = await fetchOrgRecord(message.guildId, code);
    if (!existing) {
      await upsertOrgRecord({
        guildId: message.guildId,
        orgCode: code,
        channelId: message.channelId,
        messageId: message.id,
        authorId: message.author.id
      });
      console.info('[moderation] recorded new org promotion', {
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
        orgCode: code
      });
      continue;
    }

    const reference = await buildOrgReference(message.client, existing);
    if (!reference) {
      await upsertOrgRecord(
        {
          guildId: message.guildId,
          orgCode: code,
          channelId: message.channelId,
          messageId: message.id,
          authorId: message.author.id
        },
        { force: true }
      );
      console.info('[moderation] replaced missing org promotion reference', {
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
        orgCode: code
      });
      continue;
    }

    const deleted = await deleteMessage(
      message,
      'Duplicate organization promotion detected.'
    );
    if (deleted) {
      console.info('[moderation] removed duplicate org promotion', {
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
        orgCode: code,
        originalMessageUrl: reference.url
      });
      await maybeDeleteEmptyThread(message.channel, 'Duplicate organization promotion removed');
      await notifyUser(
        message.author,
        `This organization has already been promoted here: ${reference.url}`
      );
    } else {
      console.error('moderation: failed to remove duplicate org promotion', {
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
        orgCode: code
      });
    }
    return;
  }
}

async function handleMessageCreate(message) {
  if (!message || message.author?.bot || !message.guild) {
    return;
  }

  if (await handleReferralCodes(message)) {
    return;
  }

  await handleOrgLinks(message);
}

module.exports = {
  handleMessageCreate,
  loadOrgForumCache,
  allowOrgForumChannel,
  disallowOrgForumChannel,
  listOrgForumChannels,
  clearOrgForumCache,
  __testables: {
    ORG_REGEX,
    REFERRAL_REGEX,
    getParentForumId,
    handleOrgLinks,
    handleReferralCodes,
    fetchOrgRecord,
    upsertOrgRecord,
    buildOrgReference,
    maybeDeleteEmptyThread,
    getOrgForums,
    fetchOrgForums,
    addOrgForumToCache,
    removeOrgForumFromCache,
    getCachedOrgForums
  }
};
