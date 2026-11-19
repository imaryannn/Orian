// ============================================
// AUTOPILOT MAIN WORKFLOW EXECUTOR
// ============================================

const { runPlanner } = require("../agents/planner");
const routerAgent = require("../agents/router");
const webAgent = require("../agents/webAgent");
const criticAgent = require("../agents/critic");
const summarizerAgent = require("../agents/summarizer");

const { getIO } = require("../sockets/socket");
const { runWithLLMUser } = require("../tools/llm");

async function executeWorkflow(taskData) {
  const userId = taskData ? taskData.userId : null;
  return runWithLLMUser(userId, () => executeWorkflowInternal(taskData));
}

async function executeWorkflowInternal(taskData) {
  const io = getIO();
  
  try {
    console.log("\n========== WORKFLOW STARTED ==========");
    const { goalId, goal, context = [], userId } = taskData;

    const plan = await runPlanner(goalId, goal, '', io, userId, context);
    const routedTasks = await routerAgent(plan);

    const taskResults = [];
    for (const task of routedTasks) {
      const result = await webAgent(task.task);
      const review = await criticAgent(result);
      taskResults.push({ task: task.task, result, review });
    }

    const finalReport = await summarizerAgent(taskResults);

    console.log("\n========== WORKFLOW COMPLETED ==========");
    if (io) io.emit("workflow-complete", { goalId, report: finalReport });

    return finalReport;
  } catch (error) {
    console.error("[WORKFLOW ERROR]", error.message);
    if (io) io.emit("workflow-error", { error: error.message });
    throw error;
  }
}

module.exports = executeWorkflow;
