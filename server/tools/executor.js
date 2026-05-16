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
const { runDeliveryAgent } = require('../agents/deliveryAgent');
const { updateGoalStatus, addTaskLog } = require('../db/sqlite');
const { emitTaskUpdate, emitTaskComplete, emitError } = require('../sockets/socket');
const { startTrace, startSpan, endSpan, endTrace } = require('./tracer');

/**
 * Execute the complete autonomous workflow for a goal
 * @param {string} goalId - Unique goal ID
 * @param {Object} goalData - Goal data {goal, description}
 * @param {Object} io - Socket.io instance
 * @returns {Promise<Object>} - Final result and report
 */
async function executeGoal(goalId, goalData, io) {
  const startTime = Date.now();
  let traceId, rootSpan;

  try {
    console.log(`\n========== EXECUTING GOAL: ${goalId} ==========`);
    console.log(`Goal: "${goalData.goal}"\n`);

    await updateGoalStatus(goalId, 'running');
    emitTaskUpdate(io, goalId, { stage: 'initialization', message: 'Starting...', progress: 0 });

    traceId = startTrace(goalId);
    rootSpan = startSpan(traceId, 'workflow.execute', null, { goal: goalData.goal, goalId });

    const { callGroqJson } = require('./groq');
    let intentCheck = null;
    try {
      intentCheck = await callGroqJson(
        `User input: "${goalData.goal}"

Classify this input. If it is a greeting, casual chat, single word, or too vague to act on (e.g. "hi", "hello", "how are you", "test", "hey"): type is "chat".
If it is a real actionable goal (research, write, build, analyze, find, create, summarize, etc.): type is "task".

Respond ONLY with JSON: { "type": "chat" | "task", "reply": "short friendly reply if chat, else empty string" }`
      );
    } catch (_) {}

    if (intentCheck?.type === 'chat') {
      const reply = intentCheck.reply || "hey! give me a real goal — like researching a topic, writing a report, or building something.";
      await updateGoalStatus(goalId, 'completed');
      emitTaskComplete(io, goalId, {
        goalId,
        status: 'completed',
        summary: { main: reply },
        report: { content: reply, sections: [] },
        artifacts: { code: [], files: [] },
      });
      return;
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
    const plan = await runPlanner(goalId, goalData.goal, goalData.description, io, goalData.userId);
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
          const task = getSubtask(plan, taskId);
          const routing = routingDecisions.find((r) => r.taskId === taskId);

          if (!task || !routing) {
            throw new Error(`Task ${taskId} not found in plan or routing`);
          }

          console.log(`  → Task ${taskId}: ${task.task} [${routing.assignedAgent}]`);

          const progress = 25 + (completedTasks / totalTasks) * 50;
          emitTaskUpdate(io, goalId, {
            stage: 'execution_in_progress',
            message: `Executing task: ${task.task}`,
            progress,
            currentTask: taskId,
          });

          const taskSpan = startSpan(traceId, `agent.${routing.assignedAgent}`, rootSpan.spanId, { task: task.task, taskId });
          const result = await executeTask(goalId, task, routing, io, goalData.userId);
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
          results.generated_files.push(result);
        } else if (agent === 'code_execution') {
          results.code_executions.push(result);
        } else if (agent === 'analysis') {
          results.analyses.push(result);
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
    ].join('\n\n');

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
      title: 'Structured Comparison Report',
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
      synthesisContent.summary,
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

    const summary = await runSummarizer(goalId, synthesisContent.summary, {
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
      artifacts: {
        code: results.code_executions,
        files: results.generated_files,
      },
    };

    // Save final result to database
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

    if (goalData.userId) {
      await runDeliveryAgent(goalId, reportContent, goalData.goal, goalData.userId);
    }

    return finalResult;
  } catch (error) {
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
async function executeTask(goalId, task, routing, io, userId = null) {
  const agent = routing.assignedAgent;
  const parameters = routing.parameters || {};

  try {
    console.log(`    Executing with ${agent}...`);

    switch (agent) {
      case 'web_search':
        return await runWebAgent(goalId, parameters.query || task.task, { maxResults: parameters.maxResults || 5 }, io);

      case 'file_generation':
        return await runFileAgent(goalId, parameters.content || task.task, { filename: parameters.filename || 'output.md', format: parameters.format || 'markdown' }, io);

      case 'code_execution':
        return await runCodeAgent(goalId, parameters.task || task.task, { language: parameters.language || 'javascript', execute: true }, io);

      case 'analysis':
        return await runWebAgent(goalId, parameters.query || task.task, { maxResults: 10 }, io);

      case 'notion_action':
        return await runNotionAction(goalId, task.task, userId);

      case 'slack_action':
        return await runSlackAction(goalId, task.task, userId);

      case 'github_action':
        return await runGitHubAction(goalId, task.task, userId);

      case 'google_action':
        return await runGoogleAction(goalId, task.task, userId);

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
  let summary = `## Overview\n\nThis report summarizes findings related to: "${goal}"\n\n`;

  if (findings.length > 0) {
    summary += '### Key Findings\n';
    findings.forEach((finding, i) => {
      if (finding.synthesis?.summary) {
        summary += `${i + 1}. ${finding.synthesis.summary}\n\n`;
      }
    });
  }

  let findingsContent = '### Detailed Findings\n';
  findings.forEach((finding) => {
    if (finding.query) {
      findingsContent += `\n#### ${finding.query}\n`;
    }
    if (finding.synthesis?.summary) {
      findingsContent += `\n${finding.synthesis.summary}\n`;
    }
    if (Array.isArray(finding.synthesis?.keyFindings) && finding.synthesis.keyFindings.length > 0) {
      findingsContent += '\n**Key details:**\n';
      finding.synthesis.keyFindings.forEach((item) => {
        findingsContent += `- ${typeof item === 'string' ? item : JSON.stringify(item)}\n`;
      });
    }
    if (finding.sources) {
      findingsContent += `**Sources:** ${finding.sources.length} sources found\n`;
      finding.sources.forEach((source) => {
        findingsContent += `- [${source.title}](${source.url})\n`;
      });
    }
    if (Array.isArray(finding.rawResults) && finding.rawResults.length > 0) {
      findingsContent += '\n**Search excerpts:**\n';
      finding.rawResults.slice(0, 5).forEach((result) => {
        const excerpt = result.content || result.snippet || result.description || '';
        findingsContent += `- **${result.title || 'Source'}:** ${excerpt}\n`;
      });
    }
  });

  let artifactsContent = '### Generated Artifacts\n';
  if (results.generated_files.length > 0) {
    artifactsContent += '\n**Files:**\n';
    results.generated_files.forEach((file) => {
      artifactsContent += `\n#### ${file.filename}\n\`\`\`\n${file.content || ''}\n\`\`\`\n`;
    });
  }
  if (results.code_executions.length > 0) {
    artifactsContent += '\n**Code:**\n';
    results.code_executions.forEach((code) => {
      artifactsContent += `\n#### ${code.description || 'code'} (${code.language})\n\`\`\`${code.language}\n${code.code || ''}\n\`\`\`\n`;
    });
  }

  const executionContent = `### Execution Summary
- Total tasks executed: ${(results.generated_files.length + results.code_executions.length + results.web_searches.length)}
- Web searches: ${results.web_searches.length}
- Files generated: ${results.generated_files.length}
- Code executions: ${results.code_executions.length}
- Analyses: ${results.analyses.length}`;

  return {
    summary,
    findings: findingsContent,
    artifacts: artifactsContent,
    execution: executionContent,
  };
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  executeGoal,
  executeTask,
  formatSynthesis,
};

const https = require('https');
const { getIntegration } = require('../db/integrations');

function httpsPost(hostname, path, headers, payload) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(payload) }, timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

async function runNotionAction(goalId, task, userId) {
  const integration = await getIntegration(userId, 'notion');
  if (!integration) return { skipped: true, reason: 'notion not connected' };

  const { callGroq } = require('./groq');

  const raw = await callGroq(
    `Create a Notion todo list for: "${task}"
Respond with ONLY a JSON object, no markdown:
{"title": "page title", "todos": ["todo 1", "todo 2", "todo 3"]}`,
    { maxTokens: 512, temperature: 0.5 }
  );

  let title, todos;
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    title = parsed.title || task.substring(0, 100);
    todos = Array.isArray(parsed.todos) && parsed.todos.length > 0 ? parsed.todos : [task];
  } catch {
    title = task.substring(0, 100);
    todos = [task];
  }

  const children = todos.map(todo => ({
    object: 'block',
    type: 'to_do',
    to_do: {
      rich_text: [{ type: 'text', text: { content: todo } }],
      checked: false,
    },
  }));

  const payload = JSON.stringify({
    parent: { type: 'workspace', workspace: true },
    properties: { title: [{ text: { content: title } }] },
    children,
  });

  const res = await httpsPost(
    'api.notion.com', '/v1/pages',
    { 'Authorization': `Bearer ${integration.accessToken}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
    payload
  );
  const page = JSON.parse(res.data);
  return { delivered: true, notionUrl: page.url, pageId: page.id, title, todoCount: todos.length };
}

async function runSlackAction(goalId, task, userId) {
  const integration = await getIntegration(userId, 'slack');
  if (!integration) return { skipped: true, reason: 'slack not connected' };
  const meta = JSON.parse(integration.metadata || '{}');
  if (!meta.webhookUrl) return { skipped: true, reason: 'no slack webhook' };
  const url = new URL(meta.webhookUrl);
  const payload = JSON.stringify({ text: task });
  const res = await httpsPost(url.hostname, url.pathname + url.search, { 'Content-Type': 'application/json' }, payload);
  return { delivered: true, status: res.status };
}

async function runGitHubAction(goalId, task, userId) {
  const integration = await getIntegration(userId, 'github');
  if (!integration) return { skipped: true, reason: 'github not connected' };
  const payload = JSON.stringify({ description: task.substring(0, 100), public: false, files: { 'task.md': { content: task } } });
  const res = await httpsPost('api.github.com', '/gists',
    { 'Authorization': `Bearer ${integration.accessToken}`, 'Content-Type': 'application/json', 'User-Agent': 'orian-agent' },
    payload
  );
  const gist = JSON.parse(res.data);
  return { delivered: true, gistUrl: gist.html_url };
}

async function runGoogleAction(goalId, task, userId) {
  const integration = await getIntegration(userId, 'google');
  if (!integration) return { skipped: true, reason: 'google not connected' };

  const { callGroq } = require('./groq');
  const raw = await callGroq(
    `Create content for a Google Doc about this task: "${task}"

Respond with ONLY a JSON object, no markdown:
{"title": "doc title here", "content": "full document content here"}`,
    { maxTokens: 1024, temperature: 0.5 }
  );

  let title, content;
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    title = parsed.title || task.substring(0, 100);
    content = parsed.content || task;
  } catch {
    title = task.substring(0, 100);
    content = raw;
  }

  const createRes = await httpsPost(
    'docs.googleapis.com', '/v1/documents',
    { 'Authorization': `Bearer ${integration.accessToken}`, 'Content-Type': 'application/json' },
    JSON.stringify({ title })
  );
  const doc = JSON.parse(createRes.data);
  if (!doc.documentId) {
    console.error('[GOOGLE] Create doc failed:', createRes.data);
    return { skipped: true, reason: 'failed to create doc' };
  }

  await httpsPost(
    'docs.googleapis.com', `/v1/documents/${doc.documentId}:batchUpdate`,
    { 'Authorization': `Bearer ${integration.accessToken}`, 'Content-Type': 'application/json' },
    JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text: content } }] })
  );

  return { delivered: true, docUrl: `https://docs.google.com/document/d/${doc.documentId}`, title };
}
