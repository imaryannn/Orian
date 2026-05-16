const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/orian';
    pool = new Pool({
      connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
  }
  return pool;
}

async function saveIntegration(goalId, provider, data) {
  const db = getPool();
  const createdAt = new Date().toISOString();
  try {
    await db.query(
      `INSERT INTO integrations ("goalId", provider, "accessToken", "refreshToken", metadata, "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ("goalId", provider) DO UPDATE SET
       "accessToken" = $3, "refreshToken" = $4, metadata = $5, "createdAt" = $6`,
      [goalId, provider, data.accessToken, data.refreshToken || null, JSON.stringify(data.metadata || {}), createdAt]
    );
  } catch (err) {
    console.error('[DB ERROR]', err.message);
    throw err;
  }
}

async function getIntegration(goalId, provider) {
  const db = getPool();
  try {
    const result = await db.query(
      'SELECT * FROM integrations WHERE "goalId" = $1 AND provider = $2 ORDER BY "createdAt" DESC LIMIT 1',
      [goalId, provider]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error('[DB ERROR]', err.message);
    throw err;
  }
}

async function listIntegrations(goalId) {
  const db = getPool();
  try {
    const result = await db.query(
      'SELECT provider, metadata, "createdAt" FROM integrations WHERE "goalId" = $1',
      [goalId]
    );
    return result.rows || [];
  } catch (err) {
    console.error('[DB ERROR]', err.message);
    throw err;
  }
}

async function deleteIntegration(goalId, provider) {
  const db = getPool();
  try {
    await db.query(
      'DELETE FROM integrations WHERE "goalId" = $1 AND provider = $2',
      [goalId, provider]
    );
  } catch (err) {
    console.error('[DB ERROR]', err.message);
    throw err;
  }
}

module.exports = { saveIntegration, getIntegration, listIntegrations, deleteIntegration };
