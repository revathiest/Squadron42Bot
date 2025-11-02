const { ChannelType, MessageFlags } = require('discord.js');
const {
  fetchConfig,
  setConfig,
  clearConfig
} = require('../utils');

async function replyEphemeral(interaction, options) {
  const payload = typeof options === 'string' ? { content: options } : { ...options };
  payload.flags = MessageFlags.Ephemeral;

  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(payload);
  }

  return interaction.reply(payload);
}

async function handleSetChannel(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  const guildId = interaction.guildId;

  if (!guildId || !interaction.guild) {
    await replyEphemeral(interaction, 'This command can only be used inside a guild.');
    return { action: 'noop' };
  }

  if (channel.guildId !== guildId) {
    await replyEphemeral(interaction, 'Please choose a channel from this server.');
    return { action: 'noop' };
  }

  if (
    channel.type !== ChannelType.GuildText &&
    channel.type !== ChannelType.GuildAnnouncement
  ) {
    await replyEphemeral(interaction, 'Spectrum Watcher can only post to text or announcement channels.');
    return { action: 'noop' };
  }

  const config = await setConfig(guildId, channel.id, undefined, interaction.user.id);
  await replyEphemeral(interaction, `Spectrum announcements will post to ${channel} once a forum is configured.`);

  return { action: 'set-channel', config };
}

async function handleSetForum(interaction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await replyEphemeral(interaction, 'This command can only be used inside a guild.');
    return { action: 'noop' };
  }

  const forumIdRaw = interaction.options.getString('forum_id', true);
  const forumId = forumIdRaw.trim();

  if (!forumId) {
    await replyEphemeral(interaction, 'Please provide a valid forum ID.');
    return { action: 'noop' };
  }

  if (forumId.length > 32) {
    await replyEphemeral(interaction, 'Forum IDs must be 32 characters or fewer.');
    return { action: 'noop' };
  }

  const config = await setConfig(guildId, undefined, forumId, interaction.user.id);
  await replyEphemeral(interaction, `Spectrum Watcher will monitor forum **${forumId}**.`);

  return { action: 'set-forum', config };
}

async function handleClear(interaction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await replyEphemeral(interaction, 'This command can only be used inside a guild.');
    return { action: 'noop' };
  }

  const config = await fetchConfig(guildId);
  if (!config) {
    await replyEphemeral(interaction, 'Spectrum Watcher is already cleared for this server.');
    return { action: 'clear', config: null };
  }

  await clearConfig(guildId);
  await replyEphemeral(interaction, 'Spectrum Watcher configuration has been cleared.');

  return { action: 'clear', config: null };
}

async function handlePostLatest(interaction) {
  const guildId = interaction.guildId;
  const client = interaction.client;

  if (!guildId || !client) {
    await replyEphemeral(interaction, 'This command can only be used inside a guild.');
    return { action: 'noop' };
  }

  const config = await fetchConfig(guildId);
  if (!config) {
    await replyEphemeral(interaction, 'Spectrum Watcher is not configured for this server.');
    return { action: 'post-latest', ok: false };
  }

  if (!config.forumId) {
    await replyEphemeral(interaction, 'Set a forum ID before posting the latest thread.');
    return { action: 'post-latest', ok: false, config };
  }

  if (!config.announceChannelId) {
    await replyEphemeral(interaction, 'Set an announcement channel before posting the latest thread.');
    return { action: 'post-latest', ok: false, config };
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // Lazy-load to avoid cyclic dependency issues.
    // eslint-disable-next-line global-require
    const watcher = require('../../spectrumWatcher');
    const result = await watcher.postLatestThreadForGuild(client, guildId);

    if (!result?.ok) {
      await interaction.editReply(result?.message || 'Unable to post the latest Spectrum thread right now.');
      return { action: 'post-latest', ok: false, config, result };
    }

    const threadTitle = result.thread?.subject || result.thread?.title || 'Latest thread';
    const threadUrl = result.threadUrl || 'https://robertsspaceindustries.com/spectrum';
    const channelMention = `<#${config.announceChannelId}>`;
    await interaction.editReply(`Posted **${threadTitle}** to ${channelMention}.\n${threadUrl}`);
    return { action: 'post-latest', ok: true, config, result };
  } catch (err) {
    console.error('spectrumConfig: failed to post latest thread', err);
    await interaction.editReply('Something went wrong while trying to post the latest thread.');
    return { action: 'post-latest', ok: false, error: err };
  }
}

async function handleSpectrumCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();
  switch (subcommand) {
    case 'set-channel':
      return handleSetChannel(interaction);
    case 'set-forum':
      return handleSetForum(interaction);
    case 'clear':
      return handleClear(interaction);
    case 'post-latest':
      return handlePostLatest(interaction);
    default:
      await replyEphemeral(interaction, 'Unsupported subcommand.');
      return { action: 'noop' };
  }
}

async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'spectrum') {
    return false;
  }

  try {
    await handleSpectrumCommand(interaction);
  } catch (err) {
    console.error('spectrumConfig: failed to handle /spectrum command', err);
    await replyEphemeral(interaction, 'Something went wrong while handling this command. Please try again later.');
  }

  return true;
}

module.exports = {
  handleSpectrumCommand,
  handleInteraction
};
