const SQ42_RE = /squadron\s*42|sq42/i;
const SCW_API_URL = 'https://api.star-citizen.wiki/api/v2/comm-links';
const FETCH_TIMEOUT_MS = 15_000;
const PER_PAGE = 25;
const USER_AGENT = 'sq42-discord-bot/1.0 (Squadron42DiscordBot)';

function toSnippet(raw) {
  if (!raw) return null;
  const text = (Array.isArray(raw) ? raw.join('\n') : String(raw))
    .replace(/<[^>]+>/g, '')
    .trim();
  if (!text) return null;

  // Find the first line that looks like a real sentence: ends with punctuation and is substantive.
  // This skips title/header lines like "PU Monthly Report" or "June 2026".
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const intro = lines.find(l => l.length > 50 && /[.!?]$/.test(l));
  const snippet = intro ?? lines.find(l => l.length > 20);
  if (!snippet) return null;
  return snippet.length > 300 ? snippet.slice(0, 299) + '…' : snippet;
}

async function fetchCommLinks() {
  const url = `${SCW_API_URL}?locale=en_EN&per_page=${PER_PAGE}&page=1`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}${res.statusText ? ' ' + res.statusText : ''}`);

    const json = await res.json();
    const items = json?.data ?? json?.result ?? [];
    if (!Array.isArray(items)) throw new Error('unexpected response shape (no data array)');

    return items.map(item => {
      const seriesRaw = item.series?.name ?? item.series ?? null;
      const series = (seriesRaw && seriesRaw !== 'None') ? seriesRaw : null;
      const channelRaw = item.channel?.name ?? item.channel ?? null;
      const channel = (channelRaw && channelRaw !== 'None') ? channelRaw : null;

      return {
        cigId:       item.id ?? item.cig_id ?? null,
        title:       item.title ?? '',
        url:         item.rsi_url ?? item.url ?? item.link ?? null,
        series:      series ?? channel,
        description: toSnippet(item.translations ?? item.resume ?? item.description ?? item.body ?? null),
        imageUrl:    item.images?.[0]?.src ?? item.background ?? null,
        publishedAt: item.created_at ?? item.published_at ?? null,
      };
    });
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

module.exports = { fetchCommLinks, filterSq42 };
