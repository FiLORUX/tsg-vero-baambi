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
 * PROBE SENDER
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Orchestrates metrics collection and transmission to the broker.
 *
 * Combines MetricsCollector with WebSocketClient to provide a complete
 * probe implementation. Handles connection lifecycle, automatic reconnection,
 * and rate-limited metrics transmission.
 *
 * OPERATING MODES
 * ───────────────
 * - DISABLED: No remote activity, zero overhead
 * - CONNECTING: Attempting broker connection
 * - STREAMING: Actively sending metrics
 * - RECONNECTING: Connection lost, attempting recovery
 *
 * The sender ensures local metering continues unaffected regardless of
 * remote connection state – remote features are strictly additive.
 *
 * @module remote/probe/probe-sender
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { WebSocketClient, ConnectionState } from '../transport/index.js';
import { MetricsCollector } from './metrics-collector.js';
import { DEFAULT_UPDATE_RATE, serializeMetrics } from '../types.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default broker URL for local development.
 * @type {string}
 */
const DEFAULT_BROKER_URL = 'ws://localhost:8765';

/**
 * LocalStorage key for broker URL persistence.
 * @type {string}
 */
const STORAGE_KEY_BROKER_URL = 'vero-baambi-broker-url';

/**
 * LocalStorage key for probe name persistence.
 * @type {string}
 */
const STORAGE_KEY_PROBE_NAME = 'vero-baambi-probe-name';

// ─────────────────────────────────────────────────────────────────────────────
// PROBE SENDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete probe implementation for remote metering.
 *
 * Integrates metrics collection with WebSocket transmission, providing
 * a simple API for enabling/disabling remote streaming.
 *
 * @example
 * const probe = new ProbeSender({
 *   name: 'Studio A',
 *   brokerUrl: 'ws://broker.local:8765'
 * });
 *
 * // Connect meter sources
 * probe.collector.setSources({
 *   lufsMeter,
 *   truePeakMeter,
 *   ppmMeter
 * });
 *
 * // Start streaming
 * await probe.start();
 *
 * // Later...
 * probe.stop();
 */
export class ProbeSender {
  /** @type {MetricsCollector} */
  #collector;

  /** @type {WebSocketClient|null} */
  #client = null;

  /** @type {string} */
  #brokerUrl;

  /** @type {number} */
  #updateRate;

  /** @type {number|null} */
  #sendInterval = null;

  /** @type {boolean} */
  #isEnabled = false;

  /** @type {Set<function(string): void>} */
  #statusListeners = new Set();

  /**
   * Create a new probe sender.
   *
   * @param {Object} [config] - Configuration options
   * @param {string} [config.name] - Probe name
   * @param {string} [config.location] - Physical location
   * @param {string} [config.brokerUrl] - Broker WebSocket URL
   * @param {number} [config.updateRate] - Updates per second (1-30)
   */
  constructor(config = {}) {
    // Load persisted settings
    const storedUrl = this.#loadSetting(STORAGE_KEY_BROKER_URL);
    const storedName = this.#loadSetting(STORAGE_KEY_PROBE_NAME);

    this.#brokerUrl = config.brokerUrl || storedUrl || DEFAULT_BROKER_URL;
    this.#updateRate = Math.min(30, Math.max(1, config.updateRate || DEFAULT_UPDATE_RATE));

    this.#collector = new MetricsCollector({
      name: config.name || storedName || undefined,
      location: config.location
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get metrics collector for source configuration.
   * @returns {MetricsCollector}
   */
  get collector() {
    return this.#collector;
  }

  /**
   * Get probe identifier.
   * @returns {string}
   */
  get probeId() {
    return this.#collector.probeId;
  }

  /**
   * Get/set probe name.
   * @type {string}
   */
  get probeName() {
    return this.#collector.probeName;
  }

  set probeName(name) {
    this.#collector.probeName = name;
    this.#saveSetting(STORAGE_KEY_PROBE_NAME, name);
  }

  /**
   * Get/set broker URL.
   * @type {string}
   */
  get brokerUrl() {
    return this.#brokerUrl;
  }

  set brokerUrl(url) {
    this.#brokerUrl = url;
    this.#saveSetting(STORAGE_KEY_BROKER_URL, url);

    // Update client if connected
    if (this.#client) {
      this.#client.setUrl(url);
    }
  }

  /**
   * Get/set update rate (Hz).
   * @type {number}
   */
  get updateRate() {
    return this.#updateRate;
  }

  set updateRate(rate) {
    this.#updateRate = Math.min(30, Math.max(1, rate));

    // Restart interval if running
    if (this.#sendInterval) {
      this.#stopSendLoop();
      this.#startSendLoop();
    }
  }

  /**
   * Check if probe is currently enabled.
   * @returns {boolean}
   */
  get isEnabled() {
    return this.#isEnabled;
  }

  /**
   * Check if currently connected to broker.
   * @returns {boolean}
   */
  get isConnected() {
    return this.#client?.isConnected || false;
  }

  /**
   * Get current connection state.
   * @returns {string} ConnectionState value
   */
  get connectionState() {
    return this.#client?.state || ConnectionState.DISCONNECTED;
  }

  /**
   * Start probe and connect to broker.
   *
   * @returns {Promise<void>} Resolves when connected
   * @throws {Error} If connection fails after retries
   */
  async start() {
    if (this.#isEnabled) {
      return; // Already running
    }

    this.#isEnabled = true;
    this.#notifyStatus('connecting');

    // Create client if needed
    if (!this.#client) {
      this.#client = new WebSocketClient(this.#brokerUrl, {
        autoReconnect: true
      });

      this.#setupClientListeners();
    }

    try {
      await this.#client.connect();
      this.#registerWithBroker();
      this.#startSendLoop();
      this.#notifyStatus('streaming');
    } catch (error) {
      console.error('[ProbeSender] Connection failed:', error.message);
      this.#notifyStatus('error');
      throw error;
    }
  }

  /**
   * Stop probe and disconnect from broker.
   */
  stop() {
    this.#isEnabled = false;
    this.#stopSendLoop();

    if (this.#client) {
      this.#client.disconnect();
    }

    this.#notifyStatus('disabled');
  }

  /**
   * Toggle probe enabled state.
   *
   * @returns {Promise<boolean>} New enabled state
   */
  async toggle() {
    if (this.#isEnabled) {
      this.stop();
      return false;
    }
      await this.start();
      return true;

  }

  /**
   * Register status change listener.
   *
   * @param {function(string): void} callback - Status callback
   * @returns {function(): void} Unsubscribe function
   */
  onStatusChange(callback) {
    this.#statusListeners.add(callback);
    return () => this.#statusListeners.delete(callback);
  }

  /**
   * Clean up resources.
   */
  dispose() {
    this.stop();
    this.#client = null;
    this.#statusListeners.clear();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: CONNECTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Set up WebSocket client event listeners.
   * @private
   */
  #setupClientListeners() {
    this.#client.on('connected', () => {
      console.log('[ProbeSender] Connected to broker');
      this.#registerWithBroker();
      this.#collector.resetSequence();
      this.#startSendLoop();
      this.#notifyStatus('streaming');
    });

    this.#client.on('disconnected', () => {
      console.log('[ProbeSender] Disconnected from broker');
      this.#stopSendLoop();

      if (this.#isEnabled) {
        this.#notifyStatus('reconnecting');
      } else {
        this.#notifyStatus('disabled');
      }
    });

    this.#client.on('reconnecting', ({ attempt, delay }) => {
      console.log(`[ProbeSender] Reconnecting (attempt ${attempt}, delay ${delay}ms)`);
      this.#notifyStatus('reconnecting');
    });

    this.#client.on('reconnectFailed', () => {
      console.error('[ProbeSender] Reconnection failed – giving up');
      this.#notifyStatus('error');
    });

    this.#client.on('error', (event) => {
      console.error('[ProbeSender] WebSocket error:', event);
    });
  }

  /**
   * Register probe with broker.
   * @private
   */
  #registerWithBroker() {
    if (!this.#client?.isConnected) return;

    this.#client.send({
      type: 'register',
      probeId: this.#collector.probeId,
      name: this.#collector.probeName,
      location: this.#collector.probeLocation
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: METRICS TRANSMISSION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start metrics send loop.
   * @private
   */
  #startSendLoop() {
    if (this.#sendInterval) return;

    const intervalMs = Math.round(1000 / this.#updateRate);

    this.#sendInterval = window.setInterval(() => {
      this.#sendMetrics();
    }, intervalMs);
  }

  /**
   * Stop metrics send loop.
   * @private
   */
  #stopSendLoop() {
    if (this.#sendInterval) {
      clearInterval(this.#sendInterval);
      this.#sendInterval = null;
    }
  }

  /**
   * Collect and send current metrics.
   * @private
   */
  #sendMetrics() {
    if (!this.#client?.isConnected) return;

    const packet = this.#collector.collect();

    this.#client.send({
      type: 'metrics',
      payload: packet
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Notify status listeners.
   * @private
   */
  #notifyStatus(status) {
    for (const listener of this.#statusListeners) {
      try {
        listener(status);
      } catch (error) {
        console.error('[ProbeSender] Status listener error:', error);
      }
    }
  }

  /**
   * Load setting from localStorage.
   * @private
   */
  #loadSetting(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null; // localStorage unavailable
    }
  }

  /**
   * Save setting to localStorage.
   * @private
   */
  #saveSetting(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // localStorage unavailable – ignore
    }
  }
}
