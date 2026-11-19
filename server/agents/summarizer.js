// ============================================
// Summarizer Agent
// ============================================
// Purpose: Summarize and distill complex information

const { callLLMJson } = require('../tools/llm');
const { SUMMARIZER_SYSTEM_PROMPT, getSummarizerPrompt } = require('../tools/prompts');
const { addTaskLog } = require('../db/sqlite');
const { emitAgentActivity } = require('../sockets/socket');

/**
 * Run the summarizer agent
 * @param {string} goalId - Unique goal ID
 * @param {string} content - Content to summarize
 * @param {Object} options - Configuration options
 * @param {Object} io - Socket.io instance
 * @returns {Promise<Object>} - Summary with key points
 */
async function runSummarizer(goalId, content, options = {}, io = null) {
  try {
    const { focus = '', maxLength = 500 } = options;

    console.log(`[SUMMARIZER] Starting summarization (${content.length} chars)`);

    // Emit activity
    emitAgentActivity(io, goalId, 'summarizer', 'summarization_starting', {
      contentLength: content.length,
      focus,
      message: 'Summarizing findings into report...',
    });

    // Log to database
    await addTaskLog(goalId, 'summarizer_start', `Summarizing content${focus ? ` (focus: ${focus})` : ''}`);

    // Generate summary prompt
    const prompt = getSummarizerPrompt(content, focus);

    console.log('[SUMMARIZER] Calling LLM...');

    // Call LLM to generate summary
    const summary = await callLLMJson(prompt, {
      maxTokens: 1500,
      temperature: 0.5,
      systemPrompt: SUMMARIZER_SYSTEM_PROMPT,
    });

    console.log('[SUMMARIZER] Summary generated');

    // Validate summary structure
    if (!summary.summary) {
      throw new Error('Invalid summary format from LLM');
    }

    // Create result object
    const result = {
      summary: summary.summary,
      keyPoints: summary.key_points || [],
      highlights: summary.highlights || '',
      originalLength: content.length,
      summaryLength: summary.summary.length,
      compressionRatio: (summary.summary.length / content.length).toFixed(2),
      timestamp: new Date().toISOString(),
    };

    console.log(`[SUMMARIZER] Compression: ${result.compressionRatio}x`);

    // Log to database
    await addTaskLog(
      goalId,
      'summarizer_complete',
      'Content summarized successfully',
      {
        originalLength: result.originalLength,
        summaryLength: result.summaryLength,
        keyPointCount: result.keyPoints.length,
      }
    );

    // Emit completion
    emitAgentActivity(io, goalId, 'summarizer', 'summarization_complete', {
      keyPointCount: result.keyPoints.length,
      compressionRatio: result.compressionRatio,
      message: `Report generated (${result.summaryLength} chars)`,
    });

    return result;
  } catch (error) {
    console.error(`[SUMMARIZER ERROR] ${error.message}`);

    // Log error
    await addTaskLog(
      goalId,
      'summarizer_error',
      `Summarizer failed: ${error.message}`
    );

    // Emit error
    emitAgentActivity(io, goalId, 'summarizer', 'error', {
      error: error.message,
    });

    throw error;
  }
}

/**
 * Generate executive summary
 * @param {string} goalId - Goal ID
 * @param {string} content - Content to summarize
 * @param {Object} io - Socket.io instance
 * @returns {Promise<Object>} - Executive summary
 */
async function generateExecutiveSummary(goalId, content, io = null) {
  try {
    console.log('[SUMMARIZER] Generating executive summary');

    const summary = await runSummarizer(goalId, content, {
      focus: 'executive summary with key insights and recommendations',
      maxLength: 300,
    }, io);

    return {
      type: 'executive',
      ...summary,
    };
  } catch (error) {
    console.error('[SUMMARIZER ERROR] Executive summary failed:', error.message);
    throw error;
  }
}

/**
 * Generate technical summary
 * @param {string} goalId - Goal ID
 * @param {string} content - Content to summarize
 * @param {Object} io - Socket.io instance
 * @returns {Promise<Object>} - Technical summary
 */
async function generateTechnicalSummary(goalId, content, io = null) {
  try {
    console.log('[SUMMARIZER] Generating technical summary');

    const summary = await runSummarizer(goalId, content, {
      focus: 'technical details, specifications, and implementation notes',
      maxLength: 500,
    }, io);

    return {
      type: 'technical',
      ...summary,
    };
  } catch (error) {
    console.error('[SUMMARIZER ERROR] Technical summary failed:', error.message);
    throw error;
  }
}

/**
 * Create multi-level summary (executive + technical + full)
 * @param {string} goalId - Goal ID
 * @param {string} content - Content to summarize
 * @param {Object} io - Socket.io instance
 * @returns {Promise<Object>} - All three summary levels
 */
async function createMultiLevelSummary(goalId, content, io = null) {
  try {
    console.log('[SUMMARIZER] Creating multi-level summary');

    const [executive, technical] = await Promise.all([
      generateExecutiveSummary(goalId, content, io),
      generateTechnicalSummary(goalId, content, io),
    ]);

    return {
      executive,
      technical,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[SUMMARIZER ERROR] Multi-level summary failed:', error.message);
    throw error;
  }
}

/**
 * Summarize multiple documents
 * @param {string} goalId - Goal ID
 * @param {Array<string>} documents - Array of documents
 * @param {Object} io - Socket.io instance
 * @returns {Promise<Object>} - Combined summary
 */
async function summarizeMultiple(goalId, documents, io = null) {
  try {
    console.log(`[SUMMARIZER] Summarizing ${documents.length} documents`);

    const summaries = await Promise.all(
      documents.map((doc, i) => {
        console.log(`[SUMMARIZER] Document ${i + 1}/${documents.length}`);
        return runSummarizer(goalId, doc, {}, io);
      })
    );

    // Combine summaries
    const combinedContent = summaries
      .map((s) => s.summary)
      .join('\n\n');

    console.log('[SUMMARIZER] Creating combined summary');

    const combinedSummary = await runSummarizer(
      goalId,
      combinedContent,
      { focus: 'comprehensive overview of all documents' },
      io
    );

    return {
      documentCount: documents.length,
      individualSummaries: summaries,
      combinedSummary,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[SUMMARIZER ERROR] Multiple summarization failed:', error.message);
    throw error;
  }
}

/**
 * Extract highlights from content
 * @param {string} content - Content to extract from
 * @param {number} count - Number of highlights to extract
 * @returns {Promise<Array<string>>} - Highlights
 */
async function extractHighlights(content, count = 5) {
  try {
    const prompt = `Extract the ${count} most important highlights from this content. Return as JSON with "highlights" array.

${content}`;

    const result = await callLLMJson(prompt, {
      maxTokens: 800,
      temperature: 0.5,
    });

    return result.highlights || [];
  } catch (error) {
    console.error('[SUMMARIZER ERROR] Highlight extraction failed:', error.message);
    throw error;
  }
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  runSummarizer,
  generateExecutiveSummary,
  generateTechnicalSummary,
  createMultiLevelSummary,
  summarizeMultiple,
  extractHighlights,
};