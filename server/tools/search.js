// ============================================
// Tavily Search API Wrapper
// ============================================
// Purpose: Interface with Tavily for web search functionality

const https = require('https');

/**
 * Perform a web search using Tavily API
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Promise<Array>} - Search results
 */
async function searchWeb(query, options = {}) {
  const {
    maxResults = 10,
    includeAnswer = true,
    includeImages = false,
  } = options;

  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    throw new Error('TAVILY_API_KEY environment variable not set');
  }

  console.log(`[SEARCH] Query: "${query}"`);
  console.log(`[SEARCH] Max results: ${maxResults}`);

  const payload = {
    api_key: apiKey,
    query,
    max_results: maxResults,
    include_answer: includeAnswer,
    include_images: includeImages,
    search_depth: 'basic',
  };

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.tavily.com',
      path: '/search',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(JSON.stringify(payload)),
      },
      timeout: 30000, // 30 second timeout
    };

    console.log('[SEARCH] Making API request...');

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            const response = JSON.parse(data);

            console.log(`[SEARCH] Found ${response.results?.length || 0} results`);

            if (response.results && Array.isArray(response.results)) {
              resolve({
                query,
                results: response.results,
                answer: response.answer || null,
                images: response.images || [],
                responseTime: response.response_time || 0,
              });
            } else {
              reject(new Error('Invalid response format from Tavily'));
            }
          } else {
            console.error(`[SEARCH ERROR] Status ${res.statusCode}:`, data);
            reject(new Error(`Tavily API error: ${res.statusCode}`));
          }
        } catch (error) {
          console.error('[SEARCH ERROR] Parse error:', error.message);
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      console.error('[SEARCH ERROR]', error.message);
      reject(error);
    });

    req.on('timeout', () => {
      req.abort();
      reject(new Error('Search API request timeout'));
    });

    req.write(JSON.stringify(payload));
    req.end();
  });
}

/**
 * Search for information about a specific topic
 * @param {string} topic - Topic to search
 * @returns {Promise<Object>} - Search result
 */
async function searchTopic(topic) {
  try {
    const result = await searchWeb(topic, {
      maxResults: 5,
      includeAnswer: true,
    });

    return result;
  } catch (error) {
    console.error('[SEARCH ERROR] Topic search failed:', error.message);
    throw error;
  }
}

/**
 * Search with retry logic
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @param {number} retries - Number of retries
 * @returns {Promise<Object>} - Search result
 */
async function searchWebWithRetry(query, options = {}, retries = 3) {
  let lastError;

  for (let i = 0; i < retries; i++) {
    try {
      console.log(`[SEARCH] Attempt ${i + 1}/${retries}`);
      return await searchWeb(query, options);
    } catch (error) {
      lastError = error;
      console.warn(`[SEARCH] Attempt ${i + 1} failed:`, error.message);

      // Wait before retry
      if (i < retries - 1) {
        const delay = Math.min(1000 * Math.pow(2, i), 5000);
        console.log(`[SEARCH] Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Search failed after all retries');
}

/**
 * Extract useful content from search results
 * @param {Object} searchResult - Result from searchWeb
 * @returns {string} - Formatted content
 */
function formatSearchResults(searchResult) {
  let formatted = `Search Results for: "${searchResult.query}"\n\n`;

  if (searchResult.answer) {
    formatted += `Quick Answer: ${searchResult.answer}\n\n`;
  }

  formatted += 'Sources:\n';
  searchResult.results.forEach((result, index) => {
    formatted += `${index + 1}. ${result.title}\n`;
    formatted += `   URL: ${result.url}\n`;
    formatted += `   Content: ${result.content?.substring(0, 200)}...\n\n`;
  });

  return formatted;
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  searchWeb,
  searchTopic,
  searchWebWithRetry,
  formatSearchResults,
};