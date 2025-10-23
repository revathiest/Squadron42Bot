// spectrum/watcher/threadUtils.js
// Helpers for working with Spectrum thread metadata.

const { DEFAULT_INTERVAL_MS, COMMUNITY_FORUM_URL } = require('./constants');

function parseInterval(value) {
  if (!value) {
    return DEFAULT_INTERVAL_MS;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 15000) {
    return DEFAULT_INTERVAL_MS;
  }

  return parsed;
}

function toThreadId(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const raw = String(value);
  try {
    const numeric = BigInt(raw);
    return { raw, numeric };
  } catch {
    return { raw, numeric: null };
  }
}

function isThreadNewer(candidate, baseline) {
  if (!baseline) {
    return true;
  }

  if (candidate.numeric !== null && baseline.numeric !== null) {
    return candidate.numeric > baseline.numeric;
  }

  return candidate.raw > baseline.raw;
}

function buildThreadUrl(forumId, slug) {
  return slug
    ? `${COMMUNITY_FORUM_URL}/${encodeURIComponent(forumId)}/thread/${encodeURIComponent(slug)}`
    : `${COMMUNITY_FORUM_URL}/${encodeURIComponent(forumId)}`;
}

module.exports = {
  parseInterval,
  toThreadId,
  isThreadNewer,
  buildThreadUrl
};
