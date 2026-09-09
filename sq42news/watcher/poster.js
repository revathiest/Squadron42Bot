const { EmbedBuilder } = require('discord.js');
const stateStore = require('./stateStore');
const { normalizeTitle } = require('./dedupe');

const DEDUPE_SOURCE = 'dedupe';
const DEDUPE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const DEDUPE_MAX_ENTRIES = 200;

const COLORS = {
  commlinks: 0xfdb620, // RSI gold
  press:     0x5865f2, // blurple
  reddit:    0xff4500, // Reddit orange
  youtube:   0xff0000, // YouTube red
};

const FOOTERS = {
  commlinks: '🚀 Official · Roberts Space Industries',
  press:     '📰 Press Coverage · Third-party, not official CIG content',
  reddit:    '💬 Community · r/starcitizen',
  youtube:   '🎬 Official · Roberts Space Industries',
};

function truncate(text, max) {
  if (!text || text.length <= max) return text || '';
  return text.slice(0, max - 1) + '…';
}

function isValidUrl(str) {
  try { new URL(str); return true; } catch { return false; }
}

function buildEmbed(item, sourceType, botUser) {
  const embed = new EmbedBuilder()
    .setColor(COLORS[sourceType] ?? 0x999999)
    .setTimestamp();

  embed.setFooter({
    text: FOOTERS[sourceType] ?? sourceType,
    iconURL: botUser?.displayAvatarURL() ?? undefined,
  });

  if (item.title) embed.setTitle(truncate(item.title, 256));
  if (item.url && isValidUrl(item.url)) embed.setURL(item.url);
  if (item.description) embed.setDescription(truncate(item.description, 300));
  if (item.series) embed.addFields({ name: 'Series', value: truncate(item.series, 100), inline: true });
  if (item.sourceName) embed.addFields({ name: 'Source', value: truncate(item.sourceName, 100), inline: true });
  if (item.author) embed.addFields({ name: 'Posted by', value: truncate(item.author, 100), inline: true });
  if (item.thumbnailUrl && isValidUrl(item.thumbnailUrl)) embed.setThumbnail(item.thumbnailUrl);
  if (item.imageUrl && isValidUrl(item.imageUrl)) embed.setImage(item.imageUrl);

  return embed;
}

// Tracks stories already posted to a guild (regardless of which source found them) so
// the same underlying story isn't posted again if a different source surfaces it too.
async function isDuplicateStory(guildId, title) {
  const key = normalizeTitle(title);
  if (!key) return false;

  const state = await stateStore.getState(guildId, DEDUPE_SOURCE);
  const cutoff = Date.now() - DEDUPE_WINDOW_MS;
  const entries = (state?.entries ?? []).filter(e => e.postedAt >= cutoff);

  return entries.some(e => e.key === key);
}

async function recordPostedStory(guildId, title) {
  const key = normalizeTitle(title);
  if (!key) return;

  const state = await stateStore.getState(guildId, DEDUPE_SOURCE);
  const cutoff = Date.now() - DEDUPE_WINDOW_MS;
  const entries = (state?.entries ?? []).filter(e => e.postedAt >= cutoff);
  entries.push({ key, postedAt: Date.now() });

  await stateStore.setState(guildId, DEDUPE_SOURCE, { entries: entries.slice(-DEDUPE_MAX_ENTRIES) });
}

async function postItem(client, channelId, item, sourceType, { guildId } = {}) {
  if (!item.title && !item.url) {
    console.warn(`sq42news/poster: skipping ${sourceType} item with no title or URL`);
    return false;
  }

  if (guildId && (await isDuplicateStory(guildId, item.title))) {
    console.log(`sq42news/poster: skipping duplicate story "${item.title}" (${sourceType}) for guild ${guildId}`);
    return false;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.warn(`sq42news/poster: channel ${channelId} not found or not text-based`);
    return false;
  }

  try {
    const embed = buildEmbed(item, sourceType, client.user);
    await channel.send({ embeds: [embed] });
    if (guildId) await recordPostedStory(guildId, item.title);
    return true;
  } catch (err) {
    console.error(`sq42news/poster: failed to post ${sourceType} item to ${channelId}`, err);
    return false;
  }
}

module.exports = { postItem, buildEmbed, __testables: { isDuplicateStory, recordPostedStory } };
