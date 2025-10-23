// spectrum/watcher/descriptionBuilder.js
// Builds human readable descriptions for Spectrum embeds.

function formatPlainText(text) {
  if (!text) {
    return '';
  }

  let cleaned = String(text)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<\/?p>/gi, '')
    .replace(/\[\/?(?:b|i|u|quote|url|img|center|color|size)[^\]]*\]/gi, '')
    .replace(/<[^>]+>/g, '');

  cleaned = cleaned.replace(/\r\n/g, '\n').trim();
  return cleaned;
}

function buildDescriptionFromBlocks(contentBlocks) {
  if (!Array.isArray(contentBlocks)) {
    return '';
  }

  const lines = [];
  const orderedCounters = new Map();

  for (const block of contentBlocks) {
    if (!block || block.type !== 'text') {
      continue;
    }

    const draftBlocks = block.data?.blocks;
    if (!Array.isArray(draftBlocks)) {
      continue;
    }

    for (const node of draftBlocks) {
      if (!node || typeof node.text !== 'string') {
        continue;
      }

      const trimmed = node.text.trim();
      if (!trimmed) {
        continue;
      }

      let prefix = '';
      if (node.type === 'unordered-list-item') {
        prefix = '- ';
      } else if (node.type === 'ordered-list-item') {
        const counterKey = block.id || 'ordered';
        const next = (orderedCounters.get(counterKey) || 0) + 1;
        orderedCounters.set(counterKey, next);
        prefix = `${next}. `;
      }

      lines.push(`${prefix}${trimmed}`.trim());
    }
  }

  if (!lines.length) {
    return '';
  }

  const joined = lines.join('\n');
  return joined.length > 3900 ? `${joined.slice(0, 3900)}...` : joined;
}

function buildDescriptionFromThread(threadDetails) {
  if (!threadDetails) {
    return '*No content provided.*';
  }

  const fromBlocks = buildDescriptionFromBlocks(threadDetails.content_blocks);
  if (fromBlocks) {
    return fromBlocks;
  }

  const fallback =
    threadDetails.posts?.[0]?.body ||
    threadDetails.post?.body ||
    threadDetails.first_post?.body ||
    threadDetails.body ||
    threadDetails.content;

  const cleaned = formatPlainText(fallback);
  if (!cleaned) {
    return '*No content provided.*';
  }

  return cleaned.length > 3900 ? `${cleaned.slice(0, 3900)}...` : cleaned;
}

function extractImageUrl(contentBlocks) {
  if (!Array.isArray(contentBlocks)) {
    return null;
  }

  for (const block of contentBlocks) {
    if (!block || block.type !== 'image' || !Array.isArray(block.data)) {
      continue;
    }

    for (const entry of block.data) {
      const sizes = entry?.data?.sizes;
      const direct = entry?.data?.url;
      const candidates = [
        sizes?.large?.url,
        sizes?.medium?.url,
        sizes?.small?.url,
        direct
      ];

      const url = candidates.find(candidate => typeof candidate === 'string' && candidate.trim());
      if (url) {
        return url;
      }
    }
  }

  return null;
}

module.exports = {
  formatPlainText,
  buildDescriptionFromBlocks,
  buildDescriptionFromThread,
  extractImageUrl
};
