const express = require('express');
const { randomUUID } = require('crypto');
const { addTaskToQueue, getTaskQueue } = require('../queues/taskQueue');
const { createGoal, getGoal, getAllGoals, updateGoalStatus } = require('../db/sqlite');
const { requireAuth } = require('../middleware/auth');
const { validateFiles } = require('../lib/workspace');
const router = express.Router();
router.use(requireAuth);

async function requireGoalOwner(req, res, next) {
  try {
    const goal = await getGoal(req.params.goalId);
    if (!goal || goal.userId !== req.user.userId) return res.status(404).json({ error: 'Goal not found' });
    req.goal = goal;
    next();
  } catch (error) { next(error); }
}

router.post('/', async (req, res, next) => {
  try {
    const { goal, description = '', context = [] } = req.body || {};
    if (typeof goal !== 'string' || !goal.trim() || goal.length > 20000) {
      return res.status(400).json({ error: 'Goal must be text between 1 and 20,000 characters' });
    }
    if (typeof description !== 'string' || !Array.isArray(context) || context.length > 500 ||
        context.some(m => !m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || m.content.length > 50000)) {
      return res.status(400).json({ error: 'Invalid description or conversation history' });
    }
    let workspace;
    if (req.body.workspace) {
      try { const files = validateFiles(req.body.workspace.files); workspace = { files, entry: files.some(f => f.path === req.body.workspace.entry) ? req.body.workspace.entry : files[0]?.path }; }
      catch (error) { return res.status(400).json({ error: error.message }); }
    }
    const goalId = randomUUID();
    let conversationId = goalId;
    let conversationTitle = goal.trim();
    if (req.body.previousGoalId) {
      if (typeof req.body.previousGoalId !== 'string') return res.status(400).json({ error: 'Invalid conversation reference' });
      const previous = await getGoal(req.body.previousGoalId);
      if (!previous || previous.userId !== req.user.userId) return res.status(404).json({ error: 'Conversation not found' });
      let legacyConversation;
      if (!previous.conversationId) {
        legacyConversation = (await getAllGoals(1000, 0, req.user.userId)).find(entry => entry.id === previous.id || entry.conversationId === previous.id);
      }
      conversationId = previous.conversationId || legacyConversation?.conversationId || previous.id || previous._id;
      conversationTitle = previous.conversationTitle || legacyConversation?.conversationTitle || previous.context?.find(m => m.role === 'user')?.content || previous.goal;
      if (/^(?:hi|hello|hey|test|good morning|good evening)[!.?\s]*$/i.test(conversationTitle)) conversationTitle = goal.trim();
    }
    const createdAt = new Date().toISOString();
    const goalData = { conversationId, conversationTitle, workspace, goal: goal.trim(), description: description.trim(), userId: req.user.userId, context };
    await createGoal({ id: goalId, ...goalData, status: 'queued', createdAt, updatedAt: createdAt });
    try { await addTaskToQueue(goalId, goalData); }
    catch (error) {
      await updateGoalStatus(goalId, 'failed', { error: 'Could not enqueue goal' });
      throw error;
    }
    res.status(201).json({ goalId, conversationId, conversationTitle, goal: goalData.goal, status: 'queued', createdAt, trackingUrl: `/api/goal/${goalId}` });
  } catch (error) { next(error); }
});

router.post('/:goalId/cancel', requireGoalOwner, async (req, res, next) => {
  try {
    if (['completed', 'failed', 'cancelled'].includes(req.goal.status)) return res.json({ goalId: req.goal.id, status: req.goal.status });
    await updateGoalStatus(req.goal.id, 'cancelled');
    try {
      const job = await getTaskQueue().getJob(req.goal.id);
      if (job && ['waiting', 'delayed'].includes(await job.getState())) await job.remove();
    } catch (_) {}
    req.io?.to(`goal:${req.goal.id}`).emit('task_cancelled', { goalId: req.goal.id });
    res.json({ goalId: req.goal.id, status: 'cancelled' });
  } catch (error) { next(error); }
});

router.patch('/:goalId/workspace', requireGoalOwner, async (req, res, next) => {
  try {
    if (['queued', 'running'].includes(req.goal.status)) return res.status(409).json({ error: 'Wait until generation finishes before saving edits' });
    let files;
    try { files = validateFiles(req.body.files); } catch (error) { return res.status(400).json({ error: error.message }); }
    const entry = files.some(file => file.path === req.body.entry) ? req.body.entry : files[0]?.path;
    const workspace = await require('../db/sqlite').saveWorkspace(req.goal.id, { files, entry });
    res.json({ workspace });
  } catch (error) { next(error); }
});

router.get('/:goalId', requireGoalOwner, (req, res) => res.json(req.goal));
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const goals = await getAllGoals(limit, offset, req.user.userId);
    res.json({ goals, limit, offset, count: goals.length });
  } catch (error) { next(error); }
});
module.exports = router;
module.exports.requireGoalOwner = requireGoalOwner;
