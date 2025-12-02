#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * TSG Suite – broadcast tools for alignment, metering, and signal verification
 * Maintained by David Thåst  ·  https://github.com/FiLORUX
 *
 * Built with the assumption that behaviour should be predictable,
 * output should be verifiable, and silence should mean silence
 *
 * david@thast.se  ·  +46 700 30 30 60
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * VERO-BAAMBI METRICS BROKER
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Lightweight WebSocket relay server for remote metering.
 *
 * ARCHITECTURE
 * ────────────
 *   Probes ──► Broker ──► Clients
 *
 *   - Probes send metrics packets
 *   - Broker routes packets to subscribed clients
 *   - No audio data, only computed metrics
 *   - No processing, pure relay
 *
 * USAGE
 * ─────
 *   node broker/server.js [port]
 *
 *   Default port: 8765
 *   Environment: BROKER_PORT=8765
 *
 * MESSAGE PROTOCOL
 * ────────────────
 *   Probe → Broker:
 *     { type: 'register', probeId: 'uuid', name: 'Studio A' }
 *     { type: 'metrics', payload: MetricsPacket }
 *
 *   Client → Broker:
 *     { type: 'subscribe', probeId: 'uuid' }
 *     { type: 'unsubscribe', probeId: 'uuid' }
 *     { type: 'list' }
 *
 *   Broker → Client:
 *     { type: 'metrics', probeId: 'uuid', payload: MetricsPacket }
 *     { type: 'probeList', probes: [...] }
 *     { type: 'probeOnline', probeId: 'uuid', name: '...' }
 *     { type: 'probeOffline', probeId: 'uuid' }
 *
 * @module broker/server
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { WebSocketServer } from 'ws';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PORT = 8765;
const HEARTBEAT_INTERVAL = 30000;
const CLIENT_TIMEOUT = 35000;

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ProbeInfo
 * @property {string} id - Unique probe identifier
 * @property {string} name - Human-readable name
 * @property {string} [location] - Physical location
 * @property {WebSocket} socket - WebSocket connection
 * @property {number} lastSeen - Last metrics timestamp
 * @property {Set<WebSocket>} subscribers - Subscribed clients
 */

/** @type {Map<string, ProbeInfo>} */
const probes = new Map();

/** @type {Map<WebSocket, Set<string>>} */
const clientSubscriptions = new Map();

/** @type {Map<WebSocket, number>} */
const clientLastPong = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// SERVER SETUP
// ─────────────────────────────────────────────────────────────────────────────

const port = parseInt(process.env.BROKER_PORT || process.argv[2] || DEFAULT_PORT, 10);

const wss = new WebSocketServer({
  port,
  perMessageDeflate: false // Disable compression for low-latency
});

console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  VERO-BAAMBI Metrics Broker                                                   ║
║  TSG Suite – Broadcast Audio Metering                                         ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  Listening on ws://localhost:${port.toString().padEnd(5)}                                         ║
║  Press Ctrl+C to stop                                                         ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTION HANDLING
// ─────────────────────────────────────────────────────────────────────────────

wss.on('connection', (socket, request) => {
  const clientIp = request.socket.remoteAddress;
  console.log(`[Broker] New connection from ${clientIp}`);

  clientLastPong.set(socket, Date.now());

  socket.on('message', (data) => {
    handleMessage(socket, data);
  });

  socket.on('close', () => {
    handleDisconnect(socket);
  });

  socket.on('error', (error) => {
    console.error(`[Broker] Socket error:`, error.message);
  });

  socket.on('pong', () => {
    clientLastPong.set(socket, Date.now());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGE HANDLING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle incoming WebSocket message.
 *
 * @param {WebSocket} socket - Client socket
 * @param {Buffer|string} data - Raw message data
 */
function handleMessage(socket, data) {
  // Handle heartbeat ping
  if (data.toString() === '__ping__') {
    socket.send('__pong__');
    return;
  }

  let message;
  try {
    message = JSON.parse(data.toString());
  } catch (error) {
    console.warn('[Broker] Invalid JSON received');
    sendError(socket, 'Invalid JSON');
    return;
  }

  const { type } = message;

  switch (type) {
    case 'register':
      handleProbeRegister(socket, message);
      break;

    case 'metrics':
      handleMetrics(socket, message);
      break;

    case 'subscribe':
      handleSubscribe(socket, message);
      break;

    case 'unsubscribe':
      handleUnsubscribe(socket, message);
      break;

    case 'list':
      handleListProbes(socket);
      break;

    default:
      console.warn(`[Broker] Unknown message type: ${type}`);
      sendError(socket, `Unknown message type: ${type}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PROBE HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle probe registration.
 *
 * @param {WebSocket} socket - Probe socket
 * @param {Object} message - Registration message
 */
function handleProbeRegister(socket, message) {
  const { probeId, name, location } = message;

  if (!probeId) {
    sendError(socket, 'Missing probeId');
    return;
  }

  // Check if probe already registered
  const existing = probes.get(probeId);
  if (existing && existing.socket !== socket) {
    console.warn(`[Broker] Probe ${probeId} reconnected (replacing old connection)`);
    existing.socket.close(4001, 'Replaced by new connection');
  }

  /** @type {ProbeInfo} */
  const probeInfo = {
    id: probeId,
    name: name || `Probe ${probeId.slice(0, 8)}`,
    location: location || '',
    socket,
    lastSeen: Date.now(),
    subscribers: existing?.subscribers || new Set()
  };

  probes.set(probeId, probeInfo);

  console.log(`[Broker] Probe registered: ${probeInfo.name} (${probeId})`);

  // Notify all clients of new probe
  broadcastToClients({
    type: 'probeOnline',
    probeId,
    name: probeInfo.name,
    location: probeInfo.location
  });

  // Confirm registration to probe
  socket.send(JSON.stringify({
    type: 'registered',
    probeId
  }));
}

/**
 * Handle incoming metrics from probe.
 *
 * @param {WebSocket} socket - Probe socket
 * @param {Object} message - Metrics message
 */
function handleMetrics(socket, message) {
  const { payload } = message;

  if (!payload?.probe?.id) {
    return; // Silently drop invalid metrics
  }

  const probeId = payload.probe.id;
  const probeInfo = probes.get(probeId);

  if (!probeInfo) {
    // Auto-register unregistered probe
    probes.set(probeId, {
      id: probeId,
      name: payload.probe.name || `Probe ${probeId.slice(0, 8)}`,
      location: payload.probe.location || '',
      socket,
      lastSeen: Date.now(),
      subscribers: new Set()
    });
    console.log(`[Broker] Auto-registered probe: ${probeId}`);
    return;
  }

  probeInfo.lastSeen = Date.now();

  // Forward metrics to all subscribers
  if (probeInfo.subscribers.size > 0) {
    const outbound = JSON.stringify({
      type: 'metrics',
      probeId,
      payload
    });

    for (const subscriber of probeInfo.subscribers) {
      if (subscriber.readyState === 1) { // WebSocket.OPEN
        subscriber.send(outbound);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle client subscription request.
 *
 * @param {WebSocket} socket - Client socket
 * @param {Object} message - Subscription message
 */
function handleSubscribe(socket, message) {
  const { probeId } = message;

  if (!probeId) {
    sendError(socket, 'Missing probeId');
    return;
  }

  const probeInfo = probes.get(probeId);

  if (!probeInfo) {
    sendError(socket, `Probe not found: ${probeId}`);
    return;
  }

  // Add subscriber
  probeInfo.subscribers.add(socket);

  // Track client subscriptions
  if (!clientSubscriptions.has(socket)) {
    clientSubscriptions.set(socket, new Set());
  }
  clientSubscriptions.get(socket).add(probeId);

  console.log(`[Broker] Client subscribed to ${probeInfo.name}`);

  socket.send(JSON.stringify({
    type: 'subscribed',
    probeId,
    probeName: probeInfo.name
  }));
}

/**
 * Handle client unsubscription request.
 *
 * @param {WebSocket} socket - Client socket
 * @param {Object} message - Unsubscription message
 */
function handleUnsubscribe(socket, message) {
  const { probeId } = message;

  const probeInfo = probes.get(probeId);
  if (probeInfo) {
    probeInfo.subscribers.delete(socket);
  }

  clientSubscriptions.get(socket)?.delete(probeId);

  console.log(`[Broker] Client unsubscribed from ${probeId}`);

  socket.send(JSON.stringify({
    type: 'unsubscribed',
    probeId
  }));
}

/**
 * Handle probe list request.
 *
 * @param {WebSocket} socket - Client socket
 */
function handleListProbes(socket) {
  const probeList = [];

  for (const [id, info] of probes) {
    probeList.push({
      id,
      name: info.name,
      location: info.location,
      lastSeen: info.lastSeen,
      subscriberCount: info.subscribers.size
    });
  }

  socket.send(JSON.stringify({
    type: 'probeList',
    probes: probeList
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// DISCONNECT HANDLING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle socket disconnection.
 *
 * @param {WebSocket} socket - Disconnected socket
 */
function handleDisconnect(socket) {
  // Check if this was a probe
  for (const [probeId, info] of probes) {
    if (info.socket === socket) {
      console.log(`[Broker] Probe disconnected: ${info.name} (${probeId})`);

      // Notify subscribers
      for (const subscriber of info.subscribers) {
        if (subscriber.readyState === 1) {
          subscriber.send(JSON.stringify({
            type: 'probeOffline',
            probeId
          }));
        }
      }

      probes.delete(probeId);

      // Broadcast to all clients
      broadcastToClients({
        type: 'probeOffline',
        probeId
      });

      return;
    }
  }

  // This was a client – clean up subscriptions
  const subscriptions = clientSubscriptions.get(socket);
  if (subscriptions) {
    for (const probeId of subscriptions) {
      probes.get(probeId)?.subscribers.delete(socket);
    }
    clientSubscriptions.delete(socket);
    console.log('[Broker] Client disconnected');
  }

  clientLastPong.delete(socket);
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send error message to client.
 *
 * @param {WebSocket} socket - Client socket
 * @param {string} message - Error message
 */
function sendError(socket, message) {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify({
      type: 'error',
      message
    }));
  }
}

/**
 * Broadcast message to all connected clients.
 *
 * @param {Object} message - Message to broadcast
 */
function broadcastToClients(message) {
  const data = JSON.stringify(message);

  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(data);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HEARTBEAT / CLEANUP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Periodic heartbeat and stale connection cleanup.
 */
const heartbeatInterval = setInterval(() => {
  const now = Date.now();

  for (const client of wss.clients) {
    // Check for stale connections
    const lastPong = clientLastPong.get(client) || 0;
    if (now - lastPong > CLIENT_TIMEOUT) {
      console.log('[Broker] Terminating stale connection');
      client.terminate();
      continue;
    }

    // Send ping
    if (client.readyState === 1) {
      client.ping();
    }
  }

  // Log stats periodically
  console.log(`[Broker] Stats: ${probes.size} probes, ${wss.clients.size} connections`);

}, HEARTBEAT_INTERVAL);

// ─────────────────────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────────────────────────────────────

process.on('SIGINT', () => {
  console.log('\n[Broker] Shutting down...');

  clearInterval(heartbeatInterval);

  // Close all connections
  for (const client of wss.clients) {
    client.close(1001, 'Server shutting down');
  }

  wss.close(() => {
    console.log('[Broker] Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  process.emit('SIGINT');
});
