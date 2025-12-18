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
 * METRICS RECEIVER
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Client-side receiver for remote metering data. Connects to the broker,
 * subscribes to probes, and provides metrics to the display layer.
 *
 * OPERATING MODES
 * ───────────────
 * When in client mode, the application displays remote metrics instead of
 * local audio. This allows VERO-BAAMBI to function as a remote meter display
 * for monitoring audio from another location.
 *
 * SEAMLESS FALLBACK
 * ─────────────────
 * The receiver is designed to have zero impact when not in use. Local metering
 * continues to work identically whether or not the remote module is loaded.
 * If the broker is unavailable, the application gracefully falls back to
 * local-only operation.
 *
 * @module remote/client/metrics-receiver
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { WebSocketClient, ConnectionState } from '../transport/index.js';
import {
  deserializeMetrics,
  createEmptyLUFS,
  createEmptyTruePeak,
  createEmptyPPM,
  createEmptyStereo
} from '../types.js';

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
const STORAGE_KEY_BROKER_URL = 'vero-baambi-client-broker-url';

/**
 * Time after which a probe is considered stale (no metrics received).
 * @type {number}
 */
const PROBE_STALE_TIMEOUT_MS = 5000;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ProbeInfo
 * @property {string} id - Unique probe identifier
 * @property {string} name - Human-readable name
 * @property {string} [location] - Physical location
 * @property {number} lastSeen - Last metrics timestamp
 * @property {boolean} isOnline - Whether probe is currently online
 * @property {number} subscriberCount - Number of subscribers (from broker)
 */

/**
 * @typedef {Object} RemoteMetrics
 * @property {import('../types.js').LUFSMetrics} lufs
 * @property {import('../types.js').TruePeakMetrics} truePeak
 * @property {import('../types.js').PPMMetrics} ppm
 * @property {import('../types.js').StereoMetrics} stereo
 * @property {Object} [rms] - RMS levels in dBFS
 * @property {Object} [visualization] - Pre-computed visualization data
 * @property {boolean} isActive
 * @property {number} latency - Network latency in ms
 */

// ─────────────────────────────────────────────────────────────────────────────
// METRICS RECEIVER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Receives metrics from remote probes via the broker.
 *
 * Provides a clean API for subscribing to probes and receiving their
 * metrics for display. Handles connection management, probe discovery,
 * and latency tracking.
 *
 * @example
 * const receiver = new MetricsReceiver();
 *
 * receiver.onMetrics((probeId, metrics) => {
 *   updateMeters(metrics);
 * });
 *
 * receiver.onProbeListChange((probes) => {
 *   updateProbeSelector(probes);
 * });
 *
 * await receiver.connect();
 * receiver.subscribe('probe-uuid');
 */
export class MetricsReceiver {
  /** @type {WebSocketClient|null} */
  #client = null;

  /** @type {string} */
  #brokerUrl;

  /** @type {Map<string, ProbeInfo>} */
  #probes = new Map();

  /** @type {Set<string>} */
  #subscriptions = new Set();

  /** @type {Map<string, RemoteMetrics>} */
  #latestMetrics = new Map();

  /** @type {Set<function(string, RemoteMetrics): void>} */
  #metricsListeners = new Set();

  /** @type {Set<function(ProbeInfo[]): void>} */
  #probeListListeners = new Set();

  /** @type {Set<function(string): void>} */
  #statusListeners = new Set();

  /** @type {number|null} */
  #staleCheckInterval = null;

  /**
   * Create a new metrics receiver.
   *
   * @param {Object} [config] - Configuration options
   * @param {string} [config.brokerUrl] - Broker WebSocket URL
   */
  constructor(config = {}) {
    const storedUrl = this.#loadSetting(STORAGE_KEY_BROKER_URL);
    this.#brokerUrl = config.brokerUrl || storedUrl || DEFAULT_BROKER_URL;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

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

    if (this.#client) {
      this.#client.setUrl(url);
    }
  }

  /**
   * Check if connected to broker.
   * @returns {boolean}
   */
  get isConnected() {
    return this.#client?.isConnected || false;
  }

  /**
   * Get current connection state.
   * @returns {string}
   */
  get connectionState() {
    return this.#client?.state || ConnectionState.DISCONNECTED;
  }

  /**
   * Get list of available probes.
   * @returns {ProbeInfo[]}
   */
  get probes() {
    return Array.from(this.#probes.values());
  }

  /**
   * Get currently subscribed probe IDs.
   * @returns {string[]}
   */
  get subscriptions() {
    return Array.from(this.#subscriptions);
  }

  /**
   * Get latest metrics for a probe.
   *
   * @param {string} probeId - Probe identifier
   * @returns {RemoteMetrics|null} Latest metrics or null if not subscribed
   */
  getMetrics(probeId) {
    return this.#latestMetrics.get(probeId) || null;
  }

  /**
   * Connect to broker.
   *
   * @returns {Promise<void>}
   */
  async connect() {
    if (this.#client?.isConnected) {
      return;
    }

    if (!this.#client) {
      this.#client = new WebSocketClient(this.#brokerUrl, {
        autoReconnect: true
      });

      this.#setupClientListeners();
    }

    this.#notifyStatus('connecting');

    try {
      await this.#client.connect();
      this.#requestProbeList();
      this.#startStaleCheck();
      this.#notifyStatus('connected');
    } catch (error) {
      this.#notifyStatus('error');
      throw error;
    }
  }

  /**
   * Disconnect from broker.
   */
  disconnect() {
    this.#stopStaleCheck();
    this.#subscriptions.clear();
    this.#latestMetrics.clear();

    if (this.#client) {
      this.#client.disconnect();
    }

    this.#notifyStatus('disconnected');
  }

  /**
   * Subscribe to a probe's metrics.
   *
   * @param {string} probeId - Probe identifier
   */
  subscribe(probeId) {
    if (this.#subscriptions.has(probeId)) {
      return; // Already subscribed
    }

    this.#subscriptions.add(probeId);

    if (this.#client?.isConnected) {
      this.#client.send({
        type: 'subscribe',
        probeId
      });
    }
  }

  /**
   * Unsubscribe from a probe.
   *
   * @param {string} probeId - Probe identifier
   */
  unsubscribe(probeId) {
    this.#subscriptions.delete(probeId);
    this.#latestMetrics.delete(probeId);

    if (this.#client?.isConnected) {
      this.#client.send({
        type: 'unsubscribe',
        probeId
      });
    }
  }

  /**
   * Unsubscribe from all probes.
   */
  unsubscribeAll() {
    for (const probeId of this.#subscriptions) {
      this.unsubscribe(probeId);
    }
  }

  /**
   * Request updated probe list from broker.
   */
  refreshProbeList() {
    this.#requestProbeList();
  }

  /**
   * Register metrics listener.
   *
   * @param {function(string, RemoteMetrics): void} callback
   * @returns {function(): void} Unsubscribe function
   */
  onMetrics(callback) {
    this.#metricsListeners.add(callback);
    return () => this.#metricsListeners.delete(callback);
  }

  /**
   * Register probe list change listener.
   *
   * @param {function(ProbeInfo[]): void} callback
   * @returns {function(): void} Unsubscribe function
   */
  onProbeListChange(callback) {
    this.#probeListListeners.add(callback);
    return () => this.#probeListListeners.delete(callback);
  }

  /**
   * Register status change listener.
   *
   * @param {function(string): void} callback
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
    this.disconnect();
    this.#client = null;
    this.#probes.clear();
    this.#metricsListeners.clear();
    this.#probeListListeners.clear();
    this.#statusListeners.clear();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: CONNECTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Set up WebSocket client listeners.
   * @private
   */
  #setupClientListeners() {
    this.#client.on('connected', () => {
      console.log('[MetricsReceiver] Connected to broker');
      this.#requestProbeList();
      this.#resubscribe();
      this.#startStaleCheck();
      this.#notifyStatus('connected');
    });

    this.#client.on('disconnected', () => {
      console.log('[MetricsReceiver] Disconnected from broker');
      this.#stopStaleCheck();
      this.#notifyStatus('disconnected');
    });

    this.#client.on('message', (data) => {
      this.#handleMessage(data);
    });

    this.#client.on('reconnecting', () => {
      this.#notifyStatus('reconnecting');
    });
  }

  /**
   * Re-subscribe to all probes after reconnection.
   * @private
   */
  #resubscribe() {
    for (const probeId of this.#subscriptions) {
      this.#client.send({
        type: 'subscribe',
        probeId
      });
    }
  }

  /**
   * Request probe list from broker.
   * @private
   */
  #requestProbeList() {
    if (this.#client?.isConnected) {
      this.#client.send({ type: 'list' });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: MESSAGE HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle incoming broker message.
   * @private
   */
  #handleMessage(data) {
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      console.warn('[MetricsReceiver] Invalid JSON');
      return;
    }

    switch (message.type) {
      case 'metrics':
        this.#handleMetrics(message);
        break;

      case 'probeList':
        this.#handleProbeList(message.probes);
        break;

      case 'probeOnline':
        this.#handleProbeOnline(message);
        break;

      case 'probeOffline':
        this.#handleProbeOffline(message.probeId);
        break;

      case 'subscribed':
        console.log(`[MetricsReceiver] Subscribed to ${message.probeName}`);
        break;

      case 'error':
        console.warn('[MetricsReceiver] Broker error:', message.message);
        break;
    }
  }

  /**
   * Handle incoming metrics packet.
   * @private
   */
  #handleMetrics(message) {
    const { probeId, payload } = message;

    if (!probeId || !payload) return;

    // Calculate latency (handle both timestamp formats)
    const now = Date.now();
    const tsValue = typeof payload.timestamp === 'number'
      ? payload.timestamp
      : payload.timestamp?.wallClock;
    const latency = tsValue ? now - tsValue : 0;

    // Support both flat format (payload.lufs) and nested format (payload.metrics.lufs)
    const metricsData = payload.metrics || payload;

    /** @type {RemoteMetrics} */
    const metrics = {
      lufs: metricsData.lufs || createEmptyLUFS(),
      truePeak: metricsData.truePeak || createEmptyTruePeak(),
      ppm: metricsData.ppm || createEmptyPPM(),
      stereo: metricsData.stereo || createEmptyStereo(),
      rms: metricsData.rms || null,
      visualization: payload.visualization || null,
      isActive: payload.isActive !== undefined ? payload.isActive : true,
      latency
    };

    this.#latestMetrics.set(probeId, metrics);

    // Update probe last seen
    const probe = this.#probes.get(probeId);
    if (probe) {
      probe.lastSeen = now;
      probe.isOnline = true;
    }

    // Notify listeners
    for (const listener of this.#metricsListeners) {
      try {
        listener(probeId, metrics);
      } catch (error) {
        console.error('[MetricsReceiver] Metrics listener error:', error);
      }
    }
  }

  /**
   * Handle probe list from broker.
   * @private
   */
  #handleProbeList(probeList) {
    this.#probes.clear();

    for (const probe of probeList) {
      this.#probes.set(probe.id, {
        id: probe.id,
        name: probe.name,
        location: probe.location,
        lastSeen: probe.lastSeen,
        isOnline: true,
        subscriberCount: probe.subscriberCount || 0
      });
    }

    this.#notifyProbeListChange();
  }

  /**
   * Handle probe coming online.
   * @private
   */
  #handleProbeOnline(message) {
    const { probeId, name, location } = message;

    this.#probes.set(probeId, {
      id: probeId,
      name: name || `Probe ${probeId.slice(0, 8)}`,
      location: location || '',
      lastSeen: Date.now(),
      isOnline: true,
      subscriberCount: 0
    });

    this.#notifyProbeListChange();
  }

  /**
   * Handle probe going offline.
   * @private
   */
  #handleProbeOffline(probeId) {
    const probe = this.#probes.get(probeId);

    if (probe) {
      probe.isOnline = false;
      this.#notifyProbeListChange();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: STALE DETECTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start stale probe detection interval.
   * @private
   */
  #startStaleCheck() {
    this.#stopStaleCheck();

    this.#staleCheckInterval = window.setInterval(() => {
      const now = Date.now();
      let changed = false;

      for (const probe of this.#probes.values()) {
        const wasOnline = probe.isOnline;
        probe.isOnline = (now - probe.lastSeen) < PROBE_STALE_TIMEOUT_MS;

        if (wasOnline !== probe.isOnline) {
          changed = true;
        }
      }

      if (changed) {
        this.#notifyProbeListChange();
      }
    }, 1000);
  }

  /**
   * Stop stale probe detection.
   * @private
   */
  #stopStaleCheck() {
    if (this.#staleCheckInterval) {
      clearInterval(this.#staleCheckInterval);
      this.#staleCheckInterval = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Notify probe list change listeners.
   * @private
   */
  #notifyProbeListChange() {
    const probeList = this.probes;

    for (const listener of this.#probeListListeners) {
      try {
        listener(probeList);
      } catch (error) {
        console.error('[MetricsReceiver] Probe list listener error:', error);
      }
    }
  }

  /**
   * Notify status listeners.
   * @private
   */
  #notifyStatus(status) {
    for (const listener of this.#statusListeners) {
      try {
        listener(status);
      } catch (error) {
        console.error('[MetricsReceiver] Status listener error:', error);
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
      return null;
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
      // Ignore
    }
  }
}
