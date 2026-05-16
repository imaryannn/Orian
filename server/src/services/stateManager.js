const { Pool } = require('pg');
const { randomUUID } = require('crypto');

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

function parseWorkflow(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    original_goal: row.original_goal,
    plan: row.plan || [],
    agent_logs: row.agent_logs || [],
    final_output: row.final_output,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function initializeStateManager() {
  const db = getPool();
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS workflows (
        id VARCHAR(255) PRIMARY KEY,
        status VARCHAR(50) NOT NULL,
        original_goal TEXT NOT NULL,
        plan JSONB NOT NULL DEFAULT '[]',
        agent_logs JSONB NOT NULL DEFAULT '[]',
        final_output JSONB,
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_workflows_created ON workflows(created_at)`);
  } catch (error) {
    if (!error.message.includes('already exists')) {
      console.error('[DB ERROR]', error.message);
      throw error;
    }
  }
}

async function createWorkflow(goal) {
  await initializeStateManager();

  const db = getPool();
  const id = randomUUID();
  const now = new Date().toISOString();
  
  try {
    await db.query(
      `INSERT INTO workflows (id, status, original_goal, plan, agent_logs, final_output, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, 'queued', goal, JSON.stringify([]), JSON.stringify([]), null, now, now]
    );

    return {
      id,
      status: 'queued',
      original_goal: goal,
      plan: [],
      agent_logs: [],
      final_output: null,
      created_at: now,
      updated_at: now,
    };
  } catch (error) {
    console.error('[DB ERROR]', error.message);
    throw error;
  }
}

async function getWorkflow(id) {
  await initializeStateManager();
  const db = getPool();
  try {
    const result = await db.query('SELECT * FROM workflows WHERE id = $1', [id]);
    return parseWorkflow(result.rows[0]);
  } catch (error) {
    console.error('[DB ERROR]', error.message);
    throw error;
  }
}

async function updateWorkflowStep(id, updates) {
  await initializeStateManager();
  const db = getPool();

  const allowed = {
    status: 'status',
    original_goal: 'original_goal',
    plan: 'plan',
    agent_logs: 'agent_logs',
    final_output: 'final_output',
  };
  
  const sets = [];
  const values = [];
  let paramIndex = 1;

  Object.entries(updates).forEach(([key, value]) => {
    if (!allowed[key]) return;
    sets.push(`${allowed[key]} = $${paramIndex}`);
    if (['plan', 'agent_logs', 'final_output'].includes(key)) {
      values.push(JSON.stringify(value));
    } else {
      values.push(value);
    }
    paramIndex++;
  });

  if (sets.length === 0) return getWorkflow(id);

  sets.push(`updated_at = $${paramIndex}`);
  values.push(new Date().toISOString());
  paramIndex++;
  
  values.push(id);

  try {
    await db.query(`UPDATE workflows SET ${sets.join(', ')} WHERE id = $${paramIndex}`, values);
    return getWorkflow(id);
  } catch (error) {
    console.error('[DB ERROR]', error.message);
    throw error;
  }
}

async function appendAgentLog(id, logEntry) {
  const workflow = await getWorkflow(id);
  if (!workflow) throw new Error(`Workflow not found: ${id}`);

  const agent_logs = workflow.agent_logs.concat({
    timestamp: new Date().toISOString(),
    ...logEntry,
  });

  return updateWorkflowStep(id, { agent_logs });
}

async function updateTask(id, taskId, patch) {
  const workflow = await getWorkflow(id);
  if (!workflow) throw new Error(`Workflow not found: ${id}`);

  const plan = workflow.plan.map((task) => (
    task.id === taskId ? { ...task, ...patch, updatedAt: new Date().toISOString() } : task
  ));

  return updateWorkflowStep(id, { plan });
}

module.exports = {
  initializeStateManager,
  createWorkflow,
  updateWorkflowStep,
  appendAgentLog,
  updateTask,
  getWorkflow,
};
