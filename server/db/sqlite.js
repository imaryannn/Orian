

const { Pool } = require('pg');

// Database pool
let pool = null;

function getConnectionString() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString && process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is missing. Add a PostgreSQL database on Render and set DATABASE_URL to its Internal Database URL.');
  }

  return connectionString || 'postgresql://localhost:5432/orian';
}

function formatDbError(error) {
  if (error && error.message) return error.message;
  if (error && error.code) return `PostgreSQL error code: ${error.code}`;
  return String(error);
}

/**
 * Initialize PostgreSQL database and create tables if needed
 */
async function initializeDatabase() {
  const connectionString = getConnectionString();
  
  pool = new Pool({
    connectionString,
    // For Render: SSL is required
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  pool.on('error', (err) => {
    console.error('[DB ERROR] Unexpected error on idle client', err);
  });

  try {
    const client = await pool.connect();
    console.log('[DB] Connected to PostgreSQL');
    client.release();
    
    // Create tables
    await createTables();
    console.log('[DB] All tables created/verified');
    
    return;
  } catch (error) {
    console.error('[DB ERROR]', formatDbError(error));
    throw error;
  }
}

/**
 * Create all required tables
 */
async function createTables() {
  try {
    // Goals table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS goals (
        id VARCHAR(255) PRIMARY KEY,
        goal TEXT NOT NULL,
        description TEXT,
        source VARCHAR(50) DEFAULT 'api',
        metadata JSONB,
        status VARCHAR(50) DEFAULT 'queued',
        result JSONB,
        "createdAt" TIMESTAMP NOT NULL,
        "updatedAt" TIMESTAMP NOT NULL
      )
    `);

    // Task logs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS task_logs (
        id SERIAL PRIMARY KEY,
        "goalId" VARCHAR(255) NOT NULL,
        stage VARCHAR(100),
        message TEXT,
        metadata JSONB,
        timestamp TIMESTAMP NOT NULL,
        FOREIGN KEY ("goalId") REFERENCES goals(id) ON DELETE CASCADE
      )
    `);

    // Files table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS files (
        id VARCHAR(255) PRIMARY KEY,
        "goalId" VARCHAR(255) NOT NULL,
        filename TEXT NOT NULL,
        "filePath" TEXT NOT NULL,
        "fileType" VARCHAR(100),
        size INTEGER,
        "createdAt" TIMESTAMP NOT NULL,
        FOREIGN KEY ("goalId") REFERENCES goals(id) ON DELETE CASCADE
      )
    `);

    // Integrations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS integrations (
        id SERIAL PRIMARY KEY,
        "goalId" VARCHAR(255) NOT NULL,
        provider VARCHAR(100) NOT NULL,
        "accessToken" TEXT NOT NULL,
        "refreshToken" TEXT,
        metadata JSONB,
        "createdAt" TIMESTAMP NOT NULL,
        UNIQUE("goalId", provider)
      )
    `);
    await pool.query('ALTER TABLE integrations DROP CONSTRAINT IF EXISTS "integrations_goalId_fkey"');

    // Users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(255) PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name VARCHAR(255),
        "createdAt" TIMESTAMP NOT NULL
      )
    `);

    // Create indices for better query performance
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_goals_created ON goals("createdAt")`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_task_logs_goal ON task_logs("goalId")`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_files_goal ON files("goalId")`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);

  } catch (error) {
    if (!error.message.includes('already exists')) {
      console.error('[DB ERROR] Failed to create tables:', error.message);
      throw error;
    }
  }
}

/**
 * Create a new goal
 */
async function createGoal(goalData) {
  const { id, goal, description, source, metadata, status, createdAt, updatedAt } = goalData;

  try {
    await pool.query(
      `INSERT INTO goals (id, goal, description, source, metadata, status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, goal, description || '', source || 'api', metadata ? JSON.stringify(metadata) : null, status || 'queued', createdAt, updatedAt]
    );
    console.log(`[DB] Goal created: ${id}`);
    return id;
  } catch (error) {
    console.error('[DB ERROR]', error.message);
    throw error;
  }
}

/**
 * Get a goal by ID
 */
async function getGoal(goalId) {
  try {
    const result = await pool.query('SELECT * FROM goals WHERE id = $1', [goalId]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('[DB ERROR]', error.message);
    throw error;
  }
}

/**
 * Get all goals with pagination
 */
async function getAllGoals(limit = 20, offset = 0) {
  try {
    const result = await pool.query(
      'SELECT * FROM goals ORDER BY "createdAt" DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    return result.rows || [];
  } catch (error) {
    console.error('[DB ERROR]', error.message);
    throw error;
  }
}

/**
 * Get tasks by status
 */
async function getTasksByStatus(status) {
  try {
    const result = await pool.query(
      'SELECT * FROM goals WHERE status = $1 ORDER BY "createdAt" DESC',
      [status]
    );
    return result.rows || [];
  } catch (error) {
    console.error('[DB ERROR]', error.message);
    throw error;
  }
}

/**
 * Update goal status
 */
async function updateGoalStatus(goalId, status, result = null) {
  const updatedAt = new Date().toISOString();

  try {
    await pool.query(
      'UPDATE goals SET status = $1, result = $2, "updatedAt" = $3 WHERE id = $4',
      [status, result ? JSON.stringify(result) : null, updatedAt, goalId]
    );
    console.log(`[DB] Goal ${goalId} status updated to ${status}`);
  } catch (error) {
    console.error('[DB ERROR]', error.message);
    throw error;
  }
}

/**
 * Add a task log entry
 */
async function addTaskLog(goalId, stage, message, metadata = {}) {
  const timestamp = new Date().toISOString();

  try {
    await pool.query(
      'INSERT INTO task_logs ("goalId", stage, message, metadata, timestamp) VALUES ($1, $2, $3, $4, $5)',
      [goalId, stage, message, JSON.stringify(metadata), timestamp]
    );
  } catch (error) {
    console.error('[DB ERROR]', error.message);
    throw error;
  }
}

/**
 * Get task logs
 */
async function getTaskLogs(goalId, limit = 100, offset = 0) {
  try {
    const result = await pool.query(
      'SELECT * FROM task_logs WHERE "goalId" = $1 ORDER BY timestamp DESC LIMIT $2 OFFSET $3',
      [goalId, limit, offset]
    );
    return result.rows || [];
  } catch (error) {
    console.error('[DB ERROR]', error.message);
    throw error;
  }
}

/**
 * Add a file record
 */
async function addFile(goalId, filename, filePath, fileType, size) {
  const id = `${goalId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const createdAt = new Date().toISOString();

  try {
    await pool.query(
      'INSERT INTO files (id, "goalId", filename, "filePath", "fileType", size, "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, goalId, filename, filePath, fileType, size, createdAt]
    );
    return id;
  } catch (error) {
    console.error('[DB ERROR]', error.message);
    throw error;
  }
}

/**
 * Get files for a goal
 */
async function getFiles(goalId) {
  try {
    const result = await pool.query(
      'SELECT * FROM files WHERE "goalId" = $1 ORDER BY "createdAt" DESC',
      [goalId]
    );
    return result.rows || [];
  } catch (error) {
    console.error('[DB ERROR]', error.message);
    throw error;
  }
}

/**
 * Create a new user
 */
async function createUser(userData) {
  const { id, email, password, name, createdAt } = userData;
  try {
    await pool.query(
      'INSERT INTO users (id, email, password, name, "createdAt") VALUES ($1, $2, $3, $4, $5)',
      [id, email, password, name || '', createdAt]
    );
    return id;
  } catch (error) {
    console.error('[DB ERROR]', error.message);
    throw error;
  }
}

/**
 * Get user by email
 */
async function getUserByEmail(email) {
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('[DB ERROR]', error.message);
    throw error;
  }
}

/**
 * Get user by ID
 */
async function getUserById(id) {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('[DB ERROR]', error.message);
    throw error;
  }
}

/**
 * Close database connection
 */
async function closeDatabase() {
  if (pool) {
    await pool.end();
    console.log('[DB] Database connection closed');
  }
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  initializeDatabase,
  createGoal,
  getGoal,
  getAllGoals,
  getTasksByStatus,
  updateGoalStatus,
  addTaskLog,
  getTaskLogs,
  addFile,
  getFiles,
  closeDatabase,
  createUser,
  getUserByEmail,
  getUserById,
};
