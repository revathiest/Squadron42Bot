const { parseRss } = require('../rssParser');

const FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_UA = 'Discord:sq42-discord-bot:1.0 (by /u/RevAthiest)';
const SQ42_RE = /squadron\s*42|sq42/i;

// Reddit's /search.rss with flair queries requires auth and returns 403.
// /r/starcitizen/new.rss is reliably accessible without credentials.
const REDDIT_URL = 'https://www.reddit.com/r/starcitizen/new.rss?limit=25';

function filterSq42(items) {
  return items.filter(item => SQ42_RE.test(item.title));
}

async function fetchReddit() {
  const userAgent = process.env.SQ42_REDDIT_USER_AGENT || DEFAULT_UA;
  const url = REDDIT_URL;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml',
        'User-Agent': userAgent,
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}${res.statusText ? ' ' + res.statusText : ''}`);

    const xml = await res.text();
    return parseRss(xml);
  } catch (err) {
    clearTimeout(timer);
    throw err.name === 'AbortError' ? new Error('request timed out after 15s') : err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchReddit, filterSq42 };
