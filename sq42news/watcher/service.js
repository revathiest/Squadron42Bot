const { getPool } = require('../../database');
const configStore = require('../utils');
const stateStore = require('./stateStore');
const { postItem } = require('./poster');
const { fetchCommLinks, filterSq42: filterCommLinks } = require('./sources/commLinks');
const { fetchPressNews, shouldSkip: shouldSkipPress, cleanTitle } = require('./sources/pressNews');
const { fetchYouTube, filterSq42: filterYouTube } = require('./sources/youtube');

const MAX_SEEN = 200;
const INITIAL_DELAY_MS = 10_000;

let initialized = false;
const timers = {};
const isChecking = {};

function parseMs(envVar, defaultMs) {
  const v = parseInt(process.env[envVar], 10);
  return Number.isFinite(v) && v > 0 ? v : defaultMs;
}

// ─── Per-guild poll handlers ────────────────────────────────────────────────

async function pollCommLinksForGuild(client, guild, items) {
  const filtered = filterCommLinks(items);

  const state = await stateStore.getState(guild.guildId, 'commlinks');

  const sorted = filtered
    .map(item => ({ ...item, numId: Number(item.cigId) || 0 }))
    .sort((a, b) => a.numId - b.numId);

  const newestId = sorted.length ? sorted[sorted.length - 1].numId : 0;

  if (!state?.seeded) {
    await stateStore.setState(guild.guildId, 'commlinks', { lastCigId: newestId, seeded: true });
    return { posted: 0 };
  }

  const lastCigId = Number(state.lastCigId) || 0;
  const newItems = sorted.filter(item => item.numId > lastCigId);
  if (!newItems.length) return { posted: 0 };

  let highwater = lastCigId;
  let posted = 0;
  for (const item of newItems) {
    const ok = await postItem(client, guild.channelId, item, 'commlinks');
    if (ok) {
      posted++;
      if (item.numId > highwater) highwater = item.numId;
    }
  }

  if (highwater > lastCigId) {
    await stateStore.setState(guild.guildId, 'commlinks', { lastCigId: highwater, seeded: true });
  }
  return { posted };
}

async function pollPressForGuild(client, guild, items) {
  const filtered = items.filter(item => !shouldSkipPress(item));
  const state = await stateStore.getState(guild.guildId, 'press');

  if (!state?.seeded) {
    const baseline = filtered.map(i => i.guid).filter(Boolean).slice(-MAX_SEEN);
    await stateStore.setState(guild.guildId, 'press', { seenGuids: baseline, seeded: true });
    return { posted: 0 };
  }

  const seenSet = new Set(state.seenGuids ?? []);
  const newItems = filtered.filter(item => item.guid && !seenSet.has(item.guid));
  if (!newItems.length) return { posted: 0 };

  newItems.sort((a, b) => {
    const at = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const bt = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return at - bt;
  });

  let posted = 0;
  for (const item of newItems) {
    const ok = await postItem(client, guild.channelId, {
      title: cleanTitle(item.title),
      url: item.link,
      sourceName: item.resolvedSource,
    }, 'press');
    if (ok) { posted++; seenSet.add(item.guid); }
  }

  const updatedGuids = Array.from(seenSet).slice(-MAX_SEEN);
  await stateStore.setState(guild.guildId, 'press', { seenGuids: updatedGuids, seeded: true });
  return { posted };
}

async function pollYouTubeForGuild(client, guild, items) {
  const filtered = filterYouTube(items);
  const state = await stateStore.getState(guild.guildId, 'youtube');

  if (!state?.seeded) {
    const baseline = filtered.map(i => i.id).filter(Boolean).slice(-MAX_SEEN);
    await stateStore.setState(guild.guildId, 'youtube', { seenIds: baseline, seeded: true });
    return { posted: 0 };
  }

  const seenSet = new Set(state.seenIds ?? []);
  const newItems = filtered.filter(item => item.id && !seenSet.has(item.id));
  if (!newItems.length) return { posted: 0 };

  newItems.sort((a, b) => {
    const at = a.published ? new Date(a.published).getTime() : 0;
    const bt = b.published ? new Date(b.published).getTime() : 0;
    return at - bt;
  });

  let posted = 0;
  for (const item of newItems) {
    const ok = await postItem(client, guild.channelId, {
      title: item.title,
      url: item.link,
      imageUrl: item.thumbnailUrl,
      description: item.description ? item.description.slice(0, 200) : undefined,
    }, 'youtube');
    if (ok) { posted++; seenSet.add(item.id); }
  }

  const updatedIds = Array.from(seenSet).slice(-MAX_SEEN);
  await stateStore.setState(guild.guildId, 'youtube', { seenIds: updatedIds, seeded: true });
  return { posted };
}

// ─── Global poll cycles (fetch once, broadcast to all configured guilds) ───

async function runCommLinksCycle(client) {
  const guilds = configStore.getConfigsSnapshot().filter(g => g.channelId);
  if (!guilds.length) return;

  const items = await fetchCommLinks();
  if (!items) return;

  await Promise.allSettled(guilds.map(g => pollCommLinksForGuild(client, g, items)));
}

async function runPressCycle(client) {
  const guilds = configStore.getConfigsSnapshot().filter(g => g.channelId);
  if (!guilds.length) return;

  const items = await fetchPressNews();
  if (!items) return;

  await Promise.allSettled(guilds.map(g => pollPressForGuild(client, g, items)));
}

async function runYouTubeCycle(client) {
  const guilds = configStore.getConfigsSnapshot().filter(g => g.channelId);
  if (!guilds.length) return;

  const items = await fetchYouTube();
  if (!items) return;

  await Promise.allSettled(guilds.map(g => pollYouTubeForGuild(client, g, items)));
}

// ─── Scheduling ─────────────────────────────────────────────────────────────

const SOURCES = {
  commlinks: { cycle: runCommLinksCycle, envVar: 'SQ42_COMMLINKS_INTERVAL_MS', defaultMs: 15 * 60 * 1000 },
  press:     { cycle: runPressCycle,     envVar: 'SQ42_PRESS_INTERVAL_MS',     defaultMs: 30 * 60 * 1000 },
  youtube:   { cycle: runYouTubeCycle,   envVar: 'SQ42_YOUTUBE_INTERVAL_MS',   defaultMs: 30 * 60 * 1000 },
};

function scheduleSource(client, name, { cycle, envVar, defaultMs }) {
  if (timers[name]) clearInterval(timers[name]);

  const intervalMs = parseMs(envVar, defaultMs);

  timers[name] = setInterval(() => {
    if (isChecking[name]) return;
    isChecking[name] = true;
    cycle(client)
      .catch(err => console.error(`sq42news: ${name} cycle error`, err))
      .finally(() => { isChecking[name] = false; });
  }, intervalMs);

  if (typeof timers[name].unref === 'function') timers[name].unref();
}

async function initialize(client) {
  if (initialized) return;

  const pool = getPool();
  await configStore.ensureSchema(pool);
  await stateStore.ensureStateSchema(pool);
  await configStore.loadCache(pool);
  await stateStore.loadState(pool);

  initialized = true;
}

async function onReady(client) {
  if (!initialized) await initialize(client);

  for (const [name, opts] of Object.entries(SOURCES)) {
    scheduleSource(client, name, opts);
  }

  // Stagger initial polls so they don't all hit at once
  let delay = INITIAL_DELAY_MS;
  for (const [name, { cycle }] of Object.entries(SOURCES)) {
    const d = delay;
    delay += 5_000;
    setTimeout(() => {
      if (isChecking[name]) return;
      isChecking[name] = true;
      cycle(client)
        .catch(err => console.error(`sq42news: ${name} initial poll failed`, err))
        .finally(() => { isChecking[name] = false; });
    }, d);
  }
}

async function previewForGuild(client, guildId) {
  const config = await configStore.fetchConfig(guildId);
  if (!config?.channelId) {
    return { ok: false, message: 'No channel configured. Run `/sq42news set-channel` first.' };
  }

  const results = {};

  const tryPost = async (label, fetchFn, pickFn) => {
    try {
      const raw = await fetchFn();
      const item = pickFn(raw);
      if (!item) return { skipped: 'no matching item found' };
      if (item.skipped) return item;
      await postItem(client, config.channelId, item.embed, item.sourceType);
      return { posted: item.label };
    } catch (err) {
      return { error: err.message ?? String(err) };
    }
  };

  // For preview, SQ42 filtering is skipped — we just want to show the embed format.
  results.commlinks = await tryPost('commlinks', fetchCommLinks, raw => {
    const item = filterCommLinks(raw)[0] ?? raw[0];
    if (!item) return null;
    return { sourceType: 'commlinks', label: item.title, embed: item };
  });

  results.press = await tryPost('press', fetchPressNews, raw => {
    const item = raw[0];
    if (!item) return { skipped: 'no SQ42 press coverage in the last 24 hours' };
    const { cleanTitle: clean } = require('./sources/pressNews');
    return {
      sourceType: 'press',
      label: item.title,
      embed: { title: clean(item.title), url: item.link, sourceName: item.resolvedSource },
    };
  });

  results.youtube = await tryPost('youtube', fetchYouTube, raw => {
    const item = filterYouTube(raw)[0] ?? raw[0];
    if (!item) return null;
    return {
      sourceType: 'youtube',
      label: item.title,
      embed: { title: item.title, url: item.link, imageUrl: item.thumbnailUrl, description: item.description?.slice(0, 200) },
    };
  });

  return { ok: true, results };
}

async function pollNowForGuild(client, guildId) {
  const config = await configStore.fetchConfig(guildId);
  if (!config?.channelId) {
    return { ok: false, message: 'No channel configured. Run `/sq42news set-channel` first.' };
  }

  const guild = config;
  const results = {};

  const run = async (name, fetchFn, pollFn) => {
    try {
      const items = await fetchFn();
      return await pollFn(client, guild, items) ?? { posted: 0 };
    } catch (err) {
      return { error: err.message ?? String(err) };
    }
  };

  results.commlinks = await run('commlinks', fetchCommLinks, pollCommLinksForGuild);
  results.press     = await run('press',     fetchPressNews,  pollPressForGuild);
  results.youtube   = await run('youtube',   fetchYouTube,    pollYouTubeForGuild);

  return { ok: true, results };
}

module.exports = {
  initialize,
  onReady,
  pollNowForGuild,
  previewForGuild,
  __testables: {
    pollCommLinksForGuild,
    pollPressForGuild,
    pollYouTubeForGuild,
    filterCommLinks,
    filterYouTube,
  },
};
