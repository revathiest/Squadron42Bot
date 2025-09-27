// database.js
// Provides a reusable MySQL connection pool for the bot.

const mysql = require('mysql2/promise');

function parsePort(value) {
  if (!value) return 3306;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : 3306;
}

function parseLimit(value) {
  if (!value) return 5;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

function buildConfig() {
  const requiredVariables = ['DB_SERVER', 'DB_USER', 'DB_PASS'];
  const missing = requiredVariables.filter(key => !process.env[key] || !process.env[key].trim());

  if (missing.length) {
    throw new Error(`Missing database environment variables: ${missing.join(', ')}`);
  }

  return {
    host: process.env.DB_SERVER,
    port: parsePort(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME || undefined,
    waitForConnections: true,
    connectionLimit: parseLimit(process.env.DB_POOL_LIMIT),
    queueLimit: 0
  };
}

let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool(buildConfig());
  }
  return pool;
}

async function testConnection() {
  const connection = await getPool().getConnection();
  try {
    await connection.ping();
  } finally {
    connection.release();
  }
}

module.exports = {
  getPool,
  testConnection
};
