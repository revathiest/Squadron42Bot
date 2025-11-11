// spectrum/watcher/descriptionBuilder.js
// Builds human readable descriptions for Spectrum embeds.

const DEFAULT_SOFT_LIMIT = 1600;
const HARD_CHAR_LIMIT = 3900;
const TRUNCATION_NOTICE = '\n\n... View the full post on Spectrum for more details.';

function formatPlainText(text) {
  if (!text) return '';

  let cleaned = String(text)
    .replace(/<br\s*\/?>(?=\s*<)/gi, '\n')
    .replace(/<br\s*\/?>(?!\s*<)/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<\/?p>/gi, '')
    .replace(/\[\/?(?:b|i|u|quote|url|img|center|color|size)[^\]]*\]/gi, '')
    .replace(/<[^>]+>/g, '');

  return cleaned.replace(/\r\n/g, '\n').trim();
}

function smartTrim(text, limit) {
  if (text.length <= limit) {
    return text.trim();
  }

  const boundaryRegex = /([.!?])(\s|$)/g;
  let boundaryIndex = -1;
  let match;

  while ((match = boundaryRegex.exec(text)) !== null) {
    const idx = match.index + match[0].length;
    if (idx <= limit) {
      boundaryIndex = idx;
    } else {
      break;
    }
  }

  if (boundaryIndex !== -1 && boundaryIndex >= limit * 0.6) {
    return text.slice(0, boundaryIndex).trim();
  }

  const lastNewline = text.lastIndexOf('\n', limit);
  if (lastNewline >= 0 && lastNewline >= limit * 0.5) {
    return text.slice(0, lastNewline).trim();
  }

  const lastSpace = text.lastIndexOf(' ', limit);
  if (lastSpace >= 0 && lastSpace >= limit * 0.5) {
    return text.slice(0, lastSpace).trim();
  }

  return text.slice(0, limit).trim();
}

function summarizeLines(lines, options = {}) {
  const {
    softLimit = DEFAULT_SOFT_LIMIT,
    hardLimit = HARD_CHAR_LIMIT,
    notice = TRUNCATION_NOTICE,
    emptyFallback = '*No content found.*'
  } = options;

  const text = lines
    .filter(line => typeof line === 'string')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!text) {
    return emptyFallback;
  }

  if (text.length <= softLimit) {
    return text;
  }

  const base = smartTrim(text, softLimit);
  const noticeText = notice || '';
  let summary = `${base}${noticeText}`;

  if (summary.length > hardLimit && noticeText.length < hardLimit) {
    const allowance = hardLimit - noticeText.length;
    const trimmed = smartTrim(text, allowance);
    summary = `${trimmed}${noticeText}`;
  }

  return summary;
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
      if (node.type === 'unordered-list-item') {
        prefix = '- ';
      } else if (node.type === 'ordered-list-item') {
        const key = block.id || 'ordered';
        const next = (orderedCounters.get(key) || 0) + 1;
        orderedCounters.set(key, next);
        prefix = `${next}. `;
      }

      lines.push(`${prefix}${trimmed}`.trim());
    }
  }

  if (!lines.length) return '';

  return summarizeLines(lines, {
    emptyFallback: '',
    notice: TRUNCATION_NOTICE
  });
}

function buildDescriptionFromThread(threadDetails) {
  const blocks = threadDetails?.content_blocks?.[0]?.data?.blocks || [];
  if (!Array.isArray(blocks) || blocks.length === 0) return null;

  const lines = [];
  const orderedCounters = new Map();
  let currentSection = '';
  let knownIssuesHeader = null;
  let bugFixesHeader = null;
  let knownIssuesCount = 0;
  let bugFixesCount = 0;

  const knownIssuesFreeform = [];
  let technicalHeaderIndex = null;
  let technicalHeaderLabel = null;

  const isKnownIssuesSection = title => {
    const lower = title.toLowerCase();
    return lower.includes('known') && lower.includes('issue');
  };

  const isBugFixSection = title => {
    const lower = title.toLowerCase();
    return lower.includes('bug') && lower.includes('fix');
  };

  const isTechnicalSection = title => title.toLowerCase().includes('technical');
  const shouldSummarize = title => isKnownIssuesSection(title) || isBugFixSection(title);

  for (const node of blocks) {
    if (!node?.text) continue;
    const text = node.text.trim();
    if (!text) continue;

    if (['header-one', 'header-two', 'header-three'].includes(node.type)) {
      currentSection = text;
      if (isKnownIssuesSection(currentSection) && !knownIssuesHeader) {
        knownIssuesHeader = currentSection;
      } else if (isBugFixSection(currentSection) && !bugFixesHeader) {
        bugFixesHeader = currentSection;
      }
      if (isTechnicalSection(currentSection)) {
        technicalHeaderLabel = currentSection;
      }
      if (shouldSummarize(currentSection)) {
        continue;
      }
      if (node.type === 'header-one') {
        lines.push('');
        lines.push(`**${text.replace(/\s+/g, ' ')}**`);
        if (isTechnicalSection(currentSection)) {
          technicalHeaderIndex = lines.length - 1;
        }
      } else {
        lines.push('');
        lines.push(`__${text.replace(/\s+/g, ' ')}__`);
        if (isTechnicalSection(currentSection)) {
          technicalHeaderIndex = lines.length - 1;
        }
      }
      continue;
    }

    const inKnownSection = currentSection && isKnownIssuesSection(currentSection);
    const inBugSection = currentSection && isBugFixSection(currentSection);

    if (shouldSummarize(currentSection)) {
      if (['unordered-list-item', 'ordered-list-item'].includes(node.type)) {
        if (inKnownSection) {
          knownIssuesCount += 1;
        } else if (inBugSection) {
          bugFixesCount += 1;
        }
        continue;
      }

      if (inKnownSection) {
        knownIssuesFreeform.push(text);
      }
      continue;
    }

    switch (node.type) {
      case 'unordered-list-item':
        lines.push(`- ${text}`);
        break;
      case 'ordered-list-item': {
        const key = currentSection || 'ordered';
        const next = (orderedCounters.get(key) || 0) + 1;
        orderedCounters.set(key, next);
        lines.push(`${next}. ${text}`);
        break;
      }
      case 'blockquote':
        lines.push(`> ${text}`);
        break;
      default:
        if (inKnownSection) {
          knownIssuesFreeform.push(text);
        } else {
          lines.push(text);
        }
        break;
    }
  }

  const summaryLines = [];
  if (knownIssuesFreeform.length || bugFixesCount > 0 || knownIssuesCount > 0) {
    if (knownIssuesFreeform.length) {
      summaryLines.push(...knownIssuesFreeform);
    }
    if (bugFixesCount > 0 || knownIssuesCount > 0) {
      if (summaryLines.length) {
        summaryLines.push('');
      }
      if (bugFixesCount > 0) {
        const label = bugFixesHeader || 'Bug Fixes';
        summaryLines.push(`* ${label}: ${bugFixesCount}`);
      }
      if (knownIssuesCount > 0) {
        const label = knownIssuesHeader || 'Known Issues';
        summaryLines.push(`* ${label}: ${knownIssuesCount}`);
      }
    }
  }

  if (summaryLines.length) {
    if (technicalHeaderIndex === null) {
      lines.push('');
      const headerText = technicalHeaderLabel || 'Technical';
      lines.push(`**${headerText}**`);
      technicalHeaderIndex = lines.length - 1;
    }
    const insertAt = technicalHeaderIndex + 1;
    lines.splice(insertAt, 0, ...summaryLines);
  }

  return summarizeLines(lines);
}

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
        direct
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
  extractImageUrl
};
