// spectrum/watcher/poster.js
// Responsible for pushing Spectrum content into Discord channels.

const { EmbedBuilder } = require('discord.js');
const {
  buildDescriptionFromThread,
  extractImageUrl
} = require('./descriptionBuilder');
const { buildThreadUrl } = require('./threadUtils');

async function postToDiscord(client, guildConfig, threadInfo, threadDetails) {
  if (!guildConfig?.announceChannelId) {
    return false;
  }

  const channelId = guildConfig.announceChannelId;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.warn(`spectrumWatcher: channel ${channelId} unavailable for guild ${guildConfig.guildId}`);
    return false;
  }

  const forumId = guildConfig.forumId;
  const slug = threadInfo?.slug || threadDetails?.slug || threadDetails?.thread?.slug;
  const url = buildThreadUrl(forumId, slug);

  const embed = new EmbedBuilder()
    .setTitle(threadInfo?.subject || threadDetails?.subject || threadDetails?.title || 'New Spectrum thread')
    .setURL(url)
    .setColor(0x00aaff)
    .setTimestamp(new Date());

  const author =
    threadInfo?.member ||
    threadDetails?.member ||
    threadDetails?.author ||
    threadDetails?.posts?.[0]?.author ||
    null;

  if (author) {
    embed.setAuthor({
      name: author.displayname || author.nickname || author.handle || 'Unknown Author',
      iconURL: author.avatar || undefined
    });
  } else {
    embed.setAuthor({ name: 'Spectrum' });
  }

  embed.setDescription(buildDescriptionFromThread(threadDetails));

  const imageUrl = extractImageUrl(threadDetails?.content_blocks);
  if (imageUrl) {
    embed.setImage(imageUrl);
  }

  try {
    await channel.send({ embeds: [embed] });
    return true;
  } catch (err) {
    console.error(`spectrumWatcher: failed to post thread ${threadInfo?.id || slug} to channel ${channelId}`, err);
    return false;
  }
}

module.exports = {
  postToDiscord
};
