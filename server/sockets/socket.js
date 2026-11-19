// ============================================
// Socket.io Configuration & Event Handlers
// ============================================
// Purpose: Setup real-time bidirectional communication
// between server and frontend clients

const { getGoal, appendGoalActivity } = require('../db/sqlite');
const { getLogs } = require('../tools/logger');
const { verifyToken } = require('@clerk/express');

const activeClients = new Map();
// goalId -> recent agent activity, replayed to clients that subscribe late
const activityBuffer = new Map();
const ACTIVITY_BUFFER_LIMIT = 300;
let _io = null;

function getIO() {
  return _io;
}

/**
 * Setup Socket.io event listeners and handlers
 * @param {Object} io - Socket.io instance from server.js
 */
function setupSocket(io) {
  _io = io;

  // Authenticate every handshake with a Clerk session token
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      if (!token) return next(new Error('unauthorized'));
      const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
      if (!payload || !payload.sub) return next(new Error('unauthorized'));
      socket.userId = payload.sub;
      return next();
    } catch (_err) {
      return next(new Error('unauthorized'));
    }
  });

  // Main connection handler
  io.on('connection', (socket) => {
    const clientId = socket.id;
    console.log(`[SOCKET] Client connected: ${clientId}`);

    // Store client metadata
    activeClients.set(clientId, {
      id: clientId,
      connectedAt: new Date(),
      activeGoalId: null,
    });

    // ============================================
    // CONNECTION EVENTS
    // ============================================

    /**
     * When client identifies themselves with a goal ID
     */
    socket.on('subscribe_goal', async (goalId) => {
      try {
      const goal = typeof goalId === 'string' ? await getGoal(goalId) : null;
      if (!goal || goal.userId !== socket.userId) return;
      console.log(`[SOCKET] Client ${clientId} subscribed to goal: ${goalId}`);

      // Join a room named after the goal ID for broadcasting
      socket.join(`goal:${goalId}`);

      // Update client metadata
      const client = activeClients.get(clientId);
      if (client) {
        client.activeGoalId = goalId;
      }

      // Replay activity that happened before this client joined the room
      const buffered = activityBuffer.get(goalId) || goal.activity || [];
      buffered.forEach((event) => {
        socket.emit('agent_activity', event);
      });

      // Replay terminal state too: fast chats may finish before subscription.
      if (goal.status === 'completed' && goal.result) socket.emit('task_complete', { goalId, result: goal.result });
      if (goal.status === 'failed') socket.emit('task_error', { goalId, error: goal.result?.error || 'Task failed' });
      if (goal.status === 'cancelled') socket.emit('task_cancelled', { goalId });

      // Send acknowledgment
      socket.emit('subscribed', {
        goalId,
        clientId,
        timestamp: new Date().toISOString(),
      });
      } catch (error) { console.error('[SOCKET] Subscription failed:', error.message); }
    });

    /**
     * When client unsubscribes from a goal
     */
    socket.on('unsubscribe_goal', (goalId) => {
      console.log(`[SOCKET] Client ${clientId} unsubscribed from goal: ${goalId}`);
      socket.leave(`goal:${goalId}`);

      // Clear active goal
      const client = activeClients.get(clientId);
      if (client) {
        client.activeGoalId = null;
      }
    });

    /**
     * Ping/Pong for connection health check
     */
    socket.on('ping', () => {
      socket.emit('pong', {
        timestamp: new Date().toISOString(),
      });
    });

    /**
     * Request current logs for a goal
     */
    socket.on('request_logs', async (goalId) => {
      try {
        console.log(`[SOCKET] Client ${clientId} requesting logs for goal: ${goalId}`);
        const goal = await getGoal(goalId);
        if (!goal || goal.userId !== socket.userId) return;
        const logs = await getLogs(goalId);

        socket.emit('logs_response', {
          goalId,
          logs,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error(`[SOCKET ERROR] Failed to get logs:`, error.message);
        socket.emit('error', {
          message: 'Failed to fetch logs',
          error: error.message,
        });
      }
    });

    /**
     * Disconnect handler
     */
    socket.on('disconnect', () => {
      console.log(`[SOCKET] Client disconnected: ${clientId}`);
      activeClients.delete(clientId);
    });

    /**
     * Error handler
     */
    socket.on('error', (error) => {
      console.error(`[SOCKET ERROR] Client ${clientId}:`, error);
    });
  });

  console.log('[SOCKET] Socket.io initialized and listening for connections');
}

/**
 * Emit task progress update to all clients watching a goal
 * Called from the queue workers
 * @param {string} goalId - The goal being worked on
 * @param {Object} update - Update object with task details
 */
function recordActivity(goalId, event) {
  const buffered = activityBuffer.get(goalId) || [];
  buffered.push(event);
  if (buffered.length > ACTIVITY_BUFFER_LIMIT) buffered.shift();
  activityBuffer.set(goalId, buffered);
  appendGoalActivity(goalId, event).catch(error => console.error('[ACTIVITY]', error.message));
}

function emitTaskUpdate(io, goalId, update) {
  const agentByStage = { initialization: 'assistant', understanding: 'assistant', planning: 'planner', planning_complete: 'planner', routing: 'router', routing_complete: 'router', execution_complete: 'assistant', synthesis: 'file_agent', report_generated: 'file_agent', quality_review: 'critic', quality_complete: 'critic', summarization: 'summarizer' };
  const event = {
    id: require('crypto').randomUUID(), goalId, agent: update.agent || agentByStage[update.stage] || 'system',
    action: update.stage, data: { message: update.message, progress: update.progress, currentTask: update.currentTask },
    timestamp: new Date().toISOString(),
  };
  recordActivity(goalId, event);
  io?.to(`goal:${goalId}`).emit('agent_activity', event);
  io?.to(`goal:${goalId}`).emit('task_update', { goalId, ...update, timestamp: event.timestamp });
}

/**
 * Emit agent activity (used by individual agents)
 * @param {string} goalId - The goal being worked on
 * @param {string} agentName - Name of the agent (e.g., "planner", "web_agent")
 * @param {string} action - Action being performed
 * @param {Object} data - Additional data
 */
function emitAgentActivity(io, goalId, agentName, action, data = {}) {
  const event = { id: require('crypto').randomUUID(), goalId, agent: agentName, action, data, timestamp: new Date().toISOString() };
  recordActivity(goalId, event);
  io?.to(`goal:${goalId}`).emit('agent_activity', event);
}

/**
 * Emit error to all clients watching a goal
 * @param {string} goalId - The goal with error
 * @param {string} errorMessage - Error message
 * @param {Object} details - Additional error details
 */
function emitError(io, goalId, errorMessage, details = {}) {
  if (!io) return;

  console.error(`[SOCKET] Error for goal ${goalId}:`, errorMessage);

  io.to(`goal:${goalId}`).emit('task_error', {
    goalId,
    error: errorMessage,
    details,
    timestamp: new Date().toISOString(),
  });

  const cleanup = setTimeout(() => activityBuffer.delete(goalId), 60000);
  cleanup.unref?.();
}

/**
 * Emit task completion to clients
 * @param {string} goalId - Completed goal
 * @param {Object} result - Final result/report
 */
function emitTaskComplete(io, goalId, result) {
  if (!io) return;

  console.log(`[SOCKET] Task complete for goal ${goalId}`);

  io.to(`goal:${goalId}`).emit('task_complete', {
    goalId,
    result,
    timestamp: new Date().toISOString(),
  });

  const cleanup = setTimeout(() => activityBuffer.delete(goalId), 60000);
  cleanup.unref?.();
}

/**
 * Get active client count
 */
function getActiveClientCount() {
  return activeClients.size;
}

/**
 * Get all active clients for a specific goal
 * @param {string} goalId - The goal to check
 */
function getClientsForGoal(goalId) {
  const clients = [];
  activeClients.forEach((client) => {
    if (client.activeGoalId === goalId) {
      clients.push(client);
    }
  });
  return clients;
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  setupSocket,
  getIO,
  emitTaskUpdate,
  emitAgentActivity,
  emitError,
  emitTaskComplete,
  getActiveClientCount,
  getClientsForGoal,
};