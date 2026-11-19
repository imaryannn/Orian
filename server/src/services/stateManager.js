const mongoose = require('mongoose');
const { randomUUID } = require('crypto');

const workflowSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  status: { type: String, required: true, index: true },
  originalGoal: { type: String, required: true },
  plan: { type: [mongoose.Schema.Types.Mixed], default: [] },
  agentLogs: { type: [mongoose.Schema.Types.Mixed], default: [] },
  finalOutput: { type: mongoose.Schema.Types.Mixed, default: null },
  createdAt: { type: String, required: true, index: true },
  updatedAt: { type: String, required: true },
}, { _id: false, versionKey: false });

let Workflow;

function getModel() {
  if (!Workflow) {
    Workflow = mongoose.model('SrcWorkflow', workflowSchema);
  }
  return Workflow;
}

function parseWorkflow(doc) {
  if (!doc) return null;
  return {
    id: doc._id,
    status: doc.status,
    original_goal: doc.originalGoal,
    plan: doc.plan || [],
    agent_logs: doc.agentLogs || [],
    final_output: doc.finalOutput,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  };
}

async function initializeStateManager() {}

async function createWorkflow(goal) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const doc = await getModel().create({
    _id: id, status: 'queued', originalGoal: goal,
    plan: [], agentLogs: [], finalOutput: null,
    createdAt: now, updatedAt: now,
  });
  return parseWorkflow(doc);
}

async function getWorkflow(id) {
  const doc = await getModel().findById(id).lean();
  return parseWorkflow(doc);
}

async function updateWorkflowStep(id, updates) {
  const set = { updatedAt: new Date().toISOString() };
  if (updates.status !== undefined) set.status = updates.status;
  if (updates.original_goal !== undefined) set.originalGoal = updates.original_goal;
  if (updates.plan !== undefined) set.plan = updates.plan;
  if (updates.agent_logs !== undefined) set.agentLogs = updates.agent_logs;
  if (updates.final_output !== undefined) set.finalOutput = updates.final_output;
  await getModel().findByIdAndUpdate(id, set);
  return getWorkflow(id);
}

async function appendAgentLog(id, logEntry) {
  const workflow = await getWorkflow(id);
  if (!workflow) throw new Error(`Workflow not found: ${id}`);
  const agent_logs = workflow.agent_logs.concat({ timestamp: new Date().toISOString(), ...logEntry });
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
