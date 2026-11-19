// ============================================
// Router Agent
// ============================================
// Purpose: Route tasks to appropriate specialist agents

const { callLLMJson } = require('../tools/llm');
const { ROUTER_SYSTEM_PROMPT, getRouterPrompt } = require('../tools/prompts');
const { addTaskLog } = require('../db/sqlite');
const { emitAgentActivity } = require('../sockets/socket');

// Valid agent types
const VALID_AGENTS = ['web_search', 'file_generation', 'code_execution', 'analysis', 'notion_action', 'slack_action', 'github_action', 'google_action', 'linear_action', 'airtable_action'];

/**
 * Route a task to the appropriate specialist agent
 * @param {string} goalId - Unique goal ID
 * @param {Object} task - Task object from plan
 * @param {Object} io - Socket.io instance
 * @returns {Promise<Object>} - Routing decision with agent assignment
 */
const ACTION_AGENTS = ['notion_action', 'slack_action', 'github_action', 'google_action', 'linear_action', 'airtable_action'];

async function routeTask(goalId, task, io = null) {
  try {
    const knownType = { research: 'web_search', generation: 'file_generation', execution: 'code_execution' }[task.type] || task.type;
    if (VALID_AGENTS.includes(knownType)) {
      emitAgentActivity(io, goalId, 'router', 'task_routed', { taskId: task.id, agentType: knownType, message: `Assigned to ${knownType} agent` });
      return {
        taskId: task.id,
        taskDescription: task.task,
        assignedAgent: knownType,
        confidence: 1,
        reason: 'direct action task',
        parameters: {},
        timestamp: new Date().toISOString(),
      };
    }

    console.log(`[ROUTER] Routing task: "${task.task}"`);
    emitAgentActivity(io, goalId, 'router', 'routing_task', {
      taskId: task.id,
      taskDescription: task.task,
      taskType: task.type,
      message: `Routing task: "${task.task.substring(0, 60)}..."`,
    });

    // Log to database
    await addTaskLog(
      goalId,
      'router_start',
      `Router analyzing task: ${task.task}`
    );

    // Generate routing prompt
    const prompt = getRouterPrompt(task.task);

    // Call LLM for routing decision
    const routing = await callLLMJson(prompt, {
      maxTokens: 1024,
      temperature: 0.5,
      systemPrompt: ROUTER_SYSTEM_PROMPT,
    });

    console.log(`[ROUTER] Decision: ${routing.agent} (confidence: ${routing.confidence})`);

    // Validate routing decision — pick first valid agent if model returns combined value
    const agentRaw = (routing.agent || '').split(/[|,\/]/)[0].trim();
    if (!VALID_AGENTS.includes(agentRaw)) {
      throw new Error(`Invalid agent: ${routing.agent}`);
    }
    routing.agent = agentRaw;

    if (routing.confidence < 0.6) {
      console.warn(`[ROUTER] Low confidence routing (${routing.confidence})`);
    }

    // Create routing result
    const result = {
      taskId: task.id,
      taskDescription: task.task,
      assignedAgent: routing.agent,
      confidence: routing.confidence,
      reason: routing.reason,
      parameters: routing.parameters || {},
      timestamp: new Date().toISOString(),
    };

    // Log to database
    await addTaskLog(
      goalId,
      'router_complete',
      `Task routed to ${routing.agent}`,
      {
        taskId: task.id,
        agent: routing.agent,
        confidence: routing.confidence,
      }
    );

    // Emit routing decision
    emitAgentActivity(io, goalId, 'router', 'task_routed', {
      taskId: task.id,
      agent: routing.agent,
      confidence: routing.confidence,
      message: `Assigned to ${routing.agent} agent`,
    });

    return result;
  } catch (error) {
    console.error(`[ROUTER ERROR] ${error.message}`);

    // Log error
    await addTaskLog(
      goalId,
      'router_error',
      `Router failed: ${error.message}`,
      { taskId: task.id }
    );

    // Emit error
    emitAgentActivity(io, goalId, 'router', 'error', {
      taskId: task.id,
      error: error.message,
    });

    throw error;
  }
}

/**
 * Route multiple tasks in parallel
 * @param {string} goalId - Unique goal ID
 * @param {Array<Object>} tasks - Array of task objects
 * @param {Object} io - Socket.io instance
 * @returns {Promise<Array<Object>>} - Routing decisions for all tasks
 */
async function routeTasks(goalId, tasks, io = null) {
  try {
    console.log(`[ROUTER] Routing ${tasks.length} tasks`);

    // Route all tasks in parallel
    const routingDecisions = await Promise.all(
      tasks.map((task) => routeTask(goalId, task, io))
    );

    console.log(`[ROUTER] Completed routing for ${routingDecisions.length} tasks`);

    return routingDecisions;
  } catch (error) {
    console.error(`[ROUTER ERROR] Batch routing failed:`, error.message);
    throw error;
  }
}

/**
 * Get routing statistics
 * @param {Array<Object>} routingDecisions - Array of routing results
 * @returns {Object} - Statistics about routing
 */
function getRoutingStats(routingDecisions) {
  const stats = {
    totalTasks: routingDecisions.length,
    byAgent: {},
    avgConfidence: 0,
    lowConfidenceCount: 0,
  };

  let totalConfidence = 0;

  routingDecisions.forEach((decision) => {
    // Count by agent
    if (!stats.byAgent[decision.assignedAgent]) {
      stats.byAgent[decision.assignedAgent] = 0;
    }
    stats.byAgent[decision.assignedAgent]++;

    // Track confidence
    totalConfidence += decision.confidence;

    if (decision.confidence < 0.7) {
      stats.lowConfidenceCount++;
    }
  });

  stats.avgConfidence = totalConfidence / routingDecisions.length;

  return stats;
}

/**
 * Get all tasks for a specific agent
 * @param {Array<Object>} routingDecisions - Routing decisions
 * @param {string} agentName - Agent name to filter by
 * @returns {Array<Object>} - Tasks assigned to agent
 */
function getTasksForAgent(routingDecisions, agentName) {
  return routingDecisions.filter((decision) => decision.assignedAgent === agentName);
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  routeTask,
  routeTasks,
  getRoutingStats,
  getTasksForAgent,
  VALID_AGENTS,
};