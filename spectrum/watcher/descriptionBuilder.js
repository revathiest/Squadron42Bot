// spectrum/watcher/descriptionBuilder.js
// Builds human readable descriptions for Spectrum embeds.

function formatPlainText(text) {
  if (!text) return '';

  let cleaned = String(text)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<\/?p>/gi, '')
    .replace(/\[\/?(?:b|i|u|quote|url|img|center|color|size)[^\]]*\]/gi, '')
    .replace(/<[^>]+>/g, '');

  return cleaned.replace(/\r\n/g, '\n').trim();
}

function buildDescriptionFromBlocks(contentBlocks) {
  if (!Array.isArray(contentBlocks)) return '';

  const lines = [];
  const orderedCounters = new Map();

  for (const block of contentBlocks) {
    if (!block || block.type !== 'text') continue;

    const draftBlocks = block.data?.blocks;
    if (!Array.isArray(draftBlocks)) continue;

    for (const node of draftBlocks) {
      if (!node || typeof node.text !== 'string') continue;

      const trimmed = node.text.trim();
      if (!trimmed) continue;

      let prefix = '';
      if (node.type === 'unordered-list-item') prefix = '• ';
      else if (node.type === 'ordered-list-item') {
        const key = block.id || 'ordered';
        const next = (orderedCounters.get(key) || 0) + 1;
        orderedCounters.set(key, next);
        prefix = `${next}. `;
      }

      lines.push(`${prefix}${trimmed}`.trim());
    }
  }

  if (!lines.length) return '';

  const joined = lines.join('\n');
  return joined.length > 3900 ? `${joined.slice(0, 3900)}...` : joined;
}

// ---------- Fixed and improved version ----------

// spectrum/watcher/descriptionBuilder.js
// Safe Cheerio handling for weird Node environments.

let load = null;
try {
  ({ load } = require('cheerio'));
  console.log('Cheerio loaded successfully.');
} catch {
  console.warn('Cheerio not available. Falling back to plain-text parser.');
}

function buildDescriptionFromThread(threadDetails) {
  const blocks =
    threadDetails?.content_blocks?.[0]?.data?.blocks || [];
  if (!Array.isArray(blocks) || blocks.length === 0) return null;

  const lines = [];
  const orderedCounters = new Map();

  for (const node of blocks) {
    if (!node?.text) continue;
    const text = node.text.trim();
    if (!text) continue;

    switch (node.type) {
      case 'header-one':
        lines.push(`\n━━━━━━━━━━━━━━━━━━━━━━`);
        lines.push(`**${text.replace(/\s+/g, ' ')}**`);
        lines.push('');
        break;
      case 'header-two':
      case 'header-three':
        lines.push(`\n__${text.replace(/\s+/g, ' ')}__`);
        break;
      case 'unordered-list-item':
        lines.push(`• ${text}`);
        break;
      case 'ordered-list-item': {
        const key = 'ordered';
        const next = (orderedCounters.get(key) || 0) + 1;
        orderedCounters.set(key, next);
        lines.push(`${next}. ${text}`);
        break;
      }
      case 'blockquote':
        lines.push(`> ${text}`);
        break;
      default:
        lines.push(text);
        break;
    }
  }

  // Only use Cheerio if it’s actually loaded and we find raw HTML
  if (load && threadDetails?.content_html) {
    try {
      const $ = load(threadDetails.content_html);
      $('p, li, blockquote').each((_, el) => {
        const t = $(el).text().trim();
        if (t) lines.push(t);
      });
    } catch (err) {
      console.warn('Cheerio parse failed:', err.message);
    }
  }

  const desc = lines.join('\n').trim();
  return desc.length ? desc.slice(0, 4000) : '*No content found.*';
}

// ------------------------------------------------

function extractImageUrl(contentBlocks) {
  if (!Array.isArray(contentBlocks)) return null;

  for (const block of contentBlocks) {
    if (!block || block.type !== 'image' || !Array.isArray(block.data)) continue;

    for (const entry of block.data) {
      const sizes = entry?.data?.sizes;
      const direct = entry?.data?.url;
      const candidates = [
        sizes?.large?.url,
        sizes?.medium?.url,
        sizes?.small?.url,
        direct,
      ];
      const url = candidates.find(u => typeof u === 'string' && u.trim());
      if (url) return url;
    }
  }
  return null;
}

module.exports = {
  formatPlainText,
  buildDescriptionFromBlocks,
  buildDescriptionFromThread,
  extractImageUrl,
};
