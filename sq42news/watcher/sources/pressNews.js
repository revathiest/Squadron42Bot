const { parseRss } = require('../rssParser');

// Google News RSS: intitle:"Squadron 42", last 1 day, en-US
const GOOGLE_NEWS_URL =
  'https://news.google.com/rss/search?q=intitle%3A%22Squadron+42%22+when%3A1d&hl=en-US&gl=US&ceid=US%3Aen';
const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT = 'sq42-discord-bot/1.0 (Squadron42DiscordBot)';

// Strip articles about general PU patches that match the query incidentally
const STRIP_RE = /\b(alpha|patch\s+\d|update\s+\d|\d+\.\d+\.\d+)\b/i;

function safeHostname(url) {
  try { return url ? new URL(url).hostname : undefined; } catch { return undefined; }
}

// Google News titles are often "Article Title - Source Name". Strip the source suffix.
function cleanTitle(raw) {
  const m = /^(.+?)\s+-\s+[^-]+$/.exec(raw);
  return m ? m[1].trim() : raw;
}

function shouldSkip(item) {
  return STRIP_RE.test(item.title);
}

async function fetchPressNews() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(GOOGLE_NEWS_URL, {
      signal: controller.signal,
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml',
        'User-Agent': USER_AGENT,
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}${res.statusText ? ' ' + res.statusText : ''}`);

    const xml = await res.text();
    return parseRss(xml).map(item => ({
      ...item,
      resolvedSource: item.sourceName || safeHostname(item.sourceUrl),
    }));
  } catch (err) {
    clearTimeout(timer);
    throw err.name === 'AbortError' ? new Error('request timed out after 15s') : err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchPressNews, shouldSkip, cleanTitle };
