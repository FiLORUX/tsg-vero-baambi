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
 *     { type: 'controlAck', command, requestId?, success, value?, error? }
 *
 *   Client/Controller → Broker:
 *     { type: 'subscribe', probeId: 'uuid' }
 *     { type: 'unsubscribe', probeId: 'uuid' }
 *     { type: 'list' }
 *     { type: 'setTrim', probeId: 'uuid', trimDb: -6.0, inputMode?: 'browser'|'external' }
 *     { type: 'control', probeId: 'uuid', command: string, value?: any, requestId?: string }
 *
 *   Broker → Probe:
 *     { type: 'setTrim', trimDb: -6.0, inputMode?: 'browser'|'external' }
 *     { type: 'control', command: string, value?: any, requestId?: string }
 *
 *   Broker → Client:
 *     { type: 'metrics', probeId: 'uuid', payload: MetricsPacket }
 *     { type: 'probeList', probes: [...] }
 *     { type: 'probeOnline', probeId: 'uuid', name: '...' }
 *     { type: 'probeOffline', probeId: 'uuid' }
 *     { type: 'controlAck', probeId, command, requestId?, success, value?, error? }
 *
 *   Control Commands:
 *     setTrim, setTarget, setTruePeakLimit, setTruePeakMode, resetIntegration, getState
 *
 * @module broker/server
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import http from 'http';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { initRestApi, handleRequest, updateMetrics } from './rest-api.js';
// The origin allow-list lives in its own module so this upgrade gate and the REST
// API's CORS grant can never disagree about which origins are trusted.
import { getAllowedOrigins, isOriginAllowed } from './allowed-origins.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PORT = 8765;
const HEARTBEAT_INTERVAL = 30000;
const CLIENT_TIMEOUT = 35000;

// Rate limiting: max messages per second per socket
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_MESSAGES = 100;  // 100 msgs/sec (probe at 20Hz = 20 msgs/sec)

// Optional access control. Each guard is enforced only when its env var is set,
// so existing trusted-network deployments are unaffected. See SECURITY.md.
const CONTROL_TOKEN = process.env.VERO_CONTROL_TOKEN || '';
const MAX_PAYLOAD_BYTES = 512 * 1024;  // Bound per-message size (metrics are ~4 KB)

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ProbeCapabilities
 * @property {string} [format] - Payload format: 'standard-v1' or 'rich-v1'
 * @property {boolean} [visualization] - Supports goniometer/spectrum data
 * @property {boolean} [extendedStereo] - Supports width, rotation, M/S levels
 * @property {boolean} [rms] - Supports RMS metering
 */

/**
 * @typedef {Object} ProbeInfo
 * @property {string} id - Unique probe identifier
 * @property {string} name - Human-readable name
 * @property {string} [location] - Physical location
 * @property {WebSocket} socket - WebSocket connection
 * @property {number} lastSeen - Last metrics timestamp
 * @property {Set<WebSocket>} subscribers - Subscribed clients
 * @property {ProbeCapabilities} [capabilities] - Probe capabilities
 */

/** @type {Map<string, ProbeInfo>} */
const probes = new Map();

/** @type {Map<WebSocket, Set<string>>} */
const clientSubscriptions = new Map();

/** @type {Map<WebSocket, number>} */
const clientLastPong = new Map();

/**
 * Persistent probe names - survives disconnect/reconnect.
 * Key: probeId, Value: user-defined name
 * @type {Map<string, string>}
 */
const persistentProbeNames = new Map();

/**
 * Rate limiting state per socket.
 * Key: socket, Value: { count, windowStart }
 * @type {Map<WebSocket, {count: number, windowStart: number}>}
 */
const rateLimitState = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// SERVER SETUP
// ─────────────────────────────────────────────────────────────────────────────

const port = parseInt(process.env.BROKER_PORT || process.argv[2] || DEFAULT_PORT, 10);

// Shared HTTP server for REST API and WebSocket
const httpServer = http.createServer(handleRequest);

/**
 * Constant-time string comparison so token checks do not leak length/content
 * through response timing.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Gate WebSocket upgrades on the optional origin allow-list and access token.
 * With neither configured, every connection is accepted (unchanged behaviour).
 *
 * @param {{ origin?: string, req: http.IncomingMessage }} info
 * @returns {boolean}
 */
function verifyClient(info) {
  const { origin, req } = info;

  // An empty list leaves the upgrade open, preserving trusted-network deployments.
  // Note this differs from the REST API, where an empty list withholds the CORS
  // grant: a WebSocket upgrade is not subject to the same-origin policy, so there
  // is nothing to grant — only something to refuse.
  if (getAllowedOrigins().length > 0 && !isOriginAllowed(origin)) {
    console.warn(`[Broker] Rejected upgrade: origin ${origin || '(none)'} not in allow-list`);
    return false;
  }

  if (CONTROL_TOKEN) {
    let provided = '';
    try {
      provided = new URL(req.url, 'http://localhost').searchParams.get('token') || '';
    } catch {
      provided = '';
    }
    if (!provided) {
      const auth = req.headers['authorization'] || '';
      if (auth.startsWith('Bearer ')) provided = auth.slice(7);
    }
    if (!provided || !timingSafeEqualStr(provided, CONTROL_TOKEN)) {
      console.warn('[Broker] Rejected upgrade: missing or invalid access token');
      return false;
    }
  }

  return true;
}

// WebSocket server attached to HTTP server
const wss = new WebSocketServer({
  server: httpServer,
  perMessageDeflate: false, // Disable compression for low-latency
  maxPayload: MAX_PAYLOAD_BYTES, // Reject oversized frames (DoS guard)
  verifyClient
});

// Initialise REST API state
initRestApi({ probes });

// Start listening
httpServer.listen(port, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  VERO-BAAMBI Metrics Broker                                                   ║
║  TSG Suite – Broadcast Audio Metering                                         ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  HTTP + WebSocket:  http://localhost:${port.toString().padEnd(41)}║
║  Health check:      http://localhost:${port}/health`.padEnd(56) + `║
║  Press Ctrl+C to stop                                                         ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);
  const allowedOrigins = getAllowedOrigins();
  if (CONTROL_TOKEN) console.log('[Broker] Access-token authentication: ENABLED');
  if (allowedOrigins.length) console.log(`[Broker] Origin allow-list: ${allowedOrigins.join(', ')}`);
  if (!CONTROL_TOKEN && !allowedOrigins.length) {
    console.warn('[Broker] WARNING: no access token or origin allow-list configured — expose only on a trusted network.');
  }
  // Stated on every start because it is easy to assume the token gates everything:
  // it does not. CONTROL_TOKEN and the origin allow-list gate the WebSocket
  // upgrade only. /probes and /metrics stay readable by any client that can reach
  // the port, so the port itself must not be publicly routable.
  console.warn('[Broker] NOTE: the REST API (/health, /probes, /metrics) is unauthenticated — restrict access at the network or proxy layer.');
});

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
  // Handle heartbeat ping (bypass rate limit)
  if (data.toString() === '__ping__') {
    socket.send('__pong__');
    return;
  }

  // Rate limiting check
  const now = Date.now();
  let rateState = rateLimitState.get(socket);
  if (!rateState) {
    rateState = { count: 0, windowStart: now };
    rateLimitState.set(socket, rateState);
  }

  // Reset window if expired
  if (now - rateState.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateState.count = 0;
    rateState.windowStart = now;
  }

  rateState.count++;
  if (rateState.count > RATE_LIMIT_MAX_MESSAGES) {
    // Rate limited - silently drop (don't spam error messages)
    if (rateState.count === RATE_LIMIT_MAX_MESSAGES + 1) {
      console.warn(`[Broker] Rate limit exceeded for socket, dropping messages`);
    }
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
      console.log('[Broker] Client requested probe list');
      handleListProbes(socket);
      break;

    case 'setTrim':
      handleSetTrim(socket, message);
      break;

    case 'control':
      handleControl(socket, message);
      break;

    case 'controlAck':
      handleControlAck(socket, message);
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
  const { probeId, name, location, capabilities } = message;

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

  // Persist user-defined name (survives disconnect/reconnect)
  // Priority: new name > persisted name > fallback
  let resolvedName;
  if (name) {
    // New name provided - persist it
    persistentProbeNames.set(probeId, name);
    resolvedName = name;
  } else if (persistentProbeNames.has(probeId)) {
    // Use previously persisted name
    resolvedName = persistentProbeNames.get(probeId);
  } else {
    // Fallback to UUID prefix
    resolvedName = `Probe ${probeId.slice(0, 8)}`;
  }

  /** @type {ProbeInfo} */
  const probeInfo = {
    id: probeId,
    name: resolvedName,
    location: location || '',
    socket,
    lastSeen: Date.now(),
    subscribers: existing?.subscribers || new Set(),
    capabilities: capabilities || null
  };

  probes.set(probeId, probeInfo);

  const capsStr = capabilities
    ? Object.entries(capabilities).filter(([, v]) => v).map(([k]) => k).join(', ')
    : 'none';
  console.log(`[Broker] Probe registered: ${probeInfo.name} (${probeId}) [${capsStr}]`);

  // Notify all clients of new probe
  broadcastToClients({
    type: 'probeOnline',
    probeId,
    name: probeInfo.name,
    location: probeInfo.location,
    capabilities: probeInfo.capabilities
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

  let currentProbe = probeInfo;

  if (!currentProbe) {
    // Auto-register unregistered probe with persistent name support
    const payloadName = payload.probe.name;
    let resolvedName;
    if (payloadName) {
      persistentProbeNames.set(probeId, payloadName);
      resolvedName = payloadName;
    } else if (persistentProbeNames.has(probeId)) {
      resolvedName = persistentProbeNames.get(probeId);
    } else {
      resolvedName = `Probe ${probeId.slice(0, 8)}`;
    }

    currentProbe = {
      id: probeId,
      name: resolvedName,
      location: payload.probe.location || '',
      socket,
      lastSeen: Date.now(),
      subscribers: new Set(),
      capabilities: null
    };
    probes.set(probeId, currentProbe);
    console.log(`[Broker] Auto-registered probe: ${resolvedName} (${probeId})`);
  }

  currentProbe.lastSeen = Date.now();

  // Update REST API metrics store
  updateMetrics(probeId, payload);

  // Forward metrics to all subscribers
  if (currentProbe.subscribers.size > 0) {
    const outbound = JSON.stringify({
      type: 'metrics',
      probeId,
      payload
    });

    for (const subscriber of currentProbe.subscribers) {
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
 * Handle remote trim command from client.
 * Forwards the trim adjustment to the target probe.
 *
 * @param {WebSocket} socket - Client socket
 * @param {Object} message - Trim command message
 */
function handleSetTrim(socket, message) {
  const { probeId, trimDb, inputMode } = message;

  if (!probeId) {
    sendError(socket, 'Missing probeId for setTrim');
    return;
  }

  const probeInfo = probes.get(probeId);

  if (!probeInfo) {
    sendError(socket, `Probe not found: ${probeId}`);
    return;
  }

  if (probeInfo.socket.readyState !== 1) {
    sendError(socket, `Probe ${probeId} is not connected`);
    return;
  }

  // Forward trim command to probe
  const outbound = {
    type: 'setTrim',
    trimDb,
    inputMode: inputMode || null
  };

  probeInfo.socket.send(JSON.stringify(outbound));
  console.log(`[Broker] Forwarded setTrim to ${probeInfo.name}: ${trimDb} dB`);
}

/**
 * Handle generic control command from controller.
 * Forwards command to target probe and tracks controller for ack routing.
 *
 * @param {WebSocket} socket - Controller socket
 * @param {Object} message - Control message
 */
function handleControl(socket, message) {
  const { probeId, command, value, requestId } = message;

  if (!probeId) {
    sendError(socket, 'Missing probeId for control');
    return;
  }

  if (!command) {
    sendError(socket, 'Missing command for control');
    return;
  }

  const probeInfo = probes.get(probeId);

  if (!probeInfo) {
    // Send error as controlAck for consistency
    socket.send(JSON.stringify({
      type: 'controlAck',
      probeId,
      command,
      requestId,
      success: false,
      error: `Probe not found: ${probeId}`
    }));
    return;
  }

  if (probeInfo.socket.readyState !== 1) {
    socket.send(JSON.stringify({
      type: 'controlAck',
      probeId,
      command,
      requestId,
      success: false,
      error: `Probe ${probeId} is not connected`
    }));
    return;
  }

  // Track this controller for ack routing
  if (!probeInfo.controllers) {
    probeInfo.controllers = new Map();
  }
  if (requestId) {
    probeInfo.controllers.set(requestId, socket);
  }

  // Forward control command to probe
  probeInfo.socket.send(JSON.stringify({
    type: 'control',
    command,
    value,
    requestId
  }));

  console.log(`[Broker] Forwarded control '${command}' to ${probeInfo.name}`);
}

/**
 * Handle control acknowledgement from probe.
 * Routes ack back to the controller that issued the command.
 *
 * @param {WebSocket} socket - Probe socket
 * @param {Object} message - Ack message
 */
function handleControlAck(socket, message) {
  const { command, requestId, success, value, error } = message;

  // Find probe by socket
  let probeInfo = null;
  let probeId = null;
  for (const [id, info] of probes) {
    if (info.socket === socket) {
      probeInfo = info;
      probeId = id;
      break;
    }
  }

  if (!probeInfo) {
    console.warn('[Broker] Received controlAck from unknown probe');
    return;
  }

  // Build outbound ack
  const ack = {
    type: 'controlAck',
    probeId,
    command,
    requestId,
    success,
    value,
    error
  };

  // Route to specific controller if requestId exists
  if (requestId && probeInfo.controllers?.has(requestId)) {
    const controller = probeInfo.controllers.get(requestId);
    if (controller.readyState === 1) {
      controller.send(JSON.stringify(ack));
    }
    probeInfo.controllers.delete(requestId);
  } else {
    // Broadcast to all subscribers (for state updates without requestId)
    for (const subscriber of probeInfo.subscribers) {
      if (subscriber.readyState === 1) {
        subscriber.send(JSON.stringify(ack));
      }
    }
  }

  console.log(`[Broker] Routed controlAck '${command}' from ${probeInfo.name}: ${success ? 'OK' : error}`);
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
      subscriberCount: info.subscribers.size,
      capabilities: info.capabilities || null
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
  rateLimitState.delete(socket);
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

  // Close all WebSocket connections
  for (const client of wss.clients) {
    client.close(1001, 'Server shutting down');
  }

  // Close both servers
  wss.close(() => {
    console.log('[Broker] WebSocket server closed');
    restServer.close(() => {
      console.log('[Broker] REST API server closed');
      process.exit(0);
    });
  });
});

process.on('SIGTERM', () => {
  process.emit('SIGINT');
});
