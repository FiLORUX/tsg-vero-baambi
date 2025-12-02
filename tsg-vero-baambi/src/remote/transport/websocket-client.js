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
 * WEBSOCKET CLIENT WITH AUTOMATIC RECONNECTION
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Production-grade WebSocket wrapper providing:
 * - Automatic reconnection with exponential backoff
 * - Message queueing during disconnection
 * - Heartbeat/ping-pong for connection health monitoring
 * - Clean event-driven API
 *
 * USAGE
 * ─────
 *   const client = new WebSocketClient('ws://localhost:8080');
 *
 *   client.on('message', (data) => console.log('Received:', data));
 *   client.on('connected', () => console.log('Connected!'));
 *   client.on('disconnected', () => console.log('Disconnected'));
 *
 *   await client.connect();
 *   client.send({ type: 'metrics', payload: {...} });
 *
 * @module remote/transport/websocket-client
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  ConnectionState,
  ConnectionStateMachine,
  calculateReconnectDelay,
  shouldReconnect,
  DEFAULT_RECONNECT_CONFIG
} from './connection-state.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default client configuration.
 * @type {WebSocketClientConfig}
 */
const DEFAULT_CONFIG = Object.freeze({
  /** Timeout for initial connection (ms) */
  connectTimeout: 10000,

  /** Interval between heartbeat pings (ms) */
  heartbeatInterval: 30000,

  /** Timeout waiting for pong response (ms) */
  heartbeatTimeout: 5000,

  /** Maximum messages to queue whilst disconnected */
  maxQueueSize: 100,

  /** Automatically reconnect on disconnect */
  autoReconnect: true,

  /** Reconnection strategy configuration */
  reconnect: DEFAULT_RECONNECT_CONFIG
});

/**
 * @typedef {Object} WebSocketClientConfig
 * @property {number} connectTimeout - Connection timeout in milliseconds
 * @property {number} heartbeatInterval - Heartbeat interval in milliseconds
 * @property {number} heartbeatTimeout - Heartbeat timeout in milliseconds
 * @property {number} maxQueueSize - Maximum queued messages
 * @property {boolean} autoReconnect - Enable automatic reconnection
 * @property {import('./connection-state.js').ReconnectConfig} reconnect - Reconnect config
 */

// ─────────────────────────────────────────────────────────────────────────────
// WEBSOCKET CLIENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WebSocket client with automatic reconnection and message queueing.
 *
 * Provides a robust connection layer for real-time metrics streaming.
 * Handles network interruptions gracefully with configurable retry logic.
 *
 * @example
 * const client = new WebSocketClient('ws://broker.local:8765');
 *
 * client.on('message', (data) => {
 *   const packet = JSON.parse(data);
 *   updateMeters(packet);
 * });
 *
 * client.on('stateChange', (state) => {
 *   updateConnectionIndicator(state);
 * });
 *
 * await client.connect();
 */
export class WebSocketClient {
  /** @type {string} */
  #url;

  /** @type {WebSocketClientConfig} */
  #config;

  /** @type {WebSocket|null} */
  #socket = null;

  /** @type {ConnectionStateMachine} */
  #stateMachine;

  /** @type {Map<string, Set<function>>} */
  #eventListeners = new Map();

  /** @type {Array<string>} */
  #messageQueue = [];

  /** @type {number|null} */
  #heartbeatTimer = null;

  /** @type {number|null} */
  #heartbeatTimeoutTimer = null;

  /** @type {number|null} */
  #reconnectTimer = null;

  /** @type {number|null} */
  #connectTimeoutTimer = null;

  /** @type {boolean} */
  #intentionalClose = false;

  /**
   * Create a new WebSocket client.
   *
   * @param {string} url - WebSocket server URL (ws:// or wss://)
   * @param {Partial<WebSocketClientConfig>} [config] - Client configuration
   */
  constructor(url, config = {}) {
    this.#url = url;
    this.#config = { ...DEFAULT_CONFIG, ...config };
    this.#stateMachine = new ConnectionStateMachine();

    // Forward state changes as events
    this.#stateMachine.onStateChange((newState, oldState) => {
      this.#emit('stateChange', newState, oldState);

      if (newState === ConnectionState.CONNECTED) {
        this.#emit('connected');
      } else if (newState === ConnectionState.DISCONNECTED) {
        this.#emit('disconnected');
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get current connection state.
   * @returns {string} ConnectionState value
   */
  get state() {
    return this.#stateMachine.state;
  }

  /**
   * Check if connected and ready to send.
   * @returns {boolean}
   */
  get isConnected() {
    return this.#stateMachine.isConnected;
  }

  /**
   * Get server URL.
   * @returns {string}
   */
  get url() {
    return this.#url;
  }

  /**
   * Get number of queued messages.
   * @returns {number}
   */
  get queuedMessages() {
    return this.#messageQueue.length;
  }

  /**
   * Connect to WebSocket server.
   *
   * @returns {Promise<void>} Resolves when connected, rejects on failure
   * @throws {Error} If already connected or connection fails
   */
  connect() {
    return new Promise((resolve, reject) => {
      // Prevent duplicate connections
      if (this.#stateMachine.isConnected) {
        resolve();
        return;
      }

      if (this.#stateMachine.isConnecting) {
        reject(new Error('Connection already in progress'));
        return;
      }

      this.#intentionalClose = false;
      this.#stateMachine.transition(ConnectionState.CONNECTING);

      try {
        this.#socket = new WebSocket(this.#url);
        this.#socket.binaryType = 'blob';

        // Connection timeout
        this.#connectTimeoutTimer = window.setTimeout(() => {
          if (!this.#stateMachine.isConnected) {
            this.#socket?.close();
            reject(new Error(`Connection timeout after ${this.#config.connectTimeout}ms`));
          }
        }, this.#config.connectTimeout);

        this.#socket.onopen = () => {
          this.#clearConnectTimeout();
          this.#stateMachine.transition(ConnectionState.CONNECTED);
          this.#startHeartbeat();
          this.#flushQueue();
          resolve();
        };

        this.#socket.onclose = (event) => {
          this.#handleClose(event);
        };

        this.#socket.onerror = (event) => {
          this.#emit('error', event);
        };

        this.#socket.onmessage = (event) => {
          this.#handleMessage(event);
        };

      } catch (error) {
        this.#clearConnectTimeout();
        this.#stateMachine.transition(ConnectionState.DISCONNECTED);
        reject(error);
      }
    });
  }

  /**
   * Disconnect from server.
   *
   * @param {number} [code=1000] - WebSocket close code
   * @param {string} [reason='Client disconnect'] - Close reason
   */
  disconnect(code = 1000, reason = 'Client disconnect') {
    this.#intentionalClose = true;
    this.#clearAllTimers();
    this.#messageQueue = [];

    if (this.#socket) {
      this.#socket.close(code, reason);
      this.#socket = null;
    }

    this.#stateMachine.reset();
  }

  /**
   * Send a message to the server.
   *
   * If disconnected with autoReconnect enabled, messages are queued
   * and sent when connection is restored.
   *
   * @param {string|object} data - Message to send (objects are JSON-stringified)
   * @returns {boolean} True if sent immediately, false if queued
   */
  send(data) {
    const message = typeof data === 'string' ? data : JSON.stringify(data);

    if (this.#stateMachine.isConnected && this.#socket?.readyState === WebSocket.OPEN) {
      this.#socket.send(message);
      return true;
    }

    // Queue message if auto-reconnect is enabled
    if (this.#config.autoReconnect) {
      if (this.#messageQueue.length < this.#config.maxQueueSize) {
        this.#messageQueue.push(message);
      } else {
        console.warn('[WebSocket] Message queue full, dropping oldest message');
        this.#messageQueue.shift();
        this.#messageQueue.push(message);
      }
    }

    return false;
  }

  /**
   * Register an event listener.
   *
   * @param {'message'|'connected'|'disconnected'|'stateChange'|'error'} event - Event name
   * @param {function} callback - Event handler
   * @returns {function} Unsubscribe function
   */
  on(event, callback) {
    if (!this.#eventListeners.has(event)) {
      this.#eventListeners.set(event, new Set());
    }
    this.#eventListeners.get(event).add(callback);

    return () => {
      this.#eventListeners.get(event)?.delete(callback);
    };
  }

  /**
   * Remove an event listener.
   *
   * @param {string} event - Event name
   * @param {function} callback - Event handler to remove
   */
  off(event, callback) {
    this.#eventListeners.get(event)?.delete(callback);
  }

  /**
   * Update server URL (requires reconnect).
   *
   * @param {string} url - New WebSocket URL
   */
  setUrl(url) {
    const wasConnected = this.isConnected;
    if (wasConnected) {
      this.disconnect();
    }
    this.#url = url;
    if (wasConnected) {
      this.connect();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: MESSAGE HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle incoming WebSocket message.
   * @private
   */
  #handleMessage(event) {
    const data = event.data;

    // Handle heartbeat pong
    if (data === '__pong__') {
      this.#clearHeartbeatTimeout();
      return;
    }

    this.#emit('message', data);
  }

  /**
   * Handle WebSocket close event.
   * @private
   */
  #handleClose(event) {
    this.#clearAllTimers();

    const wasConnected = this.#stateMachine.isConnected;

    // Determine if we should reconnect
    if (!this.#intentionalClose && this.#config.autoReconnect) {
      this.#stateMachine.transition(ConnectionState.RECONNECTING);
      this.#scheduleReconnect();
    } else {
      this.#stateMachine.transition(ConnectionState.DISCONNECTED);
    }

    this.#emit('close', {
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean,
      wasConnected
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: RECONNECTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Schedule a reconnection attempt.
   * @private
   */
  #scheduleReconnect() {
    const attempt = this.#stateMachine.reconnectAttempts;

    if (!shouldReconnect(attempt, this.#config.reconnect)) {
      console.warn(`[WebSocket] Max reconnection attempts (${this.#config.reconnect.maxAttempts}) exceeded`);
      this.#stateMachine.transition(ConnectionState.DISCONNECTED);
      this.#emit('reconnectFailed');
      return;
    }

    const delay = calculateReconnectDelay(attempt, this.#config.reconnect);
    console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${attempt})`);

    this.#emit('reconnecting', { attempt, delay });

    this.#reconnectTimer = window.setTimeout(() => {
      this.#attemptReconnect();
    }, delay);
  }

  /**
   * Attempt to reconnect.
   * @private
   */
  async #attemptReconnect() {
    if (this.#intentionalClose) {
      return;
    }

    this.#stateMachine.transition(ConnectionState.CONNECTING);

    try {
      await this.connect();
    } catch (error) {
      // connect() handles state transitions on failure
      console.warn('[WebSocket] Reconnection failed:', error.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: HEARTBEAT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start heartbeat ping interval.
   * @private
   */
  #startHeartbeat() {
    this.#stopHeartbeat();

    this.#heartbeatTimer = window.setInterval(() => {
      this.#sendHeartbeat();
    }, this.#config.heartbeatInterval);
  }

  /**
   * Stop heartbeat ping interval.
   * @private
   */
  #stopHeartbeat() {
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
    this.#clearHeartbeatTimeout();
  }

  /**
   * Send heartbeat ping.
   * @private
   */
  #sendHeartbeat() {
    if (!this.#stateMachine.isConnected || this.#socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    this.#socket.send('__ping__');

    // Start timeout for pong response
    this.#heartbeatTimeoutTimer = window.setTimeout(() => {
      console.warn('[WebSocket] Heartbeat timeout, closing connection');
      this.#socket?.close(4000, 'Heartbeat timeout');
    }, this.#config.heartbeatTimeout);
  }

  /**
   * Clear heartbeat timeout.
   * @private
   */
  #clearHeartbeatTimeout() {
    if (this.#heartbeatTimeoutTimer) {
      clearTimeout(this.#heartbeatTimeoutTimer);
      this.#heartbeatTimeoutTimer = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: QUEUE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Flush queued messages after reconnection.
   * @private
   */
  #flushQueue() {
    if (this.#messageQueue.length === 0) {
      return;
    }

    console.log(`[WebSocket] Flushing ${this.#messageQueue.length} queued messages`);

    while (this.#messageQueue.length > 0 && this.isConnected) {
      const message = this.#messageQueue.shift();
      this.#socket?.send(message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Emit event to listeners.
   * @private
   */
  #emit(event, ...args) {
    const listeners = this.#eventListeners.get(event);
    if (!listeners) return;

    for (const callback of listeners) {
      try {
        callback(...args);
      } catch (error) {
        console.error(`[WebSocket] Event listener error (${event}):`, error);
      }
    }
  }

  /**
   * Clear connection timeout timer.
   * @private
   */
  #clearConnectTimeout() {
    if (this.#connectTimeoutTimer) {
      clearTimeout(this.#connectTimeoutTimer);
      this.#connectTimeoutTimer = null;
    }
  }

  /**
   * Clear all timers.
   * @private
   */
  #clearAllTimers() {
    this.#clearConnectTimeout();
    this.#stopHeartbeat();

    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export { ConnectionState };
