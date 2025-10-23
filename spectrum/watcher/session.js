// spectrum/watcher/session.js
// Handles Spectrum session acquisition and caching.

const {
  USER_AGENT,
  COMMUNITY_FORUM_URL,
  SESSION_CACHE_KEY,
  SESSION_TTL_MS
} = require('./constants');

const sessionCache = new Map(); // key -> { rsiToken, markToken, expiresAt }

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

module.exports = {
  sessionCache,
  extractCookieValue,
  extractMarkToken,
  getSetCookieHeaders,
  buildSessionObject,
  cacheSessionTokens,
  readCachedTokens,
  fetchSessionTokens,
  createSpectrumSession
};
