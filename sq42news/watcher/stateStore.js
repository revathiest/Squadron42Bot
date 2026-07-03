const { getPool } = require('../../database');

// Composite key: "guildId:source" -> state object
const stateCache = new Map();

function cacheKey(guildId, source) {
  return `${guildId}:${source}`;
}

async function ensureStateSchema(pool = getPool()) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sq42news_state (
      guild_id VARCHAR(20) NOT NULL,
      source VARCHAR(32) NOT NULL,
      state_json TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, source)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function loadState(pool = getPool()) {
  const [rows] = await pool.query(
    'SELECT guild_id, source, state_json FROM sq42news_state'
  );
  stateCache.clear();
  for (const row of rows) {
    try {
      const state = JSON.parse(row.state_json);
      stateCache.set(cacheKey(String(row.guild_id), String(row.source)), state);
    } catch {
      // ignore malformed rows
    }
  }
}

async function getState(guildId, source) {
  const key = cacheKey(String(guildId), source);
  if (stateCache.has(key)) return stateCache.get(key);

  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT state_json FROM sq42news_state WHERE guild_id = ? AND source = ?',
    [String(guildId), source]
  );
  if (!rows.length) return null;

  try {
    const state = JSON.parse(rows[0].state_json);
    stateCache.set(key, state);
    return state;
  } catch {
    return null;
  }
}

async function setState(guildId, source, state) {
  const key = cacheKey(String(guildId), source);
  stateCache.set(key, state);

  const pool = getPool();
  await pool.query(
    `INSERT INTO sq42news_state (guild_id, source, state_json)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE state_json = VALUES(state_json), updated_at = CURRENT_TIMESTAMP`,
    [String(guildId), source, JSON.stringify(state)]
  );
}

module.exports = {
  stateCache,
  ensureStateSchema,
  loadState,
  getState,
  setState,
};
