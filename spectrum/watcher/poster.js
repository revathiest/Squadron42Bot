// spectrum/watcher/poster.js
// Responsible for posting Spectrum threads to Discord

const { EmbedBuilder } = require('discord.js');
const { buildDescriptionFromThread, extractImageUrl } = require('./descriptionBuilder');
const { buildThreadUrl } = require('./threadUtils');

async function postToDiscord(client, guildConfig, threadInfo, threadDetails) {
  if (!guildConfig?.announceChannelId) return false;

  const channel = await client.channels.fetch(guildConfig.announceChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return false;

  const forumId = guildConfig.forumId;
  const slug =
    threadInfo?.slug ||
    threadDetails?.slug ||
    threadDetails?.thread?.slug;
  const url = buildThreadUrl(forumId, slug);

  const embed = new EmbedBuilder()
    .setTitle(
      threadInfo?.subject ||
      threadDetails?.subject ||
      threadDetails?.title ||
      'New Spectrum Thread'
    )
    .setURL(url)
    .setColor(0x007bff)
    .setTimestamp();

  const author =
    threadInfo?.member ||
    threadDetails?.member ||
    threadDetails?.author ||
    threadDetails?.posts?.[0]?.author;

  if (author) {
    embed.setAuthor({
      name:
        author.displayname ||
        author.nickname ||
        author.handle ||
        'Unknown Author',
      iconURL: author.avatar || null,
      url,
    });
  }

  // --- FIXED: Skip empty descriptions safely ---
  const desc = buildDescriptionFromThread(threadDetails);
  if (desc && desc.trim().length > 0) {
    embed.setDescription(desc);
  }

  // --- Optional: fallback description for empty posts ---
  // else {
  //   embed.setDescription('*No content available.*');
  // }

  const imageUrl = extractImageUrl(threadDetails?.content_blocks);
  if (imageUrl) embed.setImage(imageUrl);

  embed.setFooter({
    text: `Posted in ${threadDetails?.category?.name || 'Spectrum Forums'}`,
    iconURL: client.user.displayAvatarURL(),
  });

  try {
    await channel.send({ embeds: [embed] });
    return true;
  } catch (err) {
    console.error(
      `SpectrumWatcher: failed to post thread ${threadInfo?.id || slug} to channel ${guildConfig.announceChannelId}`,
      err
    );
    return false;
  }
}

module.exports = { postToDiscord };
