const { callLLM, callLLMJson } = require('../tools/llm');
const { searchWebWithRetry, formatSearchResults } = require('../tools/search');
const { updateWorkflowStep, appendLog, getWorkflow } = require('../services/stateManager');
const { runDeliveryAgent } = require('./deliveryAgent');
const { emitTaskUpdate, emitAgentActivity, emitTaskComplete, emitError, getIO } = require('../sockets/socket');
const { getGoal, updateGoalStatus } = require('../db/sqlite');
const fs = require('fs');
const path = require('path');

async function isCancelled(workflowId) {
  try {
    const goal = await getGoal(workflowId);
    return goal?.status === 'cancelled';
  } catch { return false; }
}

const PLANNER_PROMPT = `You are an expert planner. Break the goal into 4-6 concrete subtasks. Always include multiple web_search subtasks to gather thorough information before analysis.
Respond ONLY with valid JSON:
{
  "subtasks": [
    { "id": 1, "agentType": "web_search|code|file|analysis", "instruction": "...", "status": "pending" }
  ]
}`;

const ROUTER_PROMPT = (instruction) => `Route this task to the best agent: "${instruction}"
Agents: web_search, code, file, analysis
Respond ONLY with JSON: { "agentType": "web_search|code|file|analysis", "reason": "..." }`;

const CRITIC_PROMPT = (instruction, output) => `Review this output for the task: "${instruction}"
Output: ${output.substring(0, 1000)}
Respond ONLY with JSON: { "approved": true|false, "feedback": "..." }`;

const SUMMARIZER_PROMPT = (goal, logs) => `Compile a markdown report for goal: "${goal}"
Agent logs: ${JSON.stringify(logs).substring(0, 3000)}
Write a comprehensive, well-formatted markdown report with sections, findings, and conclusions.
Respond ONLY with JSON: { "report": "full markdown report here" }
The "report" key is required. Do not use any other key names like "title", "content", or "summary".`;

async function plannerAgent(workflowId, goal, io) {
  console.log(`[ORCHESTRATOR] Planner running for: "${goal}"`);
  emitAgentActivity(io, workflowId, 'planner', 'analyzing_goal', { goal, message: `Analyzing goal: "${goal}"` });

  const result = await callLLMJson(
    `Goal: "${goal}"\n\nCreate a detailed execution plan.`,
    { systemPrompt: PLANNER_PROMPT, maxTokens: 1024, temperature: 0.5 }
  );

  const subtasks = (result.subtasks || []).map((t, i) => ({
    id: t.id || i + 1,
    agentType: t.agentType || 'analysis',
    instruction: t.instruction,
    status: 'pending',
    retries: 0,
    output: null,
  }));

  await updateWorkflowStep(workflowId, { plan: subtasks, status: 'planning_complete' });
  await appendLog(workflowId, { agent: 'planner', action: 'plan_created', subtaskCount: subtasks.length });
  emitAgentActivity(io, workflowId, 'planner', 'plan_generated', { subtaskCount: subtasks.length, message: `Plan ready: ${subtasks.length} subtasks created` });
  emitTaskUpdate(io, workflowId, { stage: 'planning_complete', message: `Plan ready: ${subtasks.length} subtasks`, progress: 15 });

  return subtasks;
}

async function routerAgent(workflowId, task, io) {
  emitAgentActivity(io, workflowId, 'router', 'routing_task', { task: task.instruction, message: `Routing: "${task.instruction.substring(0, 60)}..."` });

  let agentType = task.agentType;
  try {
    const result = await callLLMJson(ROUTER_PROMPT(task.instruction), { maxTokens: 256, temperature: 0.3 });
    agentType = result.agentType || task.agentType;
  } catch {
    console.warn('[ORCHESTRATOR] Router fallback to task default agentType');
  }

  const validTypes = ['web_search', 'code', 'file', 'analysis'];
  if (!validTypes.includes(agentType)) agentType = 'analysis';

  emitAgentActivity(io, workflowId, 'router', 'task_routed', { agentType, message: `Assigned to ${agentType} agent` });
  return agentType;
}

async function executeSpecialist(workflowId, task, agentType, io) {
  emitAgentActivity(io, workflowId, agentType, 'executing', { instruction: task.instruction, message: `Executing: "${task.instruction.substring(0, 60)}..."` });

  if (agentType === 'web_search') {
    const searchResult = await searchWebWithRetry(task.instruction, { maxResults: 5 });
    const formatted = formatSearchResults(searchResult);
    let synthesis = formatted;
    try {
      const s = await callLLMJson(
        `Synthesize these search results for: "${task.instruction}"\n\n${formatted}`,
        { maxTokens: 1024, temperature: 0.5, systemPrompt: 'Respond ONLY with JSON: { "summary": "...", "keyFindings": [] }' }
      );
      synthesis = s.summary || formatted;
    } catch { }
    return synthesis;
  }

  if (agentType === 'code') {
    const result = await callLLMJson(
      `Write working code for: "${task.instruction}". Include HTML/CSS/JS if it's a UI task.`,
      { maxTokens: 2048, temperature: 0.4, systemPrompt: 'Respond ONLY with JSON: { "language": "...", "code": "...", "description": "..." }' }
    );
    return `Language: ${result.language}\n\n${result.description}\n\n\`\`\`${result.language}\n${result.code}\n\`\`\`` ;
  }

  if (agentType === 'file') {
    const result = await callLLMJson(
      `Generate content for: "${task.instruction}"`,
      { maxTokens: 2048, temperature: 0.6, systemPrompt: 'Respond ONLY with JSON: { "content": "...", "format": "markdown" }' }
    );
    return result.content || task.instruction;
  }

  const result = await callLLMJson(
    `Analyze and provide insights for: "${task.instruction}"`,
    { maxTokens: 1024, temperature: 0.5, systemPrompt: 'Respond ONLY with JSON: { "analysis": "...", "insights": [] }' }
  );
  return result.analysis || JSON.stringify(result);
}

async function criticAgent(workflowId, task, output, io) {
  emitAgentActivity(io, workflowId, 'critic', 'reviewing', { taskId: task.id, message: 'Reviewing output quality...' });
  try {
    const result = await callLLMJson(CRITIC_PROMPT(task.instruction, output), { maxTokens: 512, temperature: 0.3 });
    return { approved: result.approved !== false, feedback: result.feedback || '' };
  } catch {
    return { approved: true, feedback: 'auto-approved (critic unavailable)' };
  }
}

async function summarizerAgent(workflowId, goal, completedLogs, io) {
  emitAgentActivity(io, workflowId, 'summarizer', 'compiling', { message: 'Compiling findings into final report...' });
  emitTaskUpdate(io, workflowId, { stage: 'summarization', message: 'Compiling final report...', progress: 90 });

  try {
    const result = await callLLMJson(SUMMARIZER_PROMPT(goal, completedLogs), { maxTokens: 6000, temperature: 0.6 });
    return result.report || result.content || result.summary || completedLogs.map(l => `## ${l.agent}\n${l.output || ''}`).join('\n\n');
  } catch {
    return completedLogs.map(l => `## ${l.agent} — ${l.instruction}\n\n${l.output || 'no output'}`).join('\n\n---\n\n');
  }
}

async function runOrchestrator(workflowId, goal, userId) {
  const io = getIO();
  const MAX_RETRIES = 3;

  try {
    await updateWorkflowStep(workflowId, { status: 'running' });
    emitTaskUpdate(io, workflowId, { stage: 'initialization', message: 'Starting...', progress: 5 });

    const intentCheck = await callLLMJson(
      `User input: "${goal}"

Classify this input:
- If it is a greeting, casual chat, or too vague to act on (e.g. "hi", "hello", "how are you", "test", single words with no actionable intent): respond conversationally.
- If it is a real actionable goal (research, write, build, analyze, find, create, etc.): plan and execute it.

Respond ONLY with JSON: { "type": "chat" | "task", "reply": "short conversational reply if type is chat, else empty string" }`
    );

    if (intentCheck.type === 'chat') {
      const reply = intentCheck.reply || 'hey! give me a real goal to work on — like researching a topic, writing a report, or building something.';
      await updateWorkflowStep(workflowId, { status: 'completed' });
      emitTaskComplete(io, workflowId, {
        goalId: workflowId,
        report: { content: reply, sections: [] },
        artifacts: { code: [], files: [] },
        summary: { main: reply },
      });
      return;
    }

    const subtasks = await plannerAgent(workflowId, goal, io);
    const completedLogs = [];

    for (let i = 0; i < subtasks.length; i++) {
      if (await isCancelled(workflowId)) {
        console.log(`[ORCHESTRATOR] Workflow ${workflowId} cancelled`);
        return;
      }

      const task = subtasks[i];
      const progress = 20 + Math.round((i / subtasks.length) * 60);

      emitTaskUpdate(io, workflowId, {
        stage: 'execution_in_progress',
        message: `Executing: ${task.instruction}`,
        progress,
        currentTask: task.id,
      });

      const agentType = await routerAgent(workflowId, task, io);
      let output = null;
      let approved = false;

      while (!approved && task.retries < MAX_RETRIES) {
        try {
          output = await executeSpecialist(workflowId, task, agentType, io);
          if (await isCancelled(workflowId)) return;
          const review = await criticAgent(workflowId, task, output, io);
          if (await isCancelled(workflowId)) return;
          approved = review.approved;

          if (!approved) {
            task.retries++;
            console.log(`[ORCHESTRATOR] Task ${task.id} needs revision (attempt ${task.retries}/${MAX_RETRIES})`);
            await appendLog(workflowId, { agent: 'critic', action: 'revision_requested', taskId: task.id, feedback: review.feedback, retry: task.retries });
          }
        } catch (err) {
          task.retries++;
          console.error(`[ORCHESTRATOR] Task ${task.id} failed (attempt ${task.retries}):`, err.message);
          if (task.retries >= MAX_RETRIES) {
            output = `Task failed after ${MAX_RETRIES} attempts: ${err.message}`;
            approved = true;
          }
          await new Promise(r => setTimeout(r, 2000 * task.retries));
        }
      }

      task.status = 'completed';
      task.output = output;
      completedLogs.push({ agent: agentType, instruction: task.instruction, output, taskId: task.id });

      const workflow = await getWorkflow(workflowId);
      const updatedPlan = workflow.plan.map(t => t.id === task.id ? { ...t, status: 'completed', output } : t);
      await updateWorkflowStep(workflowId, { plan: updatedPlan });
      await appendLog(workflowId, { agent: agentType, action: 'task_completed', taskId: task.id, outputLength: output?.length });

      emitAgentActivity(io, workflowId, agentType, 'task_completed', { taskId: task.id, message: `Task completed: "${task.instruction.substring(0, 60)}..."` });
      await new Promise(r => setTimeout(r, 1000));
    }

    if (await isCancelled(workflowId)) return;
    const report = await summarizerAgent(workflowId, goal, completedLogs, io);
    if (await isCancelled(workflowId)) return;

    const outputPath = path.join(__dirname, '../outputs', `report_${workflowId}.md`);
    fs.writeFileSync(outputPath, `# ${goal}\n\n${report}`, 'utf-8');
    console.log(`[ORCHESTRATOR] Report saved: ${outputPath}`);

    const deliveryResults = await runDeliveryAgent(workflowId, report, goal, userId);

    const finalOutput = { report, outputPath, delivery: deliveryResults, completedAt: new Date().toISOString() };
    await updateWorkflowStep(workflowId, { status: 'completed', final_output: finalOutput });

    emitTaskComplete(io, workflowId, {
      goalId: workflowId,
      report: { content: report, sections: [] },
      artifacts: { code: completedLogs.filter(l => l.agent === 'code'), files: [] },
      summary: { main: report.substring(0, 500) },
    });

    console.log(`[ORCHESTRATOR] Workflow ${workflowId} completed`);
  } catch (err) {
    console.error(`[ORCHESTRATOR] Workflow ${workflowId} failed:`, err.message);
    await updateWorkflowStep(workflowId, { status: 'failed' });
    await appendLog(workflowId, { agent: 'system', action: 'workflow_failed', error: err.message });
    emitError(io, workflowId, err.message, {});
  }
}

module.exports = { runOrchestrator };
