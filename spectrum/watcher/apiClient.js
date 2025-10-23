// spectrum/watcher/apiClient.js
// Thin HTTP client for talking to Spectrum endpoints.

const {
  USER_AGENT,
  API_ROOT,
  THREAD_LIST_SORT,
  THREAD_VIEW_MODE,
  THREAD_DETAIL_SORT
} = require('./constants');
const { createSpectrumSession } = require('./session');

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

module.exports = {
  spectrumApiPost,
  fetchThreadsWithSession,
  fetchThreads,
  fetchThreadDetails
};
