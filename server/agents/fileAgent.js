// ============================================
// File Generation Agent
// ============================================
// Purpose: Generate reports, documentation, and structured files

const fs = require('fs');
const path = require('path');
const { callGroqJson } = require('../tools/groq');
const { FILE_AGENT_SYSTEM_PROMPT, getFileAgentPrompt } = require('../tools/prompts');
const { addTaskLog, addFile } = require('../db/sqlite');
const { emitAgentActivity } = require('../sockets/socket');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log(`[FILE_AGENT] Created uploads directory: ${uploadsDir}`);
}

/**
 * Run the file generation agent
 * @param {string} goalId - Unique goal ID
 * @param {string} content - Content to include in file
 * @param {Object} options - Configuration options
 * @param {Object} io - Socket.io instance
 * @returns {Promise<Object>} - Generated file info
 */
async function runFileAgent(goalId, content, options = {}, io = null) {
  try {
    const {
      filename = 'report.md',
      format = 'markdown',
      title = 'Generated Report',
    } = options;

    console.log(`[FILE_AGENT] Generating file: ${filename}`);

    // Emit activity
    emitAgentActivity(io, goalId, 'file_agent', 'generation_starting', {
      filename,
      format,
    });

    // Log to database
    await addTaskLog(
      goalId,
      'file_agent_start',
      `Generating file: ${filename}`
    );

    // Generate file content using Groq
    console.log('[FILE_AGENT] Calling Groq to structure content...');

    const generationPrompt = getFileAgentPrompt(content, format, title);

    let fileContent = content;
    let finalFilename = filename;
    let fileFormat = format;

    try {
      const fileData = await callGroqJson(generationPrompt, {
        model: process.env.GROQ_MODEL || 'mixtral-8x7b-32768',
        maxTokens: 4096,
        temperature: 0.7,
        systemPrompt: FILE_AGENT_SYSTEM_PROMPT,
      });
      if (fileData.content) {
        fileContent = fileData.content;
        finalFilename = fileData.filename || filename;
        fileFormat = fileData.format || format;
      }
    } catch (groqErr) {
      console.warn('[FILE_AGENT] Groq structuring failed, writing raw content:', groqErr.message);
    }

    console.log('[FILE_AGENT] Content structured');

    const result = {
      filename: finalFilename,
      format: fileFormat,
      content: fileContent,
      size: Buffer.byteLength(fileContent),
      title,
      timestamp: new Date().toISOString(),
    };

    const filePath = path.join(uploadsDir, finalFilename);
    fs.writeFileSync(filePath, fileContent, 'utf-8');
    const fileSize = fs.statSync(filePath).size;
    await addFile(goalId, finalFilename, filePath, fileFormat, fileSize);

    result.filepath = filePath;
    result.size = fileSize;

    await addTaskLog(goalId, 'file_agent_complete', `File generated: ${finalFilename}`, { filename: finalFilename, format: fileFormat });
    emitAgentActivity(io, goalId, 'file_agent', 'generation_complete', { filename: finalFilename });

    return result;
  } catch (error) {
    console.error(`[FILE_AGENT ERROR] ${error.message}`);

    // Log error
    await addTaskLog(
      goalId,
      'file_agent_error',
      `File generation failed: ${error.message}`
    );

    // Emit error
    emitAgentActivity(io, goalId, 'file_agent', 'error', {
      error: error.message,
    });

    throw error;
  }
}

/**
 * Create a markdown report from content
 * @param {string} goalId - Goal ID
 * @param {Object} reportData - Report data object
 * @param {Object} io - Socket.io instance
 * @returns {Promise<Object>} - File info
 */
async function createMarkdownReport(goalId, reportData, io = null) {
  try {
    const {
      title = 'Report',
      sections = [],
      metadata = {},
    } = reportData;

    // Build markdown content
    let content = `# ${title}\n\n`;

    if (metadata.createdAt) {
      content += `**Generated:** ${metadata.createdAt}\n`;
    }
    if (metadata.summary) {
      content += `\n## Summary\n${metadata.summary}\n`;
    }

    // Add sections
    sections.forEach((section) => {
      content += `\n## ${section.title}\n`;
      if (section.content) {
        content += `${section.content}\n`;
      }
      if (section.items && Array.isArray(section.items)) {
        section.items.forEach((item) => {
          content += `- ${item}\n`;
        });
      }
    });

    // Generate filename
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${title.replace(/\s+/g, '_')}_${timestamp}.md`;

    // Generate file
    return runFileAgent(goalId, content, {
      filename,
      format: 'markdown',
      title,
    }, io);
  } catch (error) {
    console.error('[FILE_AGENT ERROR] Markdown report creation failed:', error.message);
    throw error;
  }
}

/**
 * Create a JSON report
 * @param {string} goalId - Goal ID
 * @param {Object} data - Data to save as JSON
 * @param {Object} io - Socket.io instance
 * @returns {Promise<Object>} - File info
 */
async function createJsonReport(goalId, data, io = null) {
  try {
    const content = JSON.stringify(data, null, 2);
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `report_${timestamp}.json`;

    // Write file directly (don't use Groq for JSON)
    const filePath = path.join(uploadsDir, filename);
    fs.writeFileSync(filePath, content, 'utf-8');

    const fileSize = fs.statSync(filePath).size;

    // Record in database
    await addFile(goalId, filename, filePath, 'json', fileSize);

    console.log(`[FILE_AGENT] JSON report created: ${filename}`);

    return {
      filename,
      filepath: filePath,
      format: 'json',
      size: fileSize,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[FILE_AGENT ERROR] JSON report creation failed:', error.message);
    throw error;
  }
}

/**
 * Create an HTML report
 * @param {string} goalId - Goal ID
 * @param {Object} reportData - Report data
 * @param {Object} io - Socket.io instance
 * @returns {Promise<Object>} - File info
 */
async function createHtmlReport(goalId, reportData, io = null) {
  try {
    const {
      title = 'Report',
      content = '',
      cssStyle = '',
    } = reportData;

    // Build HTML
    let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 900px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    h1 { color: #0066cc; border-bottom: 3px solid #0066cc; padding-bottom: 10px; }
    h2 { color: #333; margin-top: 30px; }
    .metadata { background-color: #e8f4f8; padding: 10px; border-radius: 5px; font-size: 0.9em; }
    .section { background-color: white; padding: 20px; margin: 20px 0; border-radius: 5px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    ${cssStyle}
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="metadata">Generated: ${new Date().toISOString()}</div>
  ${content}
</body>
</html>`;

    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${title.replace(/\s+/g, '_')}_${timestamp}.html`;
    const filePath = path.join(uploadsDir, filename);

    fs.writeFileSync(filePath, html, 'utf-8');

    const fileSize = fs.statSync(filePath).size;

    // Record in database
    await addFile(goalId, filename, filePath, 'html', fileSize);

    console.log(`[FILE_AGENT] HTML report created: ${filename}`);

    return {
      filename,
      filepath: filePath,
      format: 'html',
      size: fileSize,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[FILE_AGENT ERROR] HTML report creation failed:', error.message);
    throw error;
  }
}

/**
 * Get file download info
 * @param {string} filename - Filename to retrieve
 * @returns {Object} - File info
 */
function getFileInfo(filename) {
  try {
    const filePath = path.join(uploadsDir, filename);

    if (!fs.existsSync(filePath)) {
      throw new Error('File not found');
    }

    const stats = fs.statSync(filePath);

    return {
      filename,
      path: filePath,
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
    };
  } catch (error) {
    console.error('[FILE_AGENT ERROR] Failed to get file info:', error.message);
    throw error;
  }
}

/**
 * List all files for a goal
 * @param {string} goalId - Goal ID
 * @returns {Promise<Array>} - Array of files
 */
async function listGoalFiles(goalId) {
  try {
    const { getFiles } = require('../db/sqlite');
    return await getFiles(goalId);
  } catch (error) {
    console.error('[FILE_AGENT ERROR] Failed to list files:', error.message);
    throw error;
  }
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  runFileAgent,
  createMarkdownReport,
  createJsonReport,
  createHtmlReport,
  getFileInfo,
  listGoalFiles,
  uploadsDir,
};
