// ============================================
// Planner Agent
// ============================================
// Purpose: Break down high-level goals into actionable subtasks

const { callLLMJson } = require('../tools/llm');
const { PLANNER_SYSTEM_PROMPT, getPlannerPrompt } = require('../tools/prompts');
const { addTaskLog } = require('../db/sqlite');
const { emitAgentActivity } = require('../sockets/socket');
const { getConnectedProviderIds } = require('../services/composio');

/**
 * Run the planner agent
 * @param {string} goalId - Unique goal ID
 * @param {string} goal - High-level goal description
 * @param {string} description - Optional detailed description
 * @param {Object} io - Socket.io instance for live updates
 * @returns {Promise<Object>} - Plan with subtasks
 */
async function runPlanner(goalId, goal, description = '', io = null, userId = null, context = []) {
  try {
    console.log(`[PLANNER] Starting plan generation for goal: "${goal}"`);

    emitAgentActivity(io, goalId, 'planner', 'analyzing_goal', { goal, description, message: `Analyzing goal: "${goal}"` });
    await addTaskLog(goalId, 'planner_start', 'Planner agent started analyzing goal');

    let connectedIntegrations = [];
    if (userId) {
      try {
        connectedIntegrations = await getConnectedProviderIds(userId);
      } catch (e) {
        console.warn('[PLANNER] integration lookup failed:', e.message);
      }
    }
    console.log(`[PLANNER] userId: ${userId}, connected integrations: ${connectedIntegrations.join(', ') || 'none'}`);

    const prompt = getPlannerPrompt(goal, description, connectedIntegrations, context);

    console.log(`[PLANNER] Calling LLM with prompt (${prompt.length} chars)`);

    // Call LLM to generate plan
    const plan = await callLLMJson(prompt, {
      maxTokens: 2048,
      temperature: 0.7,
      systemPrompt: PLANNER_SYSTEM_PROMPT,
    });

    console.log(`[PLANNER] Plan generated with ${plan.subtasks?.length || 0} subtasks`);

    // Validate plan structure
    if (!validatePlan(plan)) {
      throw new Error('Invalid plan structure from LLM');
    }

    // Log plan details
    console.log('[PLANNER] Plan details:');
    plan.subtasks.forEach((task, index) => {
      console.log(
        `  ${index + 1}. [${task.type}] ${task.task} (${task.priority})`
      );
    });

    // Log to database
    await addTaskLog(
      goalId,
      'planner_complete',
      `Generated plan with ${plan.subtasks.length} subtasks`,
      {
        totalEstimatedTime: plan.total_estimated_time_minutes,
        subtaskCount: plan.subtasks.length,
      }
    );

    // Emit completion
    emitAgentActivity(io, goalId, 'planner', 'plan_generated', {
      subtaskCount: plan.subtasks.length,
      totalEstimatedTime: plan.total_estimated_time_minutes,
      message: `Plan ready: ${plan.subtasks.length} subtasks created`,
    });

    return plan;
  } catch (error) {
    console.error(`[PLANNER ERROR] ${error.message}`);

    // Log error
    await addTaskLog(goalId, 'planner_error', `Planner failed: ${error.message}`);

    // Emit error
    emitAgentActivity(io, goalId, 'planner', 'error', {
      error: error.message,
    });

    throw error;
  }
}

/**
 * Validate plan structure
 * @param {Object} plan - Plan object to validate
 * @returns {boolean} - Is valid
 */
const TASK_TYPES = ['research', 'generation', 'execution', 'web_search', 'file_generation', 'code_execution', 'analysis', 'notion_action', 'slack_action', 'github_action', 'google_action', 'linear_action', 'airtable_action'];

function validatePlan(plan) {
  if (!Array.isArray(plan?.subtasks) || !plan.subtasks.length || plan.subtasks.length > 8) return false;
  const ids = new Set(plan.subtasks.map(task => task.id));
  if (ids.size !== plan.subtasks.length) return false;
  if (!plan.subtasks.every(task => task.id != null && typeof task.task === 'string' && task.task.trim() &&
    TASK_TYPES.includes(task.type) && Array.isArray(task.depends_on) &&
    task.depends_on.every(id => ids.has(id) && id !== task.id))) return false;
  try { getExecutionOrder(plan); return true; } catch (_) { return false; }
}

function getExecutionOrder(plan) {
  const pending = [...(plan.subtasks || [])];
  const executed = new Set();
  const batches = [];
  while (pending.length) {
    const batch = pending.filter(task => task.depends_on.every(id => executed.has(id)));
    if (!batch.length) throw new Error('Circular or missing dependency in plan');
    batches.push(batch.map(task => task.id));
    for (const task of batch) {
      executed.add(task.id);
      pending.splice(pending.indexOf(task), 1);
    }
  }
  return batches;
}

/**
 * Get subtask by ID
 * @param {Object} plan - Plan object
 * @param {number} taskId - Task ID to find
 * @returns {Object|null} - Subtask object or null
 */
function getSubtask(plan, taskId) {
  if (!plan.subtasks) return null;
  return plan.subtasks.find((task) => task.id === taskId) || null;
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  runPlanner,
  validatePlan,
  getExecutionOrder,
  getSubtask,
};