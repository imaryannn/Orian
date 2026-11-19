const mongoose = require('mongoose');

// ============================================
// MONGOOSE SCHEMAS
// ============================================

const goalSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  goal: { type: String, required: true },
  userId: { type: String, default: null, index: true },
  conversationId: { type: String, index: true },
  conversationTitle: { type: String },
  context: { type: [mongoose.Schema.Types.Mixed], default: [] },
  description: { type: String, default: '' },
  source: { type: String, default: 'api' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: null },
  status: { type: String, default: 'queued', index: true },
  result: { type: mongoose.Schema.Types.Mixed, default: null },
  workspace: { type: mongoose.Schema.Types.Mixed, default: null },
  activity: { type: [mongoose.Schema.Types.Mixed], default: [] },
  createdAt: { type: String, required: true, index: true },
  updatedAt: { type: String, required: true },
}, { _id: false, versionKey: false });

const taskLogSchema = new mongoose.Schema({
  goalId: { type: String, required: true, index: true },
  stage: { type: String },
  message: { type: String },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  timestamp: { type: String, required: true },
}, { versionKey: false });

const fileSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  goalId: { type: String, required: true, index: true },
  filename: { type: String, required: true },
  filePath: { type: String, required: true },
  fileType: { type: String },
  size: { type: Number },
  createdAt: { type: String, required: true },
}, { _id: false, versionKey: false });

const integrationSchema = new mongoose.Schema({
  goalId: { type: String, required: true },
  provider: { type: String, required: true },
  accessToken: { type: String, required: true },
  refreshToken: { type: String, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: String, required: true },
}, { versionKey: false });

integrationSchema.index({ goalId: 1, provider: 1 }, { unique: true });

const userSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  email: { type: String, required: true, unique: true, index: true },
  password: { type: String, required: true },
  name: { type: String, default: '' },
  createdAt: { type: String, required: true },
}, { _id: false, versionKey: false });

// ============================================
// MODELS (lazy init after connection)
// ============================================

let Goal, TaskLog, File, Integration, User;

function initModels() {
  Goal = mongoose.model('Goal', goalSchema);
  TaskLog = mongoose.model('TaskLog', taskLogSchema);
  File = mongoose.model('File', fileSchema);
  Integration = mongoose.model('Integration', integrationSchema);
  User = mongoose.model('User', userSchema);
}

// ============================================
// DATABASE INITIALIZATION
// ============================================

async function initializeDatabase() {
  const uri = process.env.MONGODB_URI || process.env.DATABASE_URL || 'mongodb://localhost:27017/orian';

  if (!process.env.MONGODB_URI && process.env.NODE_ENV === 'production') {
    console.warn('[DB] No MONGODB_URI set — falling back to DATABASE_URL or localhost');
  }

  await mongoose.connect(uri);
  console.log('[DB] Connected to MongoDB');

  initModels();
  console.log('[DB] All models created/verified');
}

// ============================================
// GOALS
// ============================================

async function createGoal(goalData) {
  const { id, goal, description, source, metadata, status, createdAt, updatedAt } = goalData;
  await Goal.create({
    _id: id, conversationId: goalData.conversationId, conversationTitle: goalData.conversationTitle, workspace: goalData.workspace || null, userId: goalData.userId || null, context: goalData.context || [], goal, description: description || '', source: source || 'api',
    metadata: metadata || null, status: status || 'queued', result: null,
    createdAt, updatedAt,
  });
  console.log(`[DB] Goal created: ${id}`);
  return id;
}

async function saveWorkspace(goalId, workspace) {
  const saved = { ...workspace, updatedAt: new Date().toISOString() };
  await Goal.updateOne({ _id: goalId }, { $set: { workspace: saved } });
  return saved;
}

async function appendGoalActivity(goalId, event) {
  if (!Goal) return;
  await Goal.updateOne({ _id: goalId }, { $push: { activity: { $each: [event], $slice: -100 } } });
}

async function getGoal(goalId) {
  const goal = await Goal.findById(goalId).lean();
  return goal ? { ...goal, id: goal._id } : null;
}

async function getAllGoals(limit = 20, offset = 0, userId) {
  const goals = await Goal.find(userId ? { userId } : {})
    .select('goal userId conversationId conversationTitle context status createdAt updatedAt result.report.content result.summary.main')
    .sort({ createdAt: -1 }).limit(1000).lean();
  return require('../lib/conversations').groupConversations(goals).slice(offset, offset + limit);
}

async function getTasksByStatus(status, userId) {
  const goals = await Goal.find({ status, ...(userId ? { userId } : {}) }).sort({ createdAt: -1 }).lean();
  return goals.map(goal => ({ ...goal, id: goal._id }));
}

async function updateGoalStatus(goalId, status, result = null) {
  const updatedAt = new Date().toISOString();
  await Goal.findOneAndUpdate(
    { _id: goalId, ...(status !== 'cancelled' ? { status: { $ne: 'cancelled' } } : {}) },
    { status, result, updatedAt }
  );
  console.log(`[DB] Goal ${goalId} status updated to ${status}`);
}

// ============================================
// TASK LOGS
// ============================================

async function addTaskLog(goalId, stage, message, metadata = {}) {
  const timestamp = new Date().toISOString();
  await TaskLog.create({ goalId, stage, message, metadata, timestamp });
}

async function getTaskLogs(goalId, limit = 100, offset = 0) {
  return TaskLog.find({ goalId }).sort({ timestamp: -1 }).skip(offset).limit(limit).lean();
}

// ============================================
// FILES
// ============================================

async function addFile(goalId, filename, filePath, fileType, size) {
  const id = `${goalId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const createdAt = new Date().toISOString();
  await File.create({ _id: id, goalId, filename, filePath, fileType, size, createdAt });
  return id;
}

async function getFiles(goalId) {
  return File.find({ goalId }).sort({ createdAt: -1 }).lean();
}

// ============================================
// USERS
// ============================================

async function createUser(userData) {
  const { id, email, password, name, createdAt } = userData;
  await User.create({ _id: id, email, password, name: name || '', createdAt });
  return id;
}

async function getUserByEmail(email) {
  return User.findOne({ email }).lean();
}

async function getUserById(id) {
  return User.findById(id).lean();
}

// ============================================
// NOTION TOKEN (was missing before)
// ============================================

async function saveNotionToken(goalId, tokenData) {
  const now = new Date().toISOString();
  await Integration.findOneAndUpdate(
    { goalId, provider: 'notion' },
    { goalId, provider: 'notion', accessToken: tokenData.access_token, refreshToken: null, metadata: tokenData, createdAt: now },
    { upsert: true }
  );
}

// ============================================
// CLOSE
// ============================================

async function closeDatabase() {
  await mongoose.connection.close();
  console.log('[DB] Database connection closed');
}

// ============================================
// EXPORTS (same interface as before)
// ============================================

module.exports = {
  initializeDatabase,
  appendGoalActivity,
  saveWorkspace,
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
  saveNotionToken,
};
