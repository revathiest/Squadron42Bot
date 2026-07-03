const { ChannelType, MessageFlags } = require('discord.js');
const { fetchConfig, setConfig, clearConfig } = require('../utils');
const stateStore = require('../watcher/stateStore');

const POLL_SOURCE_LABELS = {
  commlinks: 'RSI Comm-Links',
  press:     'Press Coverage',
  youtube:   'YouTube',
};

async function replyEphemeral(interaction, options) {
  const payload = typeof options === 'string' ? { content: options } : { ...options };
  payload.flags = MessageFlags.Ephemeral;
  if (interaction.replied || interaction.deferred) return interaction.followUp(payload);
  return interaction.reply(payload);
}

const SOURCE_LABELS = {
  commlinks: 'RSI Comm-Links',
  press:     'Press Coverage (Google News)',
  youtube:   'YouTube',
};

async function handleSetChannel(interaction) {
  const { guildId } = interaction;
  if (!guildId) {
    await replyEphemeral(interaction, 'This command can only be used in a server.');
    return;
  }

  const channel = interaction.options.getChannel('channel', true);
  if (channel.guildId !== guildId) {
    await replyEphemeral(interaction, 'Please choose a channel from this server.');
    return;
  }
  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
    await replyEphemeral(interaction, 'SQ42 news can only post to text or announcement channels.');
    return;
  }

  await setConfig(guildId, channel.id, interaction.user.id);
  await replyEphemeral(interaction, `SQ42 news will now post to ${channel}.`);
}

async function handleStatus(interaction) {
  const { guildId } = interaction;
  if (!guildId) {
    await replyEphemeral(interaction, 'This command can only be used in a server.');
    return;
  }

  const config = await fetchConfig(guildId);
  const channelDisplay = config?.channelId ? `<#${config.channelId}>` : '*not configured*';

  const lines = [`**SQ42 News Watcher**`, `Channel: ${channelDisplay}`, ''];

  for (const [source, label] of Object.entries(SOURCE_LABELS)) {
    const state = await stateStore.getState(guildId, source);
    const status = state?.seeded ? '✅ active' : '⏳ seeds on next poll';
    lines.push(`• **${label}**: ${status}`);
  }

  if (!config?.channelId) {
    lines.push('', '*Use `/sq42news set-channel` to activate.*');
  }

  await replyEphemeral(interaction, lines.join('\n'));
}

async function handleClear(interaction) {
  const { guildId } = interaction;
  if (!guildId) {
    await replyEphemeral(interaction, 'This command can only be used in a server.');
    return;
  }

  const config = await fetchConfig(guildId);
  if (!config) {
    await replyEphemeral(interaction, 'SQ42 news watcher is not configured for this server.');
    return;
  }

  await clearConfig(guildId);
  await replyEphemeral(interaction, 'SQ42 news watcher configuration cleared.');
}

async function handlePollNow(interaction) {
  const { guildId } = interaction;
  if (!guildId) {
    await replyEphemeral(interaction, 'This command can only be used in a server.');
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // eslint-disable-next-line global-require
    const { pollNowForGuild } = require('../watcher/service');
    const result = await pollNowForGuild(interaction.client, guildId);

    if (!result.ok) {
      await interaction.editReply(result.message);
      return;
    }

    const lines = ['**Poll complete.**'];
    for (const [source, r] of Object.entries(result.results)) {
      const label = POLL_SOURCE_LABELS[source] ?? source;
      if (r.error) {
        lines.push(`• ${label}: ⚠️ ${r.error}`);
      } else {
        const n = r.posted ?? 0;
        lines.push(`• ${label}: ${n} new post${n === 1 ? '' : 's'}`);
      }
    }

    await interaction.editReply(lines.join('\n'));
  } catch (err) {
    console.error('sq42news: poll-now error', err);
    await interaction.editReply('Poll failed. Check the bot logs for details.');
  }
}

async function handlePreview(interaction) {
  const { guildId } = interaction;
  if (!guildId) {
    await replyEphemeral(interaction, 'This command can only be used in a server.');
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // eslint-disable-next-line global-require
    const { previewForGuild } = require('../watcher/service');
    const result = await previewForGuild(interaction.client, guildId);

    if (!result.ok) {
      await interaction.editReply(result.message);
      return;
    }

    const lines = ['**Preview posted to channel.**'];
    for (const [source, r] of Object.entries(result.results)) {
      const label = POLL_SOURCE_LABELS[source] ?? source;
      if (r.error)   lines.push(`• ${label}: ⚠️ ${r.error}`);
      else if (r.skipped) lines.push(`• ${label}: ℹ️ ${r.skipped}`);
      else           lines.push(`• ${label}: ✅ ${r.posted}`);
    }

    await interaction.editReply(lines.join('\n'));
  } catch (err) {
    console.error('sq42news: preview error', err);
    await interaction.editReply('Preview failed. Check the bot logs for details.');
  }
}

async function handleSq42NewsCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'set-channel') return handleSetChannel(interaction);
  if (sub === 'status')      return handleStatus(interaction);
  if (sub === 'clear')       return handleClear(interaction);
  if (sub === 'poll-now')    return handlePollNow(interaction);
  if (sub === 'preview')     return handlePreview(interaction);
  await replyEphemeral(interaction, 'Unknown subcommand.');
}

async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'sq42news') return false;

  try {
    await handleSq42NewsCommand(interaction);
  } catch (err) {
    console.error('sq42news: /sq42news command error', err);
    await replyEphemeral(interaction, 'Something went wrong. Please try again later.');
  }

  return true;
}

module.exports = { handleInteraction, handleSq42NewsCommand };
