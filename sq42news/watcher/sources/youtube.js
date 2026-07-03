const { parseAtom } = require('../rssParser');

const LEGACY_URL = 'https://www.youtube.com/feeds/videos.xml?user=RobertsSpaceInd';
const FETCH_TIMEOUT_MS = 15_000;
const SQ42_RE = /squadron\s*42|sq42/i;
const USER_AGENT = 'sq42-discord-bot/1.0 (Squadron42DiscordBot)';

function buildYouTubeUrl() {
  const channelId = process.env.SQ42_YT_CHANNEL_ID;
  if (channelId) {
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
  }
  return LEGACY_URL;
}

async function fetchYouTube() {
  const url = buildYouTubeUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/atom+xml, application/xml, text/xml',
        'User-Agent': USER_AGENT,
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}${res.statusText ? ' ' + res.statusText : ''}`);

    const xml = await res.text();
    return parseAtom(xml);
  } catch (err) {
    clearTimeout(timer);
    throw err.name === 'AbortError' ? new Error('request timed out after 15s') : err;
  } finally {
    clearTimeout(timer);
  }
}

function filterSq42(items) {
  return items.filter(item => SQ42_RE.test(item.title));
}

module.exports = { fetchYouTube, filterSq42, buildYouTubeUrl };
