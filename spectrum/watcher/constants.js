// spectrum/watcher/constants.js
// Shared constant values for Spectrum Watcher modules.

const USER_AGENT = 'Squadron42Bot/1.0 (Spectrum Watcher)';
const API_ROOT = 'https://robertsspaceindustries.com/api/spectrum';
const COMMUNITY_FORUM_URL = 'https://robertsspaceindustries.com/spectrum/community/SC/forum';
const THREAD_LIST_SORT = 'newest';
const THREAD_VIEW_MODE = 'classic';
const THREAD_DETAIL_SORT = 'newest';
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const SESSION_CACHE_KEY = 'global';
const SESSION_TTL_MS = 15 * 60 * 1000;

module.exports = {
  USER_AGENT,
  API_ROOT,
  COMMUNITY_FORUM_URL,
  THREAD_LIST_SORT,
  THREAD_VIEW_MODE,
  THREAD_DETAIL_SORT,
  DEFAULT_INTERVAL_MS,
  SESSION_CACHE_KEY,
  SESSION_TTL_MS
};
