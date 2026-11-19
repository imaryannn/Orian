// ============================================
// Critic Agent
// ============================================
// Purpose: Quality assurance and output review

const { callLLMJson } = require('../tools/llm');
const { CRITIC_SYSTEM_PROMPT, getCriticPrompt } = require('../tools/prompts');
const { addTaskLog } = require('../db/sqlite');
const { emitAgentActivity } = require('../sockets/socket');

/**
 * Run the critic agent to review output
 * @param {string} goalId - Unique goal ID
 * @param {string} output - Output to review
 * @param {string} originalGoal - The original goal for context
 * @param {Object} io - Socket.io instance
 * @returns {Promise<Object>} - Critic assessment
 */
async function runCritic(goalId, output, originalGoal, io = null) {
  try {
    console.log('[CRITIC] Starting quality review');

    // Emit activity
    emitAgentActivity(io, goalId, 'critic', 'review_starting', {
      outputLength: output.length,
      message: 'Reviewing output quality...',
    });

    // Log to database
    await addTaskLog(goalId, 'critic_start', 'Critic agent reviewing output');

    // Generate criticism prompt
    const prompt = getCriticPrompt(output, originalGoal);

    console.log('[CRITIC] Calling LLM for assessment...');

    // Call LLM for review
    const assessment = await callLLMJson(prompt, {
      maxTokens: 2048,
      temperature: 0.5,
      systemPrompt: CRITIC_SYSTEM_PROMPT,
    });

    console.log(`[CRITIC] Assessment complete - Score: ${assessment.score}`);

    // Validate assessment structure
    if (assessment.score === undefined || !assessment.status) {
      throw new Error('Invalid assessment format from LLM');
    }

    // Add metadata
    const result = {
      score: assessment.score,
      status: assessment.status, // 'approved', 'needs_revision', 'rejected'
      strengths: assessment.strengths || [],
      issues: assessment.issues || [],
      feedback: assessment.overall_feedback || '',
      timestamp: new Date().toISOString(),
    };

    // Log to database
    await addTaskLog(
      goalId,
      'critic_complete',
      `Critic assessment: ${result.status}`,
      {
        score: result.score,
        issueCount: result.issues.length,
      }
    );

    // Emit assessment
    emitAgentActivity(io, goalId, 'critic', 'assessment_complete', {
      status: result.status,
      score: result.score,
      message: `Review complete: ${result.status} (score: ${result.score})`,
    });

    // Log assessment details
    console.log(`[CRITIC] Strengths: ${result.strengths.length}`);
    console.log(`[CRITIC] Issues: ${result.issues.length}`);

    if (result.issues.length > 0) {
      result.issues.forEach((issue, i) => {
        console.log(`  ${i + 1}. [${issue.severity}] ${issue.description}`);
      });
    }

    return result;
  } catch (error) {
    console.error(`[CRITIC ERROR] ${error.message}`);

    // Log error
    await addTaskLog(goalId, 'critic_error', `Critic failed: ${error.message}`);

    // Emit error
    emitAgentActivity(io, goalId, 'critic', 'error', {
      error: error.message,
    });

    throw error;
  }
}

/**
 * Review multiple outputs
 * @param {string} goalId - Goal ID
 * @param {Array<Object>} outputs - Outputs to review [{name, content}, ...]
 * @param {string} originalGoal - Original goal
 * @param {Object} io - Socket.io instance
 * @returns {Promise<Array<Object>>} - Assessments for each output
 */
async function reviewMultiple(goalId, outputs, originalGoal, io = null) {
  try {
    console.log(`[CRITIC] Reviewing ${outputs.length} outputs`);

    const assessments = await Promise.all(
      outputs.map((output) =>
        runCritic(goalId, output.content, originalGoal, io).then((assessment) => ({
          name: output.name,
          ...assessment,
        }))
      )
    );

    console.log('[CRITIC] All reviews complete');

    return assessments;
  } catch (error) {
    console.error('[CRITIC ERROR] Batch review failed:', error.message);
    throw error;
  }
}

/**
 * Get approval status
 * @param {Object} assessment - Critic assessment
 * @returns {boolean} - Is approved
 */
function isApproved(assessment) {
  return assessment.status === 'approved' && assessment.score >= 0.7;
}

/**
 * Get revision suggestions
 * @param {Object} assessment - Critic assessment
 * @returns {Array<string>} - List of suggestions
 */
function getRevisionSuggestions(assessment) {
  if (assessment.issues.length === 0) return [];

  return assessment.issues.map((issue) => issue.suggestion || issue.description);
}

/**
 * Create improvement plan from assessment
 * @param {Object} assessment - Critic assessment
 * @param {string} originalOutput - Original output
 * @returns {Object} - Improvement plan
 */
function createImprovementPlan(assessment, originalOutput) {
  return {
    currentScore: assessment.score,
    targetScore: 0.9,
    issues: assessment.issues.map((issue) => ({
      severity: issue.severity,
      description: issue.description,
      action: issue.suggestion,
      priority:
        issue.severity === 'critical' ? 'high' :
        issue.severity === 'major' ? 'medium' : 'low',
    })),
    strategies: generateImprovementStrategies(assessment),
    estimatedEffort: calculateEstimatedEffort(assessment.issues),
  };
}

/**
 * Generate improvement strategies based on issues
 * @param {Object} assessment - Assessment object
 * @returns {Array<string>} - Improvement strategies
 */
function generateImprovementStrategies(assessment) {
  const strategies = [];

  const criticalIssues = assessment.issues.filter((i) => i.severity === 'critical');
  if (criticalIssues.length > 0) {
    strategies.push('Address all critical issues first - they block approval');
  }

  const accuracyIssues = assessment.issues.filter((i) =>
    i.description.toLowerCase().includes('accurate')
  );
  if (accuracyIssues.length > 0) {
    strategies.push('Verify facts and data against reliable sources');
  }

  const completenessIssues = assessment.issues.filter((i) =>
    i.description.toLowerCase().includes('complete')
  );
  if (completenessIssues.length > 0) {
    strategies.push('Ensure all requested elements are included');
  }

  if (strategies.length === 0) {
    strategies.push('Minor improvements: refine wording and formatting');
  }

  return strategies;
}

/**
 * Calculate estimated effort to fix issues
 * @param {Array<Object>} issues - Array of issues
 * @returns {number} - Estimated minutes
 */
function calculateEstimatedEffort(issues) {
  let effort = 0;

  issues.forEach((issue) => {
    if (issue.severity === 'critical') {
      effort += 30; // 30 mins per critical
    } else if (issue.severity === 'major') {
      effort += 15; // 15 mins per major
    } else {
      effort += 5; // 5 mins per minor
    }
  });

  return Math.max(effort, 10); // Minimum 10 minutes
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  runCritic,
  reviewMultiple,
  isApproved,
  getRevisionSuggestions,
  createImprovementPlan,
  generateImprovementStrategies,
  calculateEstimatedEffort,
};