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
 * CONNECTION STATE MACHINE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Finite state machine for WebSocket connection lifecycle. Provides predictable
 * state transitions and prevents invalid operations (e.g., sending whilst
 * disconnected).
 *
 * STATE DIAGRAM
 * ─────────────
 *
 *   ┌──────────────┐
 *   │ DISCONNECTED │ ◄─────────────────────────────────────┐
 *   └──────┬───────┘                                       │
 *          │ connect()                                     │
 *          ▼                                               │
 *   ┌──────────────┐                                       │
 *   │  CONNECTING  │ ─────────────────────────────────────►│
 *   └──────┬───────┘  error / timeout                      │
 *          │ onopen                                        │
 *          ▼                                               │
 *   ┌──────────────┐                                       │
 *   │  CONNECTED   │ ─────────────────────────────────────►│
 *   └──────┬───────┘  onclose / onerror                    │
 *          │ disconnect() or error                         │
 *          ▼                                               │
 *   ┌──────────────┐                                       │
 *   │ RECONNECTING │ ─────────────────────────────────────►┘
 *   └──────────────┘  max retries exceeded
 *
 * @module remote/transport/connection-state
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTION STATES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Connection state enumeration.
 * @readonly
 * @enum {string}
 */
export const ConnectionState = Object.freeze({
  /** No active connection, not attempting to connect */
  DISCONNECTED: 'disconnected',

  /** Attempting to establish connection */
  CONNECTING: 'connecting',

  /** Connection established and ready for messages */
  CONNECTED: 'connected',

  /** Connection lost, attempting automatic reconnection */
  RECONNECTING: 'reconnecting'
});

// ─────────────────────────────────────────────────────────────────────────────
// STATE MACHINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valid state transitions matrix.
 * Each key maps to an array of valid destination states.
 *
 * @type {Record<string, string[]>}
 */
const VALID_TRANSITIONS = {
  [ConnectionState.DISCONNECTED]: [ConnectionState.CONNECTING],
  [ConnectionState.CONNECTING]: [ConnectionState.CONNECTED, ConnectionState.RECONNECTING, ConnectionState.DISCONNECTED],
  [ConnectionState.CONNECTED]: [ConnectionState.RECONNECTING, ConnectionState.DISCONNECTED],
  [ConnectionState.RECONNECTING]: [ConnectionState.CONNECTING, ConnectionState.DISCONNECTED]
};

/**
 * Connection state machine with event emission.
 *
 * Enforces valid state transitions and notifies listeners of changes.
 * Thread-safe for single-threaded JavaScript execution.
 *
 * @example
 * const machine = new ConnectionStateMachine();
 *
 * machine.onStateChange((newState, oldState) => {
 *   console.log(`Connection: ${oldState} → ${newState}`);
 * });
 *
 * machine.transition(ConnectionState.CONNECTING);
 * machine.transition(ConnectionState.CONNECTED);
 */
export class ConnectionStateMachine {
  /** @type {string} */
  #state = ConnectionState.DISCONNECTED;

  /** @type {Set<function(string, string): void>} */
  #listeners = new Set();

  /** @type {number} */
  #reconnectAttempts = 0;

  /** @type {number} */
  #lastStateChangeTime = 0;

  /**
   * Get current connection state.
   * @returns {string}
   */
  get state() {
    return this.#state;
  }

  /**
   * Check if currently connected and ready.
   * @returns {boolean}
   */
  get isConnected() {
    return this.#state === ConnectionState.CONNECTED;
  }

  /**
   * Check if connection is in progress (connecting or reconnecting).
   * @returns {boolean}
   */
  get isConnecting() {
    return this.#state === ConnectionState.CONNECTING ||
           this.#state === ConnectionState.RECONNECTING;
  }

  /**
   * Check if fully disconnected (not connecting).
   * @returns {boolean}
   */
  get isDisconnected() {
    return this.#state === ConnectionState.DISCONNECTED;
  }

  /**
   * Get current reconnection attempt count.
   * @returns {number}
   */
  get reconnectAttempts() {
    return this.#reconnectAttempts;
  }

  /**
   * Get time spent in current state (milliseconds).
   * @returns {number}
   */
  get timeInState() {
    return Date.now() - this.#lastStateChangeTime;
  }

  /**
   * Attempt to transition to a new state.
   *
   * @param {string} newState - Target state from ConnectionState enum
   * @returns {boolean} True if transition succeeded, false if invalid
   * @throws {Error} If newState is not a valid ConnectionState value
   */
  transition(newState) {
    // Validate new state is a known value
    if (!Object.values(ConnectionState).includes(newState)) {
      throw new Error(`Invalid connection state: ${newState}`);
    }

    // Check if transition is valid
    const validTargets = VALID_TRANSITIONS[this.#state];
    if (!validTargets.includes(newState)) {
      console.warn(
        `[ConnectionState] Invalid transition: ${this.#state} → ${newState}. ` +
        `Valid targets: [${validTargets.join(', ')}]`
      );
      return false;
    }

    const oldState = this.#state;
    this.#state = newState;
    this.#lastStateChangeTime = Date.now();

    // Track reconnection attempts
    if (newState === ConnectionState.RECONNECTING) {
      this.#reconnectAttempts++;
    } else if (newState === ConnectionState.CONNECTED) {
      this.#reconnectAttempts = 0;
    }

    // Notify listeners
    this.#notifyListeners(newState, oldState);

    return true;
  }

  /**
   * Force reset to disconnected state.
   * Use sparingly – primarily for cleanup or error recovery.
   */
  reset() {
    const oldState = this.#state;
    this.#state = ConnectionState.DISCONNECTED;
    this.#reconnectAttempts = 0;
    this.#lastStateChangeTime = Date.now();

    if (oldState !== ConnectionState.DISCONNECTED) {
      this.#notifyListeners(ConnectionState.DISCONNECTED, oldState);
    }
  }

  /**
   * Register a state change listener.
   *
   * @param {function(string, string): void} callback - Called with (newState, oldState)
   * @returns {function(): void} Unsubscribe function
   */
  onStateChange(callback) {
    this.#listeners.add(callback);
    return () => this.#listeners.delete(callback);
  }

  /**
   * Notify all listeners of state change.
   * @private
   */
  #notifyListeners(newState, oldState) {
    for (const listener of this.#listeners) {
      try {
        listener(newState, oldState);
      } catch (error) {
        console.error('[ConnectionState] Listener error:', error);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RECONNECTION STRATEGY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default reconnection configuration.
 * @type {ReconnectConfig}
 */
export const DEFAULT_RECONNECT_CONFIG = Object.freeze({
  /** Initial delay before first reconnection attempt (ms) */
  initialDelay: 1000,

  /** Maximum delay between reconnection attempts (ms) */
  maxDelay: 30000,

  /** Exponential backoff multiplier */
  backoffMultiplier: 1.5,

  /** Maximum number of reconnection attempts (0 = infinite) */
  maxAttempts: 10,

  /** Add random jitter to prevent thundering herd (0-1) */
  jitterFactor: 0.2
});

/**
 * @typedef {Object} ReconnectConfig
 * @property {number} initialDelay - Initial delay in milliseconds
 * @property {number} maxDelay - Maximum delay in milliseconds
 * @property {number} backoffMultiplier - Exponential backoff factor
 * @property {number} maxAttempts - Maximum attempts (0 = infinite)
 * @property {number} jitterFactor - Random jitter factor (0-1)
 */

/**
 * Calculate delay for next reconnection attempt.
 *
 * Uses exponential backoff with jitter to prevent thundering herd
 * when multiple clients reconnect simultaneously.
 *
 * @param {number} attemptNumber - Current attempt (1-based)
 * @param {ReconnectConfig} [config] - Reconnection configuration
 * @returns {number} Delay in milliseconds
 *
 * @example
 * // Attempt 1: ~1000ms, Attempt 2: ~1500ms, Attempt 3: ~2250ms...
 * const delay = calculateReconnectDelay(attempt);
 * setTimeout(reconnect, delay);
 */
export function calculateReconnectDelay(attemptNumber, config = DEFAULT_RECONNECT_CONFIG) {
  const {
    initialDelay,
    maxDelay,
    backoffMultiplier,
    jitterFactor
  } = config;

  // Calculate base delay with exponential backoff
  const exponentialDelay = initialDelay * Math.pow(backoffMultiplier, attemptNumber - 1);

  // Cap at maximum delay
  const cappedDelay = Math.min(exponentialDelay, maxDelay);

  // Add random jitter
  const jitter = cappedDelay * jitterFactor * (Math.random() - 0.5) * 2;

  return Math.round(cappedDelay + jitter);
}

/**
 * Check if reconnection should continue.
 *
 * @param {number} attemptNumber - Current attempt number
 * @param {ReconnectConfig} [config] - Reconnection configuration
 * @returns {boolean} True if should attempt reconnection
 */
export function shouldReconnect(attemptNumber, config = DEFAULT_RECONNECT_CONFIG) {
  if (config.maxAttempts === 0) {
    return true; // Infinite retries
  }
  return attemptNumber <= config.maxAttempts;
}
