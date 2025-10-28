const { getPool } = require('../database');

const REFERRAL_REGEX = /^STAR-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

async function ensureTables() {
  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS referral_codes (
      user_id VARCHAR(32) PRIMARY KEY,
      code VARCHAR(15) UNIQUE NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS provided_codes (
      code VARCHAR(15) PRIMARY KEY,
      provided_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

module.exports = {
  REFERRAL_REGEX,
  ensureTables,
  getPool
};
