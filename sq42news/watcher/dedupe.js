// Trailing " - Source Name" / " – Source Name" attribution suffixes some feeds append to titles.
const TRAILING_SOURCE_RE = /\s+[-–—]\s+[^-–—]+$/;

function normalizeTitle(rawTitle) {
  if (!rawTitle) return '';

  let title = String(rawTitle).trim().toLowerCase();
  title = title.replace(TRAILING_SOURCE_RE, '');
  title = title.replace(/['’"“”]/g, '');
  title = title.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  title = title.replace(/\s+/g, ' ').trim();

  return title;
}

module.exports = { normalizeTitle };
