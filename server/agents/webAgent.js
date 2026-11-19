// ============================================
// Web Search Agent
// ============================================
// Purpose: Research and information gathering via web search

const { searchWebWithRetry, formatSearchResults } = require('../tools/search');
const { callLLMJson } = require('../tools/llm');
const { WEB_AGENT_SYSTEM_PROMPT, getWebAgentPrompt } = require('../tools/prompts');
const { addTaskLog } = require('../db/sqlite');
const { emitAgentActivity } = require('../sockets/socket');

/**
 * Run the web search agent
 * @param {string} goalId - Unique goal ID
 * @param {string} searchQuery - What to search for
 * @param {Object} options - Configuration options
 * @param {Object} io - Socket.io instance
 * @returns {Promise<Object>} - Research findings
 */
async function runWebAgent(goalId, searchQuery, options = {}, io = null) {
  try {
    const { maxResults = 5, format = true } = options;

    console.log(`[WEB_AGENT] Starting research for: "${searchQuery}"`);

    // Emit activity
    emitAgentActivity(io, goalId, 'web_agent', 'search_starting', {
      query: searchQuery,
      message: `Searching the web for "${searchQuery}"...`,
    });

    // Log to database
    await addTaskLog(goalId, 'web_agent_start', `Web agent searching: ${searchQuery}`);

    // Perform web search
    console.log('[WEB_AGENT] Performing web search...');
    const searchResult = await searchWebWithRetry(searchQuery, {
      maxResults,
      includeAnswer: true,
      includeImages: false,
    });

    console.log(
      `[WEB_AGENT] Found ${searchResult.results.length} results`
    );

    // Emit search complete
    emitAgentActivity(io, goalId, 'web_agent', 'search_complete', {
      resultCount: searchResult.results.length,
      message: `Found ${searchResult.results.length} results, analyzing...`,
    });

    // Format results
    let formattedResults = searchResult;
    if (format) {
      formattedResults = formatSearchResults(searchResult);
    }

    // Extract and synthesize key information
    console.log('[WEB_AGENT] Synthesizing findings...');

    const synthesisPrompt = getWebAgentPrompt(searchQuery, formattedResults);

    let synthesis;
    try {
      synthesis = await callLLMJson(synthesisPrompt, {
        maxTokens: 2048,
        temperature: 0.5,
        systemPrompt: WEB_AGENT_SYSTEM_PROMPT,
      });
    } catch (llmErr) {
      console.warn('[WEB_AGENT] LLM synthesis failed, using raw results:', llmErr.message);
      synthesis = { summary: formattedResults?.toString() || searchQuery, keyFindings: [], sources: [] };
    }

    console.log('[WEB_AGENT] Synthesis complete');

    // Create findings object
    const findings = {
      query: searchQuery,
      rawResults: searchResult.results,
      synthesis: synthesis,
      sources: searchResult.results.map((r) => ({
        title: r.title,
        url: r.url,
      })),
      timestamp: new Date().toISOString(),
      searchTime: searchResult.responseTime || 0,
    };

    // Log to database
    await addTaskLog(
      goalId,
      'web_agent_complete',
      `Web research complete: ${searchQuery}`,
      {
        resultCount: searchResult.results.length,
      }
    );

    // Emit completion
    emitAgentActivity(io, goalId, 'web_agent', 'synthesis_complete', {
      sourceCount: findings.sources.length,
      message: `Synthesized ${findings.sources.length} sources into findings`,
    });

    return findings;
  } catch (error) {
    console.error(`[WEB_AGENT ERROR] ${error.message}`);

    // Log error
    await addTaskLog(
      goalId,
      'web_agent_error',
      `Web agent failed: ${error.message}`
    );

    // Emit error
    emitAgentActivity(io, goalId, 'web_agent', 'error', {
      error: error.message,
    });

    throw error;
  }
}

/**
 * Run multiple web searches in parallel
 * @param {string} goalId - Goal ID
 * @param {Array<string>} queries - Search queries
 * @param {Object} io - Socket.io instance
 * @returns {Promise<Array<Object>>} - Array of findings
 */
async function runMultipleSearches(goalId, queries, io = null) {
  try {
    console.log(`[WEB_AGENT] Starting ${queries.length} searches in parallel`);

    const results = await Promise.all(
      queries.map((query) => runWebAgent(goalId, query, {}, io))
    );

    console.log(`[WEB_AGENT] All searches complete`);

    return results;
  } catch (error) {
    console.error('[WEB_AGENT ERROR] Parallel search failed:', error.message);
    throw error;
  }
}

/**
 * Extract specific information from search results
 * @param {Array<Object>} searchResults - Raw search results
 * @param {string} extractionQuery - What to extract
 * @returns {Promise<Object>} - Extracted information
 */
async function extractFromResults(searchResults, extractionQuery) {
  try {
    console.log(`[WEB_AGENT] Extracting: ${extractionQuery}`);

    const content = searchResults
      .map((r) => `${r.title}: ${r.content}`)
      .join('\n\n');

    const extractionPrompt = `Extract information about "${extractionQuery}" from the following search results:

${content}

Return as JSON with relevant keys.`;

    const extracted = await callLLMJson(extractionPrompt, {
      maxTokens: 1024,
      temperature: 0.3,
    });

    return extracted;
  } catch (error) {
    console.error('[WEB_AGENT ERROR] Extraction failed:', error.message);
    throw error;
  }
}

/**
 * Compare multiple search results
 * @param {Array<Object>} searchResults - Array of search results
 * @param {string} comparisonTopic - Topic to compare on
 * @returns {Promise<Object>} - Comparison analysis
 */
async function compareResults(searchResults, comparisonTopic) {
  try {
    console.log(`[WEB_AGENT] Comparing results on: ${comparisonTopic}`);

    const resultsSummary = searchResults
      .map((r) => `- ${r.title}: ${r.content?.substring(0, 100)}...`)
      .join('\n');

    const comparisonPrompt = `Compare the following search results on the topic "${comparisonTopic}":

${resultsSummary}

Provide a detailed comparison highlighting differences, similarities, and key insights.`;

    const comparison = await callLLMJson(comparisonPrompt, {
      maxTokens: 1500,
      temperature: 0.5,
    });

    return comparison;
  } catch (error) {
    console.error('[WEB_AGENT ERROR] Comparison failed:', error.message);
    throw error;
  }
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  runWebAgent,
  runMultipleSearches,
  extractFromResults,
  compareResults,
};