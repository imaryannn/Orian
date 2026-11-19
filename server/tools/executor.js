// ============================================
// Workflow Executor - Main Orchestration Logic
// ============================================
// Purpose: Orchestrate the entire autonomous agent workflow

const { runPlanner, getExecutionOrder, getSubtask } = require('../agents/planner');
const { routeTask } = require('../agents/router');
const { runWebAgent } = require('../agents/webAgent');
const { runFileAgent, createMarkdownReport } = require('../agents/fileAgent');
const { runCodeAgent } = require('../agents/codeAgent');
const { runCritic, isApproved } = require('../agents/critic');
const { runSummarizer } = require('../agents/summarizer');
const { mergeFiles } = require('../lib/workspace');
const { actionLinks, conciseSummary } = require('./actionResult');
const { runIntegrationAgent } = require('../agents/integrationAgent');
const { getGoal, updateGoalStatus, addTaskLog } = require('../db/sqlite');
const { emitTaskUpdate, emitTaskComplete, emitError } = require('../sockets/socket');
const { startTrace, startSpan, endSpan, endTrace } = require('./tracer');
const { runWithLLMUser } = require('./llm');

/**
 * Execute the complete autonomous workflow for a goal
 * @param {string} goalId - Unique goal ID
 * @param {Object} goalData - Goal data {goal, description}
 * @param {Object} io - Socket.io instance
 * @returns {Promise<Object>} - Final result and report
 */
async function executeGoalInternal(goalId, goalData, io) {
  const startTime = Date.now();
  let traceId, rootSpan;

  try {
    console.log(`\n========== EXECUTING GOAL: ${goalId} ==========`);
    console.log(`Goal: "${goalData.goal}"\n`);

    await updateGoalStatus(goalId, 'running');
    emitTaskUpdate(io, goalId, { stage: 'initialization', message: 'Starting...', progress: 0 });

    traceId = startTrace(goalId);
    rootSpan = startSpan(traceId, 'workflow.execute', null, { goal: goalData.goal, goalId });

    await assertNotCancelled(goalId);
    emitTaskUpdate(io, goalId, { stage: 'understanding', message: 'Reading your request and conversation', progress: 3, agent: 'assistant' });
    const intentCheck = await require('../agents/intent').classifyRequest(goalData.goal, goalData.context || [], Boolean(goalData.workspace?.files?.length));
    if (!['chat', 'task', 'clarify'].includes(intentCheck.type)) throw new Error('Invalid intent response');
    if (intentCheck.type === 'chat' || intentCheck.type === 'clarify') {
      if (typeof intentCheck.reply !== 'string' || !intentCheck.reply.trim()) throw new Error('Empty chat response');
      const reply = intentCheck.reply;
      const result = { goalId, mode: intentCheck.type === 'clarify' ? 'clarification' : 'chat', status: 'completed', summary: { main: reply }, report: { content: reply, sections: [] }, artifacts: { code: [], files: [] } };
      await assertNotCancelled(goalId);
      await updateGoalStatus(goalId, 'completed', result);
      emitTaskComplete(io, goalId, result);
      endSpan(rootSpan, 'ok');
      endTrace(traceId);
      return result;
    }

    // ============================================
    // PHASE 1: PLANNING
    // ============================================
    console.log('\n>>> PHASE 1: PLANNING');
    emitTaskUpdate(io, goalId, {
      stage: 'planning',
      message: 'Planner analyzing goal and creating plan',
      progress: 10,
    });

    const planSpan = startSpan(traceId, 'agent.planner', rootSpan.spanId, { goal: goalData.goal });
    const plan = await runPlanner(goalId, goalData.goal, `${goalData.description || ''}\n${goalData.workspace?.files?.length ? 'Existing coding workspace: ' + goalData.workspace.files.map(f => f.path).join(', ') + '. Route requested changes to code_execution.' : ''}`, io, goalData.userId, goalData.context || []);
    endSpan(planSpan, 'ok', { subtaskCount: plan.subtasks.length });

    console.log(`✓ Plan created with ${plan.subtasks.length} subtasks`);
    console.log(`✓ Estimated time: ${plan.total_estimated_time_minutes} minutes`);

    emitTaskUpdate(io, goalId, {
      stage: 'planning_complete',
      message: `Plan ready: ${plan.subtasks.length} subtasks`,
      progress: 15,
      plan,
    });

    // ============================================
    // PHASE 2: ROUTING
    // ============================================
    console.log('\n>>> PHASE 2: ROUTING');
    emitTaskUpdate(io, goalId, {
      stage: 'routing',
      message: 'Router assigning tasks to specialist agents',
      progress: 20,
    });

    const routingDecisions = [];
    for (const task of plan.subtasks) {
      const decision = await routeTask(goalId, task, io);
      routingDecisions.push(decision);
      await new Promise(r => setTimeout(r, 500));
    }

    console.log(`✓ All ${routingDecisions.length} tasks routed`);

    // Get execution order
    const executionOrder = getExecutionOrder(plan);
    console.log(`✓ Execution order determined: ${executionOrder.length} batches`);

    emitTaskUpdate(io, goalId, {
      stage: 'routing_complete',
      message: `Tasks routed to ${new Set(routingDecisions.map((r) => r.assignedAgent)).size} agents`,
      progress: 25,
      routing: routingDecisions,
    });

    // ============================================
    // PHASE 3: EXECUTION
    // ============================================
    console.log('\n>>> PHASE 3: EXECUTION');

    const results = {
      web_searches: [],
      generated_files: [],
      code_executions: [],
      analyses: [],
      actions: [],
    };

    let completedTasks = 0;
    const totalTasks = plan.subtasks.length;

    // Execute tasks in order respecting dependencies
    for (let batchIndex = 0; batchIndex < executionOrder.length; batchIndex++) {
      const batchIds = executionOrder[batchIndex];

      console.log(`\nBatch ${batchIndex + 1}/${executionOrder.length}: ${batchIds.length} tasks`);

      // Execute tasks sequentially to avoid rate limits
      const batchResults = [];
      for (const taskId of batchIds) {
          await assertNotCancelled(goalId);
          const task = getSubtask(plan, taskId);
          const routing = routingDecisions.find((r) => r.taskId === taskId);

          if (!task || !routing) {
            throw new Error(`Task ${taskId} not found in plan or routing`);
          }

          console.log(`  → Task ${taskId}: ${task.task} [${routing.assignedAgent}]`);

          const progress = 25 + (completedTasks / totalTasks) * 50;
          emitTaskUpdate(io, goalId, {
            stage: 'execution_in_progress',
            agent: routing.assignedAgent,
            message: `Executing task: ${task.task}`,
            progress,
            currentTask: taskId,
          });

          const taskSpan = startSpan(traceId, `agent.${routing.assignedAgent}`, rootSpan.spanId, { task: task.task, taskId });
          const priorWork = JSON.stringify({ conversation: goalData.context || [], results, currentBatch: batchResults, workspace: goalData.workspace });
          const result = await executeTask(goalId, task, routing, io, goalData.userId, priorWork.slice(-180000));
          if ((routing.assignedAgent === 'code_execution' || result.workspaceArtifact) && result.files?.length) {
            goalData.workspace = { files: mergeFiles(goalData.workspace?.files || [], result.files), entry: goalData.workspace?.entry || result.files.find(file => file.path.endsWith('.html') && !require('../lib/workspace').isTestPage(file.content, file.path))?.path || result.entry };
            goalData.workspace = await require('../db/sqlite').saveWorkspace(goalId, goalData.workspace);
          }
          await assertNotCancelled(goalId);
          if (result.needsInput) {
            const reply = { goalId, mode: 'clarification', status: 'completed', report: { content: result.question, sections: [] }, artifacts: { code: [], files: [] } };
            await updateGoalStatus(goalId, 'completed', reply);
            emitTaskComplete(io, goalId, reply);
            endSpan(taskSpan, 'ok');
            endSpan(rootSpan, 'ok');
            endTrace(traceId);
            return reply;
          }
          endSpan(taskSpan, 'ok', { agent: routing.assignedAgent });
          completedTasks++;
          batchResults.push({ taskId, task: task.task, agent: routing.assignedAgent, result });

          await new Promise(r => setTimeout(r, 1000));
      }

      // Store results by agent type
      batchResults.forEach((batchResult) => {
        const { agent, result } = batchResult;

        if (agent === 'web_search') {
          results.web_searches.push(result);
        } else if (agent === 'file_generation') {
          if (result.workspaceArtifact) results.code_executions.push(result);
          else results.generated_files.push(result);
        } else if (agent === 'code_execution') {
          results.code_executions.push(result);
        } else if (agent === 'analysis') {
          results.analyses.push(result);
        } else {
          results.actions.push(result);
        }
      });

      console.log(`✓ Batch ${batchIndex + 1} complete`);
    }

    console.log(`\n✓ All tasks executed`);

    emitTaskUpdate(io, goalId, {
      stage: 'execution_complete',
      message: 'All tasks completed',
      progress: 75,
      results,
    });

    // ============================================
    // PHASE 4: SYNTHESIS & REPORTING
    // ============================================
    console.log('\n>>> PHASE 4: SYNTHESIS & REPORTING');
    emitTaskUpdate(io, goalId, {
      stage: 'synthesis',
      message: 'Synthesizing results into report',
      progress: 80,
    });

    // Combine all findings
    const allFindings = [
      ...results.web_searches,
      ...results.analyses,
    ];

    const synthesisContent = formatSynthesis(goalData.goal, allFindings, results);

    console.log('Generating final report...');
    const reportContent = [
      synthesisContent.summary,
      synthesisContent.findings,
      synthesisContent.artifacts,
      synthesisContent.execution,
    ].filter(Boolean).join('\n\n');

    const reportFile = {
      filename: `report-${goalId}.md`,
      content: reportContent,
      sections: [
        { title: 'Executive Summary', content: synthesisContent.summary },
        { title: 'Findings', content: synthesisContent.findings },
        { title: 'Generated Artifacts', content: synthesisContent.artifacts },
        { title: 'Execution Summary', content: synthesisContent.execution },
      ],
    };

    console.log(`✓ Report generated: ${reportFile.filename}`);

    const savedReportFile = await runFileAgent(goalId, reportContent, {
      filename: reportFile.filename,
      format: 'markdown',
      title: goalData.goal.slice(0, 100),
      structure: false,
    }, io);
    results.generated_files.push(savedReportFile);
    reportFile.filepath = savedReportFile.filepath;
    reportFile.size = savedReportFile.size;

    emitTaskUpdate(io, goalId, {
      stage: 'report_generated',
      message: 'Final report generated',
      progress: 85,
      report: reportFile,
    });

    // ============================================
    // PHASE 5: QUALITY REVIEW (OPTIONAL)
    // ============================================
    console.log('\n>>> PHASE 5: QUALITY REVIEW');
    emitTaskUpdate(io, goalId, {
      stage: 'quality_review',
      message: 'Critic reviewing output quality',
      progress: 90,
    });

    const criticAssessment = await runCritic(
      goalId,
      reportContent,
      goalData.goal,
      io
    );

    console.log(`✓ Quality assessment: ${criticAssessment.status}`);
    console.log(`✓ Quality score: ${criticAssessment.score}`);

    emitTaskUpdate(io, goalId, {
      stage: 'quality_complete',
      message: `Quality assessment: ${criticAssessment.status}`,
      progress: 92,
      assessment: criticAssessment,
    });

    // ============================================
    // PHASE 6: SUMMARIZATION
    // ============================================
    console.log('\n>>> PHASE 6: SUMMARIZATION');
    emitTaskUpdate(io, goalId, {
      stage: 'summarization',
      message: 'Creating executive summary',
      progress: 95,
    });

    const summary = await runSummarizer(goalId, reportContent, {
      focus: 'key findings and actionable insights',
    }, io);

    console.log(`✓ Summary created (${summary.keyPoints.length} key points)`);

    // ============================================
    // FINAL RESULT
    // ============================================
    console.log('\n>>> FINALIZING');

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    const finalResult = {
      goalId,
      goal: goalData.goal,
      status: 'completed',
      duration: `${duration}s`,
      timestamp: new Date().toISOString(),
      phases: {
        planning: true,
        routing: true,
        execution: true,
        synthesis: true,
        review: criticAssessment.status,
        summarization: true,
      },
      results: {
        searchCount: results.web_searches.length,
        filesGenerated: results.generated_files.length,
        codeExecutions: results.code_executions.length,
        analyses: results.analyses.length,
      },
      quality: {
        score: criticAssessment.score,
        status: criticAssessment.status,
        approved: isApproved(criticAssessment),
      },
      summary: {
        main: summary.summary,
        keyPoints: summary.keyPoints,
        highlights: summary.highlights,
      },
      report: reportFile,
      workspace: goalData.workspace || null,
      artifacts: {
        code: results.code_executions,
        files: results.generated_files,
      },
    };

    // Save final result to database
    await assertNotCancelled(goalId);
    finalResult.actions = results.actions;
    await updateGoalStatus(goalId, 'completed', finalResult);

    // Log completion
    await addTaskLog(goalId, 'execution_complete', 'Goal execution completed successfully', {
      duration,
      quality: finalResult.quality.score,
    });

    console.log(`\n✓ Goal execution complete in ${duration}s`);
    console.log(`✓ Quality score: ${finalResult.quality.score}`);
    console.log(`\n========== GOAL COMPLETED ==========\n`);

    emitTaskComplete(io, goalId, finalResult);

    endSpan(rootSpan, 'ok', { duration: finalResult.duration, quality: finalResult.quality?.score });
    endTrace(traceId);


    return finalResult;
  } catch (error) {
    if (error.code === 'cancelled') {
      if (rootSpan) endSpan(rootSpan, 'cancelled');
      if (traceId) endTrace(traceId);
      throw error;
    }
    console.error(`\n✗ Goal execution failed: ${error.message}`);
    console.error(error.stack);

    // Update status to failed
    await updateGoalStatus(goalId, 'failed', {
      error: error.message,
      timestamp: new Date().toISOString(),
    });

    // Log error
    await addTaskLog(goalId, 'execution_error', `Goal failed: ${error.message}`);

    // Emit error
    emitError(io, goalId, error.message, { stack: error.stack });

    if (traceId && rootSpan) {
      endSpan(rootSpan, 'error', { error: error.message });
      endTrace(traceId);
    }

    throw error;
  }
}

/**
 * Execute a single task
 * @param {string} goalId - Goal ID
 * @param {Object} task - Task from plan
 * @param {Object} routing - Routing decision
 * @param {Object} io - Socket.io instance
 * @returns {Promise<Object>} - Task result
 */
async function executeTask(goalId, task, routing, io, userId = null, context = '') {
  const agent = routing.assignedAgent;
  const parameters = routing.parameters || {};

  try {
    console.log(`    Executing with ${agent}...`);

    switch (agent) {
      case 'web_search':
        return await runWebAgent(goalId, parameters.query || task.task, { maxResults: parameters.maxResults || 5 }, io);

      case 'file_generation':
        if (/\b(?:HTML|CSS|JavaScript)\b|\bindex\.html\b/i.test(task.task) || /\.(html|js|css)$/.test(parameters.filename || '')) {
          return { ...await runCodeAgent(goalId, `${task.task}\nPrevious work: ${context}`, { execute: false }, io), workspaceArtifact: true };
        }
        return await runFileAgent(goalId, `${parameters.content || task.task}\n\nPrevious work:\n${context}`, { filename: parameters.filename || 'output.md', format: parameters.format || 'markdown' }, io);

      case 'code_execution':
        return await runCodeAgent(goalId, `${parameters.task || task.task}\n\nPrevious work:\n${context}`, { language: parameters.language || 'javascript', execute: false }, io);

      case 'analysis': {
        const { callLLM } = require('./llm');
        const summary = await callLLM(`Task: ${task.task}\nPrevious work and conversation: ${context}`, { maxTokens: 3072, systemPrompt: 'Analyze or write the requested content using the provided evidence. Do not invent sources or claim tool actions.' });
        return { query: task.task, synthesis: { summary }, sources: [] };
      }
      case 'notion_action':
      case 'slack_action':
      case 'github_action':
      case 'google_action':
      case 'linear_action':
      case 'airtable_action':
        return runIntegrationAgent(goalId, task.task, agent.replace('_action', ''), userId, io, context);

      default:
        throw new Error(`Unknown agent: ${agent}`);
    }
  } catch (error) {
    console.error(`    ✗ Task execution failed: ${error.message}`);
    throw error;
  }
}

/**
 * Format synthesis from all findings
 * @param {string} goal - Original goal
 * @param {Array<Object>} findings - All findings from agents
 * @param {Object} results - Results object
 * @returns {Object} - Formatted content
 */
function formatSynthesis(goal, findings, results) {
  const findingsContent = findings.map(finding => {
    let text = finding.synthesis?.summary || '';
    if (finding.synthesis?.keyFindings?.length) text += '\n\n' + finding.synthesis.keyFindings.map(item => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n');
    if (finding.sources?.length) text += '\n\nSources:\n' + finding.sources.map(source => `- [${source.title || source.url}](${source.url})`).join('\n');
    return text;
  }).filter(Boolean).join('\n\n');
  const artifacts = results.generated_files.map(file => file.content || '').filter(Boolean);
  for (const code of results.code_executions) artifacts.push(code.description || 'Code is ready in the workspace.');
  for (const action of results.actions || []) {
    artifacts.push(conciseSummary(action.summary));
    for (const url of actionLinks(action)) artifacts.push(`[Open ${action.provider === 'google' ? 'Google Doc' : action.provider === 'notion' ? 'Notion page' : action.provider}](${url})`);
  }
  return { summary: '', findings: findingsContent, artifacts: artifacts.join('\n\n'), execution: '' };
}

// ============================================
// EXPORTS
// ============================================

async function executeGoal(goalId, goalData, io) {
  return runWithLLMUser(goalData && goalData.userId, () => executeGoalInternal(goalId, goalData, io), () => assertNotCancelled(goalId));
}

module.exports = {
  executeGoal,
  executeTask,
  formatSynthesis,
};

async function assertNotCancelled(goalId) {
  const goal = await getGoal(goalId);
  if (!goal || goal.status === 'cancelled') {
    const error = new Error('Task cancelled');
    error.code = 'cancelled';
    throw error;
  }
}
