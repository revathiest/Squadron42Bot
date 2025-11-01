const { getPool } = require('../database');

async function createPollRecord({
  guildId,
  channelId,
  ownerId,
  question,
  isMulti,
  expiresAt
}, pool = getPool()) {
  const [result] = await pool.query(
    `INSERT INTO polls (guild_id, channel_id, owner_id, question, is_multi, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [guildId, channelId, ownerId, question, isMulti ? 1 : 0, expiresAt]
  );
  return result.insertId;
}

async function insertPollOptions(pollId, options, pool = getPool()) {
  if (!options.length) {
    return [];
  }
  const values = options.map((opt, index) => [pollId, index + 1, opt.label]);
  await pool.query(
    `INSERT INTO poll_options (poll_id, position, label)
     VALUES ?`,
    [values]
  );
  const [rows] = await pool.query(
    'SELECT id, position, label FROM poll_options WHERE poll_id = ? ORDER BY position ASC',
    [pollId]
  );
  return rows;
}

async function setPollMessageId(pollId, messageId, pool = getPool()) {
  await pool.query(
    'UPDATE polls SET message_id = ? WHERE id = ?',
    [messageId, pollId]
  );
}

async function fetchPollWithOptions(pollId, pool = getPool()) {
  const [[poll]] = await pool.query('SELECT * FROM polls WHERE id = ?', [pollId]);
  if (!poll) {
    return null;
  }
  const [options] = await pool.query(
    `SELECT po.id, po.label, po.position,
            COUNT(pv.user_id) AS votes
     FROM poll_options po
     LEFT JOIN poll_votes pv ON pv.option_id = po.id
     WHERE po.poll_id = ?
     GROUP BY po.id
     ORDER BY po.position ASC`,
    [pollId]
  );
  return { poll, options };
}

async function fetchOpenPollByMessage(channelId, messageId, pool = getPool()) {
  const [[poll]] = await pool.query(
    'SELECT * FROM polls WHERE channel_id = ? AND message_id = ?',
    [channelId, messageId]
  );
  if (!poll) {
    return null;
  }
  const [options] = await pool.query(
    'SELECT id, label, position FROM poll_options WHERE poll_id = ? ORDER BY position ASC',
    [poll.id]
  );
  return { poll, options };
}

async function recordSingleVote(pollId, optionId, userId, pool = getPool()) {
  await pool.query('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?', [pollId, userId]);
  await pool.query(
    `INSERT INTO poll_votes (poll_id, option_id, user_id)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE created_at = VALUES(created_at)`,
    [pollId, optionId, userId]
  );
}

async function toggleMultiVote(pollId, optionId, userId, pool = getPool()) {
  const [existing] = await pool.query(
    'SELECT 1 FROM poll_votes WHERE poll_id = ? AND option_id = ? AND user_id = ?',
    [pollId, optionId, userId]
  );
  if (existing.length) {
    await pool.query(
      'DELETE FROM poll_votes WHERE poll_id = ? AND option_id = ? AND user_id = ?',
      [pollId, optionId, userId]
    );
    return 'removed';
  }
  await pool.query(
    `INSERT INTO poll_votes (poll_id, option_id, user_id)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE created_at = created_at`,
    [pollId, optionId, userId]
  );
  return 'added';
}

async function getUserVotes(pollId, userId, pool = getPool()) {
  const [rows] = await pool.query(
    `SELECT po.position
       FROM poll_votes pv
       JOIN poll_options po ON po.id = pv.option_id
      WHERE pv.poll_id = ?
        AND pv.user_id = ?
      ORDER BY po.position ASC`,
    [pollId, userId]
  );
  return rows.map(row => row.position);
}

async function markPollClosed(pollId, { reason, closedBy, closedAt = new Date() }, pool = getPool()) {
  await pool.query(
    `UPDATE polls
     SET closed_at = ?, closed_by = ?, closed_reason = ?
     WHERE id = ? AND closed_at IS NULL`,
    [closedAt, closedBy ?? null, reason ?? null, pollId]
  );
}

async function listExpiredOpenPolls(now = new Date(), pool = getPool()) {
  const [rows] = await pool.query(
    `SELECT id
     FROM polls
     WHERE closed_at IS NULL
       AND expires_at <= ?
     LIMIT 25`,
    [now]
  );
  return rows.map(row => row.id);
}

module.exports = {
  createPollRecord,
  insertPollOptions,
  setPollMessageId,
  fetchPollWithOptions,
  fetchOpenPollByMessage,
  recordSingleVote,
  toggleMultiVote,
  getUserVotes,
  markPollClosed,
  listExpiredOpenPolls
};
