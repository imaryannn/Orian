// ============================================
// Code Execution Agent
// ============================================
// Purpose: Write and execute code to solve tasks

const { codeFiles } = require('../lib/workspace');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { callLLMJson } = require('../tools/llm');
const { CODE_AGENT_SYSTEM_PROMPT, getCodeAgentPrompt } = require('../tools/prompts');
const { addTaskLog, addFile } = require('../db/sqlite');
const { emitAgentActivity } = require('../sockets/socket');

// Directory for temporary code files
const codesDir = path.join(__dirname, '../codes');
if (!fs.existsSync(codesDir)) {
  fs.mkdirSync(codesDir, { recursive: true });
  console.log(`[CODE_AGENT] Created codes directory: ${codesDir}`);
}

/**
 * Run the code execution agent
 * @param {string} goalId - Unique goal ID
 * @param {string} task - Task description
 * @param {Object} options - Configuration options
 * @param {Object} io - Socket.io instance
 * @returns {Promise<Object>} - Code and execution results
 */
async function runCodeAgent(goalId, task, options = {}, io = null) {
  try {
    const {
      language = 'javascript',
      constraints = '',
      execute = false,
    } = options;

    console.log(`[CODE_AGENT] Generating code for: "${task.slice(0, 180)}"`);

    // Emit activity
    emitAgentActivity(io, goalId, 'code_agent', 'generation_starting', {
      task,
      language,
    });

    // Log to database
    await addTaskLog(goalId, 'code_agent_start', `Code agent generating ${language} code`);

    // Generate code using LLM
    console.log('[CODE_AGENT] Calling LLM to generate code...');

    const codePrompt = getCodeAgentPrompt(task, constraints);

    const codeResponse = await callLLMJson(codePrompt, {
      maxTokens: 4096, temperature: 0.5, systemPrompt: CODE_AGENT_SYSTEM_PROMPT,
    });
    const files = codeFiles(codeResponse);
    codeResponse.code = codeResponse.code || files.map(file => file.content).join('\n\n');

    emitAgentActivity(io, goalId, 'code_agent', 'code_generated', { lines: codeResponse.code.split('\n').length });

    // Execute code if requested
    let executionResult = null;
    if (execute && codeResponse.language === 'javascript') {
      try {
        console.log('[CODE_AGENT] Executing code...');
        emitAgentActivity(io, goalId, 'code_agent', 'execution_starting', {});

        executionResult = await executeJavaScriptCode(codeResponse.code);

        console.log('[CODE_AGENT] Execution completed');
        emitAgentActivity(io, goalId, 'code_agent', 'execution_complete', {
          success: true,
        });
      } catch (execError) {
        console.error('[CODE_AGENT] Execution failed:', execError.message);
        executionResult = {
          success: false,
          error: execError.message,
          output: '',
        };

        emitAgentActivity(io, goalId, 'code_agent', 'execution_error', {
          error: execError.message,
        });
      }
    }

    const result = {
      files,
      entry: (files.some(file => file.path === codeResponse.entry) ? codeResponse.entry : null) || files.find(file => file.path.endsWith('.html'))?.path || files[0].path,
      language: codeResponse.language || language,
      code: codeResponse.code,
      description: codeResponse.description || 'Project files are ready in the workspace.',
      expectedOutput: codeResponse.expected_output || '',
      codeSize: Buffer.byteLength(codeResponse.code),
      execution: executionResult,
      timestamp: new Date().toISOString(),
    };

    await addTaskLog(goalId, 'code_agent_complete', 'Code execution complete', { language: codeResponse.language || language });

    return result;
  } catch (error) {
    console.error(`[CODE_AGENT ERROR] ${error.message}`);

    // Log error
    await addTaskLog(
      goalId,
      'code_agent_error',
      `Code agent failed: ${error.message}`
    );

    // Emit error
    emitAgentActivity(io, goalId, 'code_agent', 'error', {
      error: error.message,
    });

    throw error;
  }
}

/**
 * Execute JavaScript code safely
 * @param {string} code - JavaScript code to execute
 * @param {number} timeout - Execution timeout in ms
 * @returns {Promise<Object>} - Execution result
 */
async function executeJavaScriptCode(code, timeout = 10000) {
  return new Promise((resolve, reject) => {
    let tempFile = null;

    try {
      // Create temporary file
      tempFile = path.join(codesDir, `temp_${Date.now()}.js`);

      fs.writeFileSync(tempFile, code, 'utf-8');

      console.log('[CODE_AGENT] Executing Node.js code...');

      // Execute with timeout
      const output = execSync(`node "${tempFile}"`, {
        timeout,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      // Clean up
      fs.unlinkSync(tempFile);

      resolve({
        success: true,
        output: output.trim(),
        error: null,
      });
    } catch (error) {
      // Clean up temp file
      try {
        if (tempFile) fs.unlinkSync(tempFile);
      } catch (e) {
        // Ignore cleanup errors
      }

      reject({
        success: false,
        error: error.message,
        output: error.stdout?.toString() || '',
      });
    }
  });
}

/**
 * Get file extension based on language
 * @param {string} language - Programming language
 * @returns {string} - File extension
 */
function getFileExtension(language) {
  const extensions = {
    javascript: 'js',
    js: 'js',
    python: 'py',
    bash: 'sh',
    shell: 'sh',
  };

  return extensions[language.toLowerCase()] || 'txt';
}

/**
 * Write code to file without executing
 * @param {string} goalId - Goal ID
 * @param {string} code - Code content
 * @param {string} language - Language
 * @returns {Promise<string>} - File path
 */
async function saveCodeFile(goalId, code, language = 'javascript') {
  try {
    const timestamp = Date.now();
    const extension = getFileExtension(language);
    const filename = `${goalId}_${timestamp}.${extension}`;
    const filepath = path.join(codesDir, filename);

    fs.writeFileSync(filepath, code, 'utf-8');

    console.log(`[CODE_AGENT] Code file saved: ${filename}`);

    // Record in database
    await addFile(
      goalId,
      filename,
      filepath,
      `code_${language}`,
      Buffer.byteLength(code)
    );

    return filepath;
  } catch (error) {
    console.error('[CODE_AGENT ERROR] Failed to save code file:', error.message);
    throw error;
  }
}

/**
 * List generated code files for a goal
 * @param {string} goalId - Goal ID
 * @returns {Promise<Array>} - Code files
 */
async function listCodeFiles(goalId) {
  try {
    const files = fs.readdirSync(codesDir);
    return files.filter((f) => f.startsWith(goalId)).map((f) => ({
      filename: f,
      path: path.join(codesDir, f),
    }));
  } catch (error) {
    console.error('[CODE_AGENT ERROR] Failed to list code files:', error.message);
    throw error;
  }
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  runCodeAgent,
  executeJavaScriptCode,
  saveCodeFile,
  listCodeFiles,
  getFileExtension,
  codesDir,
};
