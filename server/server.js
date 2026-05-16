// ============================================
// ORIAN - Main Server Entry Point
// ============================================
// Purpose: Initialize Express, Socket.io, Redis, PostgreSQL
// and orchestrate the entire autonomous agent system

const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const dotenv = require('dotenv');
const cors = require('cors');

// Load environment variables
dotenv.config();

// Import custom modules
const { initializeDatabase } = require('./db/sqlite');
const { setupSocket } = require('./sockets/socket');
const goalRoutes = require('./routes/goal');
const taskRoutes = require('./routes/tasks');
const webhookRoutes = require('./routes/webhook');
const integrationsRoutes = require('./routes/integrations');
const authRoutes = require('./routes/auth');
const { initializeRedis } = require('./queues/taskQueue');
const { router: orianApiRoutes, initializeApiRoutes } = require('./src/routes/api');

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Initialize Socket.io
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// ============================================
// MIDDLEWARE SETUP
// ============================================

// Parse JSON requests
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Enable CORS for all routes
app.use(cors());

// Log all incoming requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ============================================
// SOCKET.IO SETUP
// ============================================

// Setup Socket.io event listeners and connections
setupSocket(io);

// Make io accessible to routes and agents
app.use((req, res, next) => {
  req.io = io;
  next();
});

// ============================================
// API ROUTES
// ============================================

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Worker statistics endpoint
app.get('/api/stats/worker', async (req, res) => {
  try {
    const { getWorkerStats } = require('./queues/worker');
    const stats = await getWorkerStats();
    res.json(stats);
  } catch (error) {
    console.error('[STATS ERROR]', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Queue statistics endpoint
app.get('/api/stats/queue', async (req, res) => {
  try {
    const { getTaskQueue } = require('./queues/taskQueue');
    const queue = getTaskQueue();

    const [
      waiting,
      active,
      completed,
      failed,
      delayed,
    ] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    res.json({
      waiting,
      active,
      completed,
      failed,
      delayed,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[QUEUE STATS ERROR]', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Mount API routes
app.use('/api', orianApiRoutes);
app.use('/', orianApiRoutes);
app.use('/api/goal', goalRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/', authRoutes);
app.use('/', integrationsRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message, err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    timestamp: new Date().toISOString(),
  });
});

// ============================================
// INITIALIZATION FUNCTION
// ============================================

/**
 * Initialize all system components before starting server
 */
async function initializeSystem() {
  try {
    console.log('\n========== ORIAN INITIALIZATION ==========\n');
    console.log('[BOOT] Queue reliability patch loaded');

    // 1. Initialize PostgreSQL database
    console.log('[DB] Initializing PostgreSQL database...');
    await initializeDatabase();
    await initializeApiRoutes();
    console.log('[DB] PostgreSQL database initialized successfully');

    // 2. Initialize Redis connection for BullMQ
    console.log('[REDIS] Connecting to Redis...');
    await initializeRedis();
    console.log('[REDIS] ✓ Redis connection established');

    // Reconcile goals that were saved to PostgreSQL but are missing from Redis.
    await requeuePendingGoals();

    // 3. Verify environment variables
    console.log('[ENV] Validating environment variables...');
    const requiredVars = ['GROQ_API_KEY', 'TAVILY_API_KEY', 'JWT_SECRET'];
    const missingVars = requiredVars.filter((v) => !process.env[v]);
    if (missingVars.length > 0) throw new Error(`Missing environment variables: ${missingVars.join(', ')}`);
    if (process.env.JWT_SECRET === 'change-this-to-a-long-random-secret') {
      throw new Error('JWT_SECRET is still set to the default insecure value. Set a strong secret in .env');
    }
    console.log('[ENV] ✓ All required environment variables present');

    // 4. Start the task worker
    console.log('[WORKER] Starting BullMQ task worker...');
    const { startWorker } = require('./queues/worker');
    const worker = await startWorker(io);
    console.log('[WORKER] ✓ Task worker started and listening for jobs');

    // 5. Log configuration
    const config = {
      port: process.env.PORT || 3000,
      nodeEnv: process.env.NODE_ENV || 'development',
      redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
      queueName: process.env.QUEUE_NAME || 'orian-autopilot-tasks',
      groqModel: process.env.GROQ_MODEL || 'mixtral-8x7b-32768',
    };

    console.log('[CONFIG] Server Configuration:');
    console.log(`  - Port: ${config.port}`);
    console.log(`  - Environment: ${config.nodeEnv}`);
    console.log(`  - Redis: ${config.redisUrl}`);
    console.log(`  - Queue: ${config.queueName}`);
    console.log(`  - Groq Model: ${config.groqModel}`);

    console.log('\n========== INITIALIZATION COMPLETE ==========\n');
  } catch (error) {
    console.error('[FATAL ERROR]', error && error.message ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Re-enqueue PostgreSQL goals that are still marked queued.
 * This protects against Redis jobs disappearing while the DB source of truth remains queued.
 */
async function requeuePendingGoals() {
  const { getTasksByStatus } = require('./db/sqlite');
  const { addTaskToQueue, getJobStatus } = require('./queues/taskQueue');
  const queuedGoals = await getTasksByStatus('queued');

  if (queuedGoals.length === 0) {
    console.log('[QUEUE] No pending PostgreSQL goals to reconcile');
    return;
  }

  console.log(`[QUEUE] Reconciling ${queuedGoals.length} queued PostgreSQL goal(s)...`);

  for (const queuedGoal of queuedGoals) {
    if (queuedGoal.status === 'cancelled') continue;
    const existingJob = await getJobStatus(queuedGoal.id);
    if (existingJob) {
      console.log(`[QUEUE] Goal ${queuedGoal.id} already has Redis job ${existingJob.jobId}`);
      continue;
    }
    await addTaskToQueue(queuedGoal.id, {
      goal: queuedGoal.goal,
      description: queuedGoal.description || '',
    });
    console.log(`[QUEUE] Re-enqueued queued goal: ${queuedGoal.id}`);
  }
}

// ============================================
// SERVER STARTUP
// ============================================

/**
 * Start the server after initialization
 */
async function startServer() {
  try {
    // Initialize all components
    await initializeSystem();

    // Get port from environment or use default
    const PORT = process.env.PORT || 3000;

    // Start listening
    server.listen(PORT, () => {
      console.log(`\n✓ ORIAN Server running on http://localhost:${PORT}`);
      console.log(`✓ Socket.io connected at ws://localhost:${PORT}`);
      console.log(`✓ Health check: http://localhost:${PORT}/health`);
      console.log(`✓ Worker stats: http://localhost:${PORT}/api/stats/worker`);
      console.log(`✓ Queue stats: http://localhost:${PORT}/api/stats/queue\n`);
    });
  } catch (error) {
    console.error('[FATAL ERROR] Failed to start server:', error.message);
    process.exit(1);
  }
}

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

/**
 * Handle graceful shutdown
 */
process.on('SIGTERM', async () => {
  console.log('[SHUTDOWN] SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('[SHUTDOWN] Server closed');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('[SHUTDOWN] Forced exit after timeout');
    process.exit(1);
  }, 10000);
});

process.on('SIGINT', async () => {
  console.log('[SHUTDOWN] SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('[SHUTDOWN] Server closed');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('[SHUTDOWN] Forced exit after timeout');
    process.exit(1);
  }, 10000);
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
  console.error('[UNCAUGHT EXCEPTION]', error.message, error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION]', reason);
  process.exit(1);
});

// ============================================
// START SERVER
// ============================================

// Only start if this is the main module (not imported)
if (require.main === module) {
  startServer();
}

// Export for testing
module.exports = { app, server, io };
