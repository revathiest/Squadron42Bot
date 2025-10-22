const { MessageFlags } = require('discord.js');

async function respondEphemeral(interaction, payload) {
  if (!interaction) {
    return;
  }

  const response = typeof payload === 'string'
    ? { content: payload, flags: MessageFlags.Ephemeral }
    : { ...payload, flags: MessageFlags.Ephemeral };

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(response).catch(() => null);
  }

  return interaction.reply(response).catch(() => null);
}

function parseReferenceInput(input) {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const urlMatch = trimmed.match(
    /^https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)(?:\/)?$/i
  );
  if (urlMatch) {
    return {
      guildId: urlMatch[1],
      channelId: urlMatch[2],
      messageId: urlMatch[3],
      raw: trimmed
    };
  }

  const idPair = trimmed.match(/^(\d+):(\d+)$/);
  if (idPair) {
    return {
      channelId: idPair[1],
      messageId: idPair[2],
      raw: trimmed
    };
  }

  return { raw: trimmed };
}

async function fetchReferenceMessage(client, guild, reference) {
  if (!reference || !reference.channelId || !reference.messageId || !guild) {
    return { url: reference?.raw ?? null, content: null };
  }

  if (reference.guildId && reference.guildId !== guild.id) {
    return { url: reference.raw, content: null };
  }

  try {
    const channel = await guild.channels.fetch(reference.channelId);
    if (!channel || typeof channel.messages?.fetch !== 'function') {
      return { url: reference.raw, content: null };
    }

    const message = await channel.messages.fetch(reference.messageId);
    if (!message) {
      return { url: reference.raw, content: null };
    }

    const content = typeof message.content === 'string' ? message.content : null;
    return {
      url: `https://discord.com/channels/${guild.id}/${reference.channelId}/${reference.messageId}`,
      content: content ? content.slice(0, 1900) : null
    };
  } catch (err) {
    console.warn('moderation: Failed to fetch reference message', {
      guildId: guild.id,
      channelId: reference.channelId,
      messageId: reference.messageId
    }, err);
    return { url: reference.raw, content: null };
  }
}

function toTimestamp(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatTimestamp(value) {
  const timestamp = toTimestamp(value);
  if (!timestamp) {
    return 'Unknown time';
  }

  const iso = new Date(timestamp).toISOString();
  return iso.replace('T', ' ').replace('Z', ' UTC');
}

function formatReason(reason) {
  if (!reason) {
    return 'No reason provided.';
  }

  const collapsed = reason.replace(/\s+/g, ' ').trim();
  if (!collapsed) {
    return 'No reason provided.';
  }

  if (collapsed.length > 180) {
    return `${collapsed.slice(0, 177)}...`;
  }

  return collapsed;
}

module.exports = {
  respondEphemeral,
  parseReferenceInput,
  fetchReferenceMessage,
  toTimestamp,
  formatTimestamp,
  formatReason
};
