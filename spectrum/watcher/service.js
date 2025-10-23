// spectrum/watcher/service.js
// Orchestrates Spectrum Watcher behaviour using modular helpers.

const spectrumConfig = require('../config');
const { getPool } = require('../../database');
const { DEFAULT_INTERVAL_MS } = require('./constants');
const {
  fetchThreadsWithSession,
  fetchThreads,
  fetchThreadDetails
} = require('./apiClient');
const { postToDiscord } = require('./poster');
const {
  stateCache,
  ensureStateSchema,
  loadState,
  getLastSeenThread,
  setLastSeenThread
} = require('./stateStore');
const {
  parseInterval,
  toThreadId,
  isThreadNewer,
  buildThreadUrl
} = require('./threadUtils');
const {
  formatPlainText,
  buildDescriptionFromBlocks,
  buildDescriptionFromThread,
  extractImageUrl
} = require('./descriptionBuilder');
const {
  extractCookieValue,
  extractMarkToken
} = require('./session');

let initialized = false;
let clientRef = null;
let pollTimer = null;
let pollIntervalMs = DEFAULT_INTERVAL_MS;
let isChecking = false;

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
