const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const workflowSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  goal: { type: String, required: true },
  source: { type: String, default: 'api' },
  status: { type: String, default: 'pending' },
  plan: { type: [mongoose.Schema.Types.Mixed], default: [] },
  agentLogs: { type: [mongoose.Schema.Types.Mixed], default: [] },
  finalOutput: { type: mongoose.Schema.Types.Mixed, default: null },
  createdAt: { type: String, required: true },
  updatedAt: { type: String, required: true },
}, { _id: false, versionKey: false });

let Workflow;

function getModel() {
  if (!Workflow) {
    Workflow = mongoose.model('Workflow', workflowSchema);
  }
  return Workflow;
}

async function createWorkflow(goal, source = 'api') {
  const id = uuidv4();
  const now = new Date().toISOString();
  await getModel().create({ _id: id, goal, source, status: 'pending', plan: [], agentLogs: [], finalOutput: null, createdAt: now, updatedAt: now });
  return id;
}

async function updateWorkflowStep(id, updates) {
  const now = new Date().toISOString();
  const set = { updatedAt: now };
  if (updates.status !== undefined) set.status = updates.status;
  if (updates.plan !== undefined) set.plan = updates.plan;
  if (updates.agent_logs !== undefined) set.agentLogs = updates.agent_logs;
  if (updates.final_output !== undefined) set.finalOutput = updates.final_output;
  await getModel().findByIdAndUpdate(id, set);
}

async function appendLog(id, log) {
  const workflow = await getWorkflow(id);
  const logs = workflow?.agentLogs || [];
  logs.push({ ...log, timestamp: new Date().toISOString() });
  await updateWorkflowStep(id, { agent_logs: logs });
}

async function getWorkflow(id) {
  const doc = await getModel().findById(id).lean();
  if (!doc) return null;
  return { ...doc, id: doc._id };
}

async function listWorkflows(limit = 20) {
  const docs = await getModel().find().sort({ createdAt: -1 }).limit(limit).lean();
  return docs.map(d => ({ ...d, id: d._id }));
}

module.exports = { createWorkflow, updateWorkflowStep, appendLog, getWorkflow, listWorkflows };
