// spectrum/watcher/stateStore.js
// Persists and caches guild watcher state.

const { getPool } = require('../../database');
const { toThreadId } = require('./threadUtils');

const stateCache = new Map(); // guildId -> { raw, numeric }

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

module.exports = {
  stateCache,
  ensureStateSchema,
  loadState,
  getLastSeenThread,
  setLastSeenThread
};
