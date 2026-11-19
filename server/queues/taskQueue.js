/**
 * server/queues/taskQueue.js
 * Purpose: Manage BullMQ queue and Redis connection for AutoPilot.
 */

const Redis = require('ioredis');
const { Queue } = require('bullmq');

const QUEUE_NAME = process.env.QUEUE_NAME || 'orian-autopilot-tasks';
let redisClient = null;
let taskQueue = null;

/**
 * Initialize Redis connection with Upstash-specific optimizations
 */
async function initializeRedis() {
  try {
    const redisUrl = process.env.REDIS_URL;
    
    if (!redisUrl) {
      throw new Error("REDIS_URL is missing in your .env file!");
    }

    console.log('[REDIS] Connecting to server...');

    // Redis Client Configuration
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
      keepAlive: 30000, // Sends a ping every 30s to keep connection alive
      connectTimeout: 20000,
      tls: redisUrl.startsWith('rediss://') ? {} : undefined,
    });

    // Connection Event Handlers
    redisClient.on('connect', () => {
      console.log('[REDIS] Connection established successfully');
    });

    redisClient.on('error', (err) => {
      // Log errors but avoid crashing if it's just a temporary reset
      if (err.code !== 'ECONNRESET') {
        console.error('[REDIS ERROR]', err.message);
      }
    });

    // Wait for the client to be ready before proceeding
    await new Promise((resolve, reject) => {
      redisClient.once('ready', () => {
        console.log('[REDIS] Client is ready');
        resolve();
      });
      redisClient.once('error', reject);
    });

    // Initialize the BullMQ Queue
    taskQueue = new Queue(QUEUE_NAME, {
      connection: redisClient,
      defaultJobOptions: {
        attempts: 1, // Never replay external writes automatically.
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true, // Keep Redis clean
        removeOnFail: false,    // Keep failed jobs for debugging
      },
    });

    console.log('[QUEUE] ✓ Task queue initialized');

    return { redisClient, taskQueue };
  } catch (error) {
    console.error('[FATAL REDIS ERROR]', error.message);
    throw error;
  }
}

/**
 * Returns the current Task Queue instance
 */
function getTaskQueue() {
  if (!taskQueue) {
    throw new Error('Task queue not initialized. Call initializeRedis first.');
  }
  return taskQueue;
}

/**
 * Returns the current Redis client
 */
function getRedisClient() {
  if (!redisClient) {
    throw new Error('Redis client not initialized.');
  }
  return redisClient;
}

/**
 * Adds a new goal to the queue for processing
 * @param {string} goalId - The unique ID for the goal
 * @param {object} goalData - The data containing goal and description
 */
async function addTaskToQueue(goalId, goalData) {
  try {
    const queue = getTaskQueue();

    const job = await queue.add(
      'execute-workflow',
      {
        goalId,
        goal: goalData.goal,
        description: goalData.description || '',
        userId: goalData.userId || null,
        context: (goalData.context || []).slice(-20),
        workspace: goalData.workspace || null,
        createdAt: new Date().toISOString(),
      },
      {
        jobId: goalId,
      }
    );

    const queuedJob = await queue.getJob(goalId);
    if (!queuedJob) {
      throw new Error(`Task ${goalId} was not found in Redis after enqueue`);
    }

    console.log(`[QUEUE] Task added successfully: ${goalId}`);
    return job;
  } catch (error) {
    console.error('[QUEUE ERROR] Failed to add task:', error.message);
    throw error;
  }
}

/**
 * Get the BullMQ status for a goal's queued job.
 * Jobs are stored with BullMQ's generated ID, so look up by goalId in job data.
 */
async function getJobStatus(goalId) {
  const queue = getTaskQueue();
  const directJob = await queue.getJob(goalId);

  if (directJob) {
    const state = await directJob.getState();
    return {
      jobId: directJob.id,
      state,
      progress: directJob.progress,
      attemptsMade: directJob.attemptsMade,
      failedReason: directJob.failedReason || null,
      data: directJob.data,
      returnvalue: directJob.returnvalue || null,
    };
  }

  const states = ['waiting', 'active', 'delayed', 'completed', 'failed'];

  for (const state of states) {
    const jobs = await queue.getJobs([state], 0, 100, false);
    const job = jobs.find((candidate) => candidate?.data?.goalId === goalId);

    if (job) {
      return {
        jobId: job.id,
        state,
        progress: job.progress,
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason || null,
        data: job.data,
        returnvalue: job.returnvalue || null,
      };
    }
  }

  return null;
}

module.exports = {
  QUEUE_NAME,
  initializeRedis,
  getTaskQueue,
  getRedisClient,
  addTaskToQueue,
  getJobStatus
};
