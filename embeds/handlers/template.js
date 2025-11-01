const { Events } = require('discord.js');
const {
  buildEmbedsFromText,
  canMemberUseTemplates,
  downloadAttachmentText,
  isLikelyTemplate,
  isTemplateAttachment
} = require('../utils');

const MAX_ATTACHMENTS_PER_MESSAGE = 3;

function chunkPlainText(text) {
  const MAX_CHARS = 2000;
  const chunks = [];

  let remaining = text;

  while (remaining.length > 0) {
    const codePoints = Array.from(remaining);
    if (codePoints.length <= MAX_CHARS) {
      chunks.push(remaining);
      break;
    }

    let chunkEnd = MAX_CHARS;
    for (let idx = chunkEnd - 1; idx >= 0; idx -= 1) {
      if (codePoints[idx] === '\n' && idx > 0) {
        chunkEnd = idx;
        break;
      }
    }

    if (chunkEnd === 0) {
      chunkEnd = MAX_CHARS;
    }

    const chunk = codePoints.slice(0, chunkEnd).join('');
    chunks.push(chunk);

    let restStart = chunkEnd;
    if (restStart < codePoints.length && codePoints[restStart] === '\n') {
      restStart += 1;
    }

    remaining = codePoints.slice(restStart).join('');
  }

  return chunks;
}

async function handleTemplateUpload(message) {
  if (!message || message.author?.bot) {
    return false;
  }

  if (!message.attachments || message.attachments.size === 0) {
    return false;
  }

  const relevant = Array.from(message.attachments.values()).filter(isTemplateAttachment);
  if (relevant.length === 0) {
    return false;
  }

  if (message.guild) {
    let member = message.member || null;
    if (!member && typeof message.guild.members?.fetch === 'function') {
      member = await message.guild.members.fetch(message.author.id).catch(() => null);
    }

    if (!canMemberUseTemplates(member)) {
      await message.author?.send?.('❌ You do not have permission to upload embed templates.').catch(() => {});
      if (typeof message.delete === 'function') {
        const deletion = message.delete();
        if (deletion && typeof deletion.catch === 'function') {
          await deletion.catch(() => {});
        }
      }
      return true;
    }
  }

  const processed = relevant.slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
  let handledAny = false;
  let encounteredError = false;

  for (const attachment of processed) {
    try {
      if (attachment.size && attachment.size > 128 * 1024) {
        throw new Error(`Template "${attachment.name}" is too large (limit 128 KB).`);
      }

      const text = await downloadAttachmentText(attachment.url);
      const trimmedText = text?.trim();
      if (!trimmedText) {
        throw new Error(`Template "${attachment.name}" is empty.`);
      }

      const template = isLikelyTemplate(trimmedText);
      let localHandled = false;

      if (template) {
        const embeds = buildEmbedsFromText(trimmedText);
        if (!embeds.length) {
          throw new Error(`No embed content found in "${attachment.name}".`);
        }

        const chunks = [];
        let pointer = 0;
        while (pointer < embeds.length) {
          chunks.push(embeds.slice(pointer, pointer + 10));
          pointer += 10;
        }

        // Reply in the same channel with the generated embeds.
        // Using send() rather than reply to avoid pinging in busy channels.
        for (const chunk of chunks) {
          // eslint-disable-next-line no-await-in-loop
          await message.channel.send({ embeds: chunk, reply: { messageReference: message.id, failIfNotExists: false } });
        }
        localHandled = true;
      } else {
        const plainChunks = chunkPlainText(trimmedText);
        for (const chunk of plainChunks) {
          // eslint-disable-next-line no-await-in-loop
          await message.channel.send({ content: chunk, reply: { messageReference: message.id, failIfNotExists: false } });
        }
        localHandled = true;
      }

      if (localHandled) {
        handledAny = true;
      }

    } catch (err) {
      const reason = err?.message || 'Unknown parsing error.';
      encounteredError = true;
      await message.reply({ content: `❌ Failed to build embed from **${attachment.name}**: ${reason}` }).catch(() => {});
    }
  }

  if (handledAny && !encounteredError && typeof message.delete === 'function') {
    try {
      await message.delete();
    } catch (err) {
      console.warn('[embeds] Failed to delete template message:', err?.message ?? err);
    }
  }

  return handledAny;
}

function registerTemplateListener(client) {
  const listener = async (message) => {
    try {
      await handleTemplateUpload(message);
    } catch (err) {
      // Swallow errors so we don't interfere with other listeners.
      console.error('[embeds] Failed to handle template upload:', err);
    }
  };

  client.on(Events.MessageCreate, listener);
  return listener;
}

module.exports = {
  handleTemplateUpload,
  registerTemplateListener,
  MAX_ATTACHMENTS_PER_MESSAGE
};
