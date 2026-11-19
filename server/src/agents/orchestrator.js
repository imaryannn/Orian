const {
  appendAgentLog,
  getWorkflow,
  updateTask,
  updateWorkflowStep,
} = require('../services/stateManager');
const { callLLMJson } = require('../tools/llm');
const {
  webAgent,
  fileAgent,
  codeAgent,
  deliveryAgent,
} = require('./specialists');

const MAX_RETRIES = 3;

async function plannerAgent(workflow) {
  const plan = await callLLMJson([
    {
      role: 'system',
      content: 'You are ORIAN Planner. Return JSON only with {"tasks":[{"agentType":"web|file|code","instruction":"...","searchQuery":"optional","code":"optional"}]}. ORIAN can search the web, write files, run tiny sandboxed code, and deliver final reports to external tools like Notion/webhooks after synthesis. Keep to 3-5 tasks.',
    },
    {
      role: 'user',
      content: `Goal: ${workflow.original_goal}`,
    },
  ], { maxTokens: 1000, temperature: 0.2 });

  const tasks = (plan.tasks || []).map((task, index) => ({
    id: `task_${index + 1}`,
    agentType: task.agentType || 'web',
    instruction: task.instruction || workflow.original_goal,
    searchQuery: task.searchQuery || task.instruction || workflow.original_goal,
    code: task.code,
    status: 'pending',
    retries: 0,
    rawOutput: null,
    critic: null,
  }));

  if (tasks.length === 0) {
    tasks.push({
      id: 'task_1',
      agentType: 'web',
      instruction: workflow.original_goal,
      searchQuery: workflow.original_goal,
      status: 'pending',
      retries: 0,
      rawOutput: null,
      critic: null,
    });
  }

  await appendAgentLog(workflow.id, {
    agent: 'planner',
    event: 'plan_created',
    message: `Planner created ${tasks.length} task(s).`,
  });

  return tasks;
}

async function criticAgent(workflowId, task, rawOutput) {
  try {
    const review = await callLLMJson([
      {
        role: 'system',
        content: 'You are ORIAN Critic. Return JSON only: {"approved":boolean,"score":0-1,"feedback":"short reason"}. Approve useful grounded outputs.',
      },
      {
        role: 'user',
        content: JSON.stringify({ instruction: task.instruction, rawOutput }).slice(0, 6000),
      },
    ], { maxTokens: 500, temperature: 0.1 });

    return {
      approved: Boolean(review.approved) || Number(review.score || 0) >= 0.7,
      score: Number(review.score || 0),
      feedback: review.feedback || '',
    };
  } catch (error) {
    await appendAgentLog(workflowId, {
      agent: 'critic',
      event: 'fallback_review',
      taskId: task.id,
      message: error.message,
    });

    return {
      approved: task.retries + 1 >= MAX_RETRIES,
      score: task.retries + 1 >= MAX_RETRIES ? 0.7 : 0.4,
      feedback: `Fallback critic due to API issue: ${error.message}`,
    };
  }
}

async function runSpecialist(workflowId, task) {
  if (task.agentType === 'file') {
    return fileAgent(workflowId, `# ${task.instruction}\n\nGenerated placeholder artifact for downstream synthesis.\n`);
  }

  if (task.agentType === 'code') {
    return codeAgent(task);
  }

  return webAgent(task);
}

async function routerAgent(workflowId) {
  let workflow = await getWorkflow(workflowId);
  let pending = workflow.plan.filter((task) => task.status === 'pending');

  while (pending.length > 0) {
    const task = pending[0];
    await updateTask(workflowId, task.id, { status: 'running' });
    await appendAgentLog(workflowId, {
      agent: 'router',
      event: 'dispatch',
      taskId: task.id,
      message: `Dispatching ${task.id} to ${task.agentType} agent.`,
    });

    try {
      const rawOutput = await runSpecialist(workflowId, task);
      const critic = await criticAgent(workflowId, task, rawOutput);

      if (critic.approved) {
        await updateTask(workflowId, task.id, { status: 'completed', rawOutput, critic });
        await appendAgentLog(workflowId, {
          agent: 'critic',
          event: 'approved',
          taskId: task.id,
          message: critic.feedback || 'Task approved.',
        });
      } else if ((task.retries || 0) + 1 >= MAX_RETRIES) {
        await updateTask(workflowId, task.id, { status: 'completed', rawOutput, critic });
        await appendAgentLog(workflowId, {
          agent: 'critic',
          event: 'max_retries_accepted',
          taskId: task.id,
          message: critic.feedback,
        });
      } else {
        await updateTask(workflowId, task.id, {
          status: 'pending',
          retries: (task.retries || 0) + 1,
          rawOutput,
          critic,
          lastError: critic.feedback,
        });
      }
    } catch (error) {
      const retries = (task.retries || 0) + 1;
      await updateTask(workflowId, task.id, {
        status: retries >= MAX_RETRIES ? 'failed' : 'pending',
        retries,
        lastError: error.message,
      });
      await appendAgentLog(workflowId, {
        agent: task.agentType,
        event: 'error',
        taskId: task.id,
        message: error.message,
      });
    }

    workflow = await getWorkflow(workflowId);
    pending = workflow.plan.filter((nextTask) => nextTask.status === 'pending');
  }
}

async function summarizerAgent(workflow) {
  const completed = workflow.plan.filter((task) => task.status === 'completed');
  const sourceText = completed.map((task) => (
    `Task: ${task.instruction}\nOutput: ${JSON.stringify(task.rawOutput).slice(0, 2000)}`
  )).join('\n\n');

  const summary = await callLLMJson([
    {
      role: 'system',
      content: 'You are ORIAN Summarizer. Return JSON only: {"title":"...","executiveSummary":"...","keyFindings":["..."],"markdown":"..."}',
    },
    {
      role: 'user',
      content: `Original goal: ${workflow.original_goal}\n\nCompleted task evidence:\n${sourceText}`,
    },
  ], { maxTokens: 1800, temperature: 0.3 });

  const keyFindings = Array.isArray(summary.keyFindings) ? summary.keyFindings : [];
  const markdown = summary.markdown || [
    `# ${summary.title || 'ORIAN Workflow Report'}`,
    '',
    `## Goal`,
    workflow.original_goal,
    '',
    `## Executive Summary`,
    summary.executiveSummary || '',
    '',
    `## Key Findings`,
    ...keyFindings.map((finding) => `- ${finding}`),
  ].join('\n');

  return {
    title: summary.title || 'ORIAN Workflow Report',
    executiveSummary: summary.executiveSummary || '',
    keyFindings,
    markdown,
  };
}

async function executeWorkflow(workflowId) {
  await updateWorkflowStep(workflowId, { status: 'planning' });
  let workflow = await getWorkflow(workflowId);

  try {
    const plan = await plannerAgent(workflow);
    await updateWorkflowStep(workflowId, { status: 'running', plan });

    await routerAgent(workflowId);

    workflow = await getWorkflow(workflowId);
    const failed = workflow.plan.filter((task) => task.status === 'failed');
    if (failed.length > 0) {
      await updateWorkflowStep(workflowId, { status: 'failed' });
      return;
    }

    await updateWorkflowStep(workflowId, { status: 'summarizing' });
    const report = await summarizerAgent(workflow);
    const fileResult = await fileAgent(workflowId, report.markdown);
    const deliveryResult = await deliveryAgent(workflowId, { ...report, filePath: fileResult.filePath });

    await updateWorkflowStep(workflowId, {
      status: 'completed',
      final_output: {
        ...report,
        filePath: fileResult.filePath,
        delivery: deliveryResult,
      },
    });

    await appendAgentLog(workflowId, {
      agent: 'delivery',
      event: 'side_effect_complete',
      message: `External tool delivery finished: ${deliveryResult.results.map((result) => result.tool).join(', ')}`,
    });
  } catch (error) {
    await appendAgentLog(workflowId, {
      agent: 'orchestrator',
      event: 'fatal_error',
      message: error.message,
    });
    await updateWorkflowStep(workflowId, {
      status: 'failed',
      final_output: { error: error.message },
    });
  }
}

module.exports = {
  executeWorkflow,
  plannerAgent,
  routerAgent,
  criticAgent,
  summarizerAgent,
};
