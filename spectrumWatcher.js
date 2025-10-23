// spectrumWatcher.js
// Monitors RSI Spectrum forums and posts new threads into configured Discord channels.

const { EmbedBuilder } = require('discord.js');
const spectrumConfig = require('./spectrum/config');
const { getPool } = require('./database');

const USER_AGENT = 'Squadron42Bot/1.0 (Spectrum Watcher)';
const API_ROOT = 'https://robertsspaceindustries.com/api/spectrum';
const COMMUNITY_FORUM_URL = 'https://robertsspaceindustries.com/spectrum/community/SC/forum';
const THREAD_LIST_SORT = 'newest';
const THREAD_VIEW_MODE = 'classic';
const THREAD_DETAIL_SORT = 'newest';
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const SESSION_CACHE_KEY = 'global';
const SESSION_TTL_MS = 15 * 60 * 1000;

const stateCache = new Map(); // guildId -> { raw: string, numeric: bigint|null }
const sessionCache = new Map(); // key -> { rsiToken, markToken, expiresAt }

let initialized = false;
let clientRef = null;
let pollTimer = null;
let pollIntervalMs = DEFAULT_INTERVAL_MS;
let isChecking = false;

function extractCookieValue(setCookies, name) {
  if (!Array.isArray(setCookies) || !setCookies.length) {
    return null;
  }

  const prefix = `${name}=`;
  for (const cookie of setCookies) {
    if (typeof cookie !== 'string') {
      continue;
    }
    const parts = cookie.split(';');
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.startsWith(prefix)) {
        return trimmed.slice(prefix.length);
      }
    }
  }

  return null;
}

function extractMarkToken(html) {
  if (!html) {
    return null;
  }

  const singleQuoteMatch = /'token'\s*:\s*'([^']+)'/.exec(html);
  if (singleQuoteMatch) {
    return singleQuoteMatch[1];
  }

  const doubleQuoteMatch = /"token"\s*:\s*"([^"]+)"/.exec(html);
  return doubleQuoteMatch ? doubleQuoteMatch[1] : null;
}

function getSetCookieHeaders(response) {
  if (!response || !response.headers) {
    return [];
  }

  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie();
  }

  const rawGetter = response.headers.raw?.bind(response.headers);
  if (rawGetter) {
    return rawGetter()['set-cookie'] || rawGetter()['Set-Cookie'] || [];
  }

  const cookie = response.headers.get?.('set-cookie');
  return cookie ? [cookie] : [];
}

function buildSessionObject(tokens, forumId) {
  if (!tokens?.rsiToken || !tokens?.markToken) {
    return null;
  }

  const refererBase = `${COMMUNITY_FORUM_URL}/${encodeURIComponent(forumId)}`;

  return {
    forumId: String(forumId),
    rsiToken: tokens.rsiToken,
    markToken: tokens.markToken,
    referer: refererBase,
    cookieHeader: `Rsi-Token=${tokens.rsiToken}; Rsi-Mark=${tokens.markToken}`
  };
}

function cacheSessionTokens(tokens) {
  if (!tokens?.rsiToken || !tokens?.markToken) {
    return;
  }

  sessionCache.set(SESSION_CACHE_KEY, {
    rsiToken: tokens.rsiToken,
    markToken: tokens.markToken,
    expiresAt: Date.now() + SESSION_TTL_MS
  });
}

function readCachedTokens(options = {}) {
  const allowExpired = options.allowExpired === true;
  const cached = sessionCache.get(SESSION_CACHE_KEY);
  if (!cached) {
    return null;
  }

  if (!allowExpired && cached.expiresAt && cached.expiresAt <= Date.now()) {
    return null;
  }

  return { rsiToken: cached.rsiToken, markToken: cached.markToken };
}

async function fetchSessionTokens(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    if (!response.ok) {
      console.warn(`spectrumWatcher: token preflight failed for ${url} (${response.status})`);
      return null;
    }

    const html = await response.text();
    const setCookies = getSetCookieHeaders(response);

    const rsiToken =
      extractCookieValue(setCookies, 'Rsi-Token') ||
      extractCookieValue(setCookies, 'RSI-Token') ||
      extractCookieValue(setCookies, 'rsi-token');

    const markToken = extractMarkToken(html);

    if (!rsiToken || !markToken) {
      return null;
    }

    cacheSessionTokens({ rsiToken, markToken });
    return { rsiToken, markToken };
  } catch (err) {
    console.error(`spectrumWatcher: failed to fetch session tokens from ${url}`, err);
    return null;
  }
}

async function createSpectrumSession(forumId) {
  const cachedTokens = readCachedTokens();
  if (cachedTokens?.rsiToken && cachedTokens?.markToken) {
    return buildSessionObject(cachedTokens, forumId);
  }

  const forumPath = `${COMMUNITY_FORUM_URL}/${encodeURIComponent(forumId)}`;
  const candidateUrls = [
    forumPath,
    `${forumPath}/`,
    COMMUNITY_FORUM_URL,
    'https://robertsspaceindustries.com/spectrum'
  ];

  for (const candidate of candidateUrls) {
    const tokens = await fetchSessionTokens(candidate);
    if (tokens?.rsiToken && tokens?.markToken) {
      return buildSessionObject(tokens, forumId);
    }
  }

  const fallback = readCachedTokens({ allowExpired: true });
  if (fallback?.rsiToken && fallback?.markToken) {
    console.warn(`spectrumWatcher: using cached tokens after refresh failure for forum ${forumId}`);
    return buildSessionObject(fallback, forumId);
  }

  console.warn(`spectrumWatcher: missing tokens for forum ${forumId}`);
  return null;
}

async function spectrumApiPost(session, endpoint, payload) {
  if (!session) {
    return null;
  }

  try {
    const response = await fetch(`${API_ROOT}${endpoint}`, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'X-Requested-With': 'XMLHttpRequest',
        'X-Rsi-Mark': session.markToken,
        'X-Rsi-Token': session.rsiToken,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Referer': session.referer,
        'Cookie': session.cookieHeader
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();

    if (!response.ok) {
      console.error(`spectrumWatcher: request to ${endpoint} failed (${response.status})`, text);
      return null;
    }

    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (err) {
      console.error(`spectrumWatcher: invalid JSON payload from ${endpoint}`, err);
      return null;
    }

    if (!json || json.success !== 1) {
      const message = json?.msg || 'unknown error';
      console.error(`spectrumWatcher: API responded with failure for ${endpoint}: ${message}`);
      return null;
    }

    return json.data ?? null;
  } catch (err) {
    console.error(`spectrumWatcher: request to ${endpoint} threw`, err);
    return null;
  }
}

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

async function ensureStateSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS spectrum_watcher_state (
      guild_id VARCHAR(20) NOT NULL PRIMARY KEY,
      last_thread_id VARCHAR(32) NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await pool.query(`
    ALTER TABLE spectrum_watcher_state
      MODIFY guild_id VARCHAR(20) NOT NULL,
      MODIFY last_thread_id VARCHAR(32) NULL
  `).catch(() => {});
}

async function loadState(pool) {
  const [rows] = await pool.query('SELECT guild_id, last_thread_id FROM spectrum_watcher_state');
  stateCache.clear();
  for (const row of rows) {
    const threadId = toThreadId(row.last_thread_id);
    if (threadId) {
      stateCache.set(String(row.guild_id), threadId);
    }
  }
}

async function getLastSeenThread(guildId) {
  const key = String(guildId);
  const cached = stateCache.get(key);
  if (cached) {
    return cached;
  }

  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT last_thread_id FROM spectrum_watcher_state WHERE guild_id = ?',
    [key]
  );

  if (!rows.length) {
    return null;
  }

  const threadId = toThreadId(rows[0].last_thread_id);
  if (threadId) {
    stateCache.set(key, threadId);
  }
  return threadId;
}

async function setLastSeenThread(guildId, threadIdValue) {
  const key = String(guildId);
  const threadId = toThreadId(threadIdValue);
  if (!threadId) {
    return null;
  }

  const pool = getPool();
  await pool.query(
    `
      INSERT INTO spectrum_watcher_state (guild_id, last_thread_id)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE last_thread_id = VALUES(last_thread_id)
    `,
    [key, threadId.raw]
  );

  stateCache.set(key, threadId);
  return threadId;
}

async function fetchThreadsWithSession(forumId) {
  const session = await createSpectrumSession(forumId);
  if (!session) {
    return { threads: [], session: null };
  }

  const payload = await spectrumApiPost(session, '/forum/channel/threads', {
    channel_id: String(forumId),
    page: 1,
    sort: THREAD_LIST_SORT
  });

  if (!payload || !Array.isArray(payload.threads)) {
    return { threads: [], session };
  }

  return { threads: payload.threads, session };
}

async function fetchThreads(forumId) {
  const { threads } = await fetchThreadsWithSession(forumId);
  return threads;
}

async function fetchThreadDetails(session, slug) {
  if (!session || !slug) {
    return null;
  }

  const payload = await spectrumApiPost(session, `/forum/thread/${THREAD_VIEW_MODE}`, {
    slug,
    sort: THREAD_DETAIL_SORT
  });

  return payload || null;
}

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
        prefix = '• ';
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

function buildThreadUrl(forumId, slug) {
  return slug
    ? `${COMMUNITY_FORUM_URL}/${encodeURIComponent(forumId)}/thread/${encodeURIComponent(slug)}`
    : `${COMMUNITY_FORUM_URL}/${encodeURIComponent(forumId)}`;
}

async function postToDiscord(client, guildConfig, threadInfo, threadDetails) {
  if (!guildConfig?.announceChannelId) {
    return false;
  }

  const channelId = guildConfig.announceChannelId;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.warn(`spectrumWatcher: channel ${channelId} unavailable for guild ${guildConfig.guildId}`);
    return false;
  }

  const forumId = guildConfig.forumId;
  const slug = threadInfo?.slug || threadDetails?.slug || threadDetails?.thread?.slug;
  const url = buildThreadUrl(forumId, slug);

  const embed = new EmbedBuilder()
    .setTitle(threadInfo?.subject || threadDetails?.subject || threadDetails?.title || 'New Spectrum thread')
    .setURL(url)
    .setColor(0x00aaff)
    .setTimestamp(new Date());

  const author =
    threadInfo?.member ||
    threadDetails?.member ||
    threadDetails?.author ||
    threadDetails?.posts?.[0]?.author ||
    null;

  if (author) {
    embed.setAuthor({
      name: author.displayname || author.nickname || author.handle || 'Unknown Author',
      iconURL: author.avatar || undefined
    });
  } else {
    embed.setAuthor({ name: 'Spectrum' });
  }

  embed.setDescription(buildDescriptionFromThread(threadDetails));

  const imageUrl = extractImageUrl(threadDetails?.content_blocks);
  if (imageUrl) {
    embed.setImage(imageUrl);
  }

  try {
    await channel.send({ embeds: [embed] });
    return true;
  } catch (err) {
    console.error(`spectrumWatcher: failed to post thread ${threadInfo?.id || slug} to channel ${channelId}`, err);
    return false;
  }
}

async function checkForumForGuild(client, guildConfig) {
  const { guildId, forumId } = guildConfig;
  if (!forumId) {
    return;
  }

  const { threads, session } = await fetchThreadsWithSession(forumId);
  if (!threads.length || !session) {
    return;
  }

  const sorted = threads
    .map(thread => {
      const id = thread?.id ?? thread?.thread_id ?? thread?.threadId ?? thread?.post_id;
      return {
        raw: thread,
        threadId: toThreadId(id)
      };
    })
    .filter(entry => entry.threadId !== null)
    .sort((a, b) => {
      const { threadId: aId } = a;
      const { threadId: bId } = b;
      if (aId.numeric !== null && bId.numeric !== null) {
        return aId.numeric < bId.numeric ? -1 : aId.numeric > bId.numeric ? 1 : 0;
      }
      return aId.raw.localeCompare(bId.raw);
    });

  if (!sorted.length) {
    return;
  }

  const lastSeen = await getLastSeenThread(guildId);
  let newestTracked = lastSeen;
  const newThreads = [];

  for (const entry of sorted) {
    if (!lastSeen) {
      newestTracked = entry.threadId;
      continue;
    }

    if (isThreadNewer(entry.threadId, lastSeen)) {
      newThreads.push(entry);
    }
  }

  if (!lastSeen && newestTracked) {
    await setLastSeenThread(guildId, newestTracked.raw);
    return;
  }

  if (!newThreads.length) {
    return;
  }

  newThreads.sort((a, b) => {
    const { threadId: aId } = a;
    const { threadId: bId } = b;
    if (aId.numeric !== null && bId.numeric !== null) {
      return aId.numeric < bId.numeric ? -1 : aId.numeric > bId.numeric ? 1 : 0;
    }
    return aId.raw.localeCompare(bId.raw);
  });

  for (const entry of newThreads) {
    const threadIdRaw = entry.threadId.raw;
    const slug = entry.raw?.slug || entry.raw?.thread?.slug;
    if (!slug) {
      console.warn(`spectrumWatcher: thread ${threadIdRaw} missing slug, skipping`);
      continue;
    }

    const details = await fetchThreadDetails(session, slug);
    if (!details) {
      continue;
    }

    const posted = await postToDiscord(client, guildConfig, entry.raw, details);
    if (posted) {
      await setLastSeenThread(guildId, threadIdRaw);
      newestTracked = entry.threadId;
    }
  }
}

async function checkForNewThreads(client) {
  if (isChecking) {
    return;
  }

  isChecking = true;
  try {
    const configs = spectrumConfig
      .getConfigsSnapshot()
      .filter(config => config.forumId && config.announceChannelId);

    for (const config of configs) {
      await checkForumForGuild(client, config);
    }
  } catch (err) {
    console.error('spectrumWatcher: checkForNewThreads failed', err);
  } finally {
    isChecking = false;
  }
}

async function postLatestThreadForGuild(client, guildId) {
  const config = await spectrumConfig.fetchConfig(guildId);
  if (!config) {
    return { ok: false, message: 'Spectrum Watcher is not configured for this server.' };
  }

  if (!config.forumId) {
    return { ok: false, message: 'No forum ID is configured for this server.' };
  }

  if (!config.announceChannelId) {
    return { ok: false, message: 'No announcement channel is configured for this server.' };
  }

  const { threads, session } = await fetchThreadsWithSession(config.forumId);
  if (!threads.length || !session) {
    return { ok: false, message: 'Unable to retrieve threads from Spectrum at the moment.' };
  }

  const sorted = threads
    .map(thread => ({
      raw: thread,
      threadId: toThreadId(thread?.id ?? thread?.thread_id ?? thread?.threadId ?? thread?.post_id)
    }))
    .filter(entry => entry.threadId !== null)
    .sort((a, b) => {
      if (isThreadNewer(a.threadId, b.threadId)) {
        return 1;
      }
      if (isThreadNewer(b.threadId, a.threadId)) {
        return -1;
      }
      return 0;
    });

  if (!sorted.length) {
    return { ok: false, message: 'No valid threads were returned by Spectrum.' };
  }

  const latest = sorted[sorted.length - 1];
  const slug = latest.raw?.slug || latest.raw?.thread?.slug;
  if (!slug) {
    return { ok: false, message: 'The latest thread is missing a slug, so it cannot be posted.' };
  }

  const details = await fetchThreadDetails(session, slug);
  if (!details) {
    return { ok: false, message: 'Unable to load the latest thread details from Spectrum.' };
  }

  const posted = await postToDiscord(client, config, latest.raw, details);
  if (!posted) {
    return { ok: false, message: 'Failed to send the latest thread to the configured channel.' };
  }

  await setLastSeenThread(guildId, latest.threadId.raw);

  return {
    ok: true,
    thread: latest.raw,
    threadDetails: details,
    threadUrl: buildThreadUrl(config.forumId, slug),
    channelId: config.announceChannelId
  };
}

function schedulePolling(client) {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  pollTimer = setInterval(() => {
    checkForNewThreads(client).catch(err => {
      console.error('spectrumWatcher: polling cycle failed', err);
    });
  }, pollIntervalMs);

  if (typeof pollTimer.unref === 'function') {
    pollTimer.unref();
  }
}

async function initialize(client) {
  if (initialized) {
    return;
  }

  await spectrumConfig.initialize(client);

  const pool = getPool();
  await ensureStateSchema(pool);
  await loadState(pool);

  pollIntervalMs = parseInterval(process.env.SPECTRUM_POLL_INTERVAL_MS);

  clientRef = client;
  initialized = true;
}

async function onReady(client) {
  if (!initialized) {
    await initialize(client);
  }

  clientRef = client;
  schedulePolling(client);

  // Kick off an initial poll without waiting for the first interval tick.
  setTimeout(() => {
    checkForNewThreads(client).catch(err => {
      console.error('spectrumWatcher: initial poll failed', err);
    });
  }, 10000);
}

function getSlashCommandDefinitions() {
  return spectrumConfig.getSlashCommandDefinitions();
}

module.exports = {
  getSlashCommandDefinitions,
  initialize,
  onReady,
  fetchThreads,
  fetchThreadDetails,
  checkForNewThreads,
  getLastSeenThread,
  setLastSeenThread,
  postLatestThreadForGuild,
  __testables: {
    ensureStateSchema,
    loadState,
    stateCache,
    isThreadNewer,
    toThreadId,
    extractCookieValue,
    extractMarkToken,
    buildDescriptionFromThread,
    buildDescriptionFromBlocks,
    formatPlainText,
    extractImageUrl,
    buildThreadUrl,
    schedulePolling: () => schedulePolling(clientRef)
  }
};
