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
 * METRICS COLLECTOR
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Collects metering data from VERO-BAAMBI's existing meter instances and
 * packages them into MetricsPacket format for remote transmission.
 *
 * This module bridges the local metering system with the remote transport layer,
 * ensuring zero impact on local operation when remote features are disabled.
 *
 * DESIGN PRINCIPLES
 * ─────────────────
 * - Pure data extraction – no side effects on local meters
 * - Lazy initialisation – no overhead until explicitly started
 * - Graceful degradation – returns empty data if meters unavailable
 * - Sample-rate independent – works with any audio configuration
 *
 * @module remote/probe/metrics-collector
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  METRICS_SCHEMA_VERSION,
  createEmptyLUFS,
  createEmptyTruePeak,
  createEmptyPPM,
  createEmptyStereo,
  generateProbeId
} from '../types.js';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} MeterSources
 * @property {import('../../metering/lufs.js').LUFSMeter} [lufsMeter] - LUFS meter instance
 * @property {import('../../metering/true-peak.js').TruePeakMeter} [truePeakMeter] - True Peak meter
 * @property {import('../../metering/ppm.js').PPMMeter} [ppmMeter] - PPM meter instance
 * @property {function(): import('../../metering/correlation.js').CorrelationResult} [getCorrelation] - Correlation getter
 * @property {function(): number} [getBalance] - Balance getter (-1 to +1)
 * @property {function(): number} [getWidth] - Stereo width getter (0 to 1+)
 * @property {AudioContext} [audioContext] - Audio context for timing
 */

/**
 * @typedef {Object} ProbeConfig
 * @property {string} [id] - Probe identifier (auto-generated if omitted)
 * @property {string} [name] - Human-readable probe name
 * @property {string} [location] - Physical location description
 */

// ─────────────────────────────────────────────────────────────────────────────
// METRICS COLLECTOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Collects metrics from local meters for remote transmission.
 *
 * Designed to integrate seamlessly with VERO-BAAMBI's existing architecture.
 * Meters are passed in via `setSources()` after initialisation, allowing
 * the collector to be created before the audio system is fully ready.
 *
 * @example
 * const collector = new MetricsCollector({
 *   name: 'Studio A',
 *   location: 'Control Room'
 * });
 *
 * // Later, when meters are initialised:
 * collector.setSources({
 *   lufsMeter: app.lufsMeter,
 *   truePeakMeter: app.truePeakMeter,
 *   ppmMeter: app.ppmMeter,
 *   getCorrelation: () => app.correlation,
 *   audioContext: app.audioContext
 * });
 *
 * // Collect current metrics:
 * const packet = collector.collect();
 */
export class MetricsCollector {
  /** @type {string} */
  #probeId;

  /** @type {string} */
  #probeName;

  /** @type {string} */
  #probeLocation;

  /** @type {MeterSources} */
  #sources = {};

  /** @type {number} */
  #sequenceNumber = 0;

  /** @type {boolean} */
  #isActive = false;

  /** @type {string|null} */
  #inputDeviceName = null;

  /**
   * Create a new metrics collector.
   *
   * @param {ProbeConfig} [config] - Probe configuration
   */
  constructor(config = {}) {
    this.#probeId = config.id || generateProbeId();
    this.#probeName = config.name || `Probe ${this.#probeId.slice(0, 8)}`;
    this.#probeLocation = config.location || '';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get probe identifier.
   * @returns {string}
   */
  get probeId() {
    return this.#probeId;
  }

  /**
   * Get probe name.
   * @returns {string}
   */
  get probeName() {
    return this.#probeName;
  }

  /**
   * Set probe name.
   * @param {string} name
   */
  set probeName(name) {
    this.#probeName = name;
  }

  /**
   * Get probe location.
   * @returns {string}
   */
  get probeLocation() {
    return this.#probeLocation;
  }

  /**
   * Set probe location.
   * @param {string} location
   */
  set probeLocation(location) {
    this.#probeLocation = location;
  }

  /**
   * Check if collector is receiving active audio.
   * @returns {boolean}
   */
  get isActive() {
    return this.#isActive;
  }

  /**
   * Set active audio state.
   * @param {boolean} active
   */
  set isActive(active) {
    this.#isActive = active;
  }

  /**
   * Set input device name for display.
   * @param {string|null} name
   */
  set inputDevice(name) {
    this.#inputDeviceName = name;
  }

  /**
   * Get probe identity object.
   * @returns {import('../types.js').ProbeIdentity}
   */
  get identity() {
    return {
      id: this.#probeId,
      name: this.#probeName,
      location: this.#probeLocation
    };
  }

  /**
   * Set meter sources.
   *
   * Call this when the application's meters are ready. Sources can be
   * updated at any time without interrupting collection.
   *
   * @param {MeterSources} sources - Meter instances and getters
   */
  setSources(sources) {
    this.#sources = { ...this.#sources, ...sources };
  }

  /**
   * Clear all meter sources.
   */
  clearSources() {
    this.#sources = {};
  }

  /**
   * Collect current metrics from all sources.
   *
   * Returns a complete MetricsPacket ready for serialisation and transmission.
   * Missing sources result in default values (e.g., -Infinity for levels).
   *
   * @returns {import('../types.js').MetricsPacket}
   */
  collect() {
    const now = Date.now();
    const audioTime = this.#sources.audioContext?.currentTime || 0;

    return {
      schemaVersion: METRICS_SCHEMA_VERSION,
      probe: this.identity,
      timestamp: {
        probeTime: audioTime,
        wallClock: now,
        sequence: this.#sequenceNumber++
      },
      lufs: this.#collectLUFS(),
      truePeak: this.#collectTruePeak(),
      ppm: this.#collectPPM(),
      stereo: this.#collectStereo(),
      isActive: this.#isActive,
      inputDevice: this.#inputDeviceName || undefined
    };
  }

  /**
   * Reset sequence counter.
   * Call when reconnecting to broker.
   */
  resetSequence() {
    this.#sequenceNumber = 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: METRIC COLLECTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Collect LUFS metrics from meter.
   * @private
   * @returns {import('../types.js').LUFSMetrics}
   */
  #collectLUFS() {
    const meter = this.#sources.lufsMeter;

    if (!meter) {
      return createEmptyLUFS();
    }

    try {
      const readings = meter.getReadings();
      return {
        momentary: this.#sanitiseLevel(readings.momentary),
        shortTerm: this.#sanitiseLevel(readings.shortTerm),
        integrated: this.#sanitiseLevel(readings.integrated),
        range: readings.lra ?? 0
      };
    } catch (error) {
      console.warn('[MetricsCollector] LUFS collection error:', error);
      return createEmptyLUFS();
    }
  }

  /**
   * Collect True Peak metrics from meter.
   * @private
   * @returns {import('../types.js').TruePeakMetrics}
   */
  #collectTruePeak() {
    const meter = this.#sources.truePeakMeter;

    if (!meter) {
      return createEmptyTruePeak();
    }

    try {
      const state = meter.getState();
      return {
        left: this.#sanitiseLevel(state.dbtpLeft),
        right: this.#sanitiseLevel(state.dbtpRight),
        max: this.#sanitiseLevel(Math.max(state.dbtpLeft, state.dbtpRight))
      };
    } catch (error) {
      console.warn('[MetricsCollector] True Peak collection error:', error);
      return createEmptyTruePeak();
    }
  }

  /**
   * Collect PPM metrics from meter.
   * @private
   * @returns {import('../types.js').PPMMetrics}
   */
  #collectPPM() {
    const meter = this.#sources.ppmMeter;

    if (!meter) {
      return createEmptyPPM();
    }

    try {
      const state = meter.getState();
      return {
        left: this.#sanitiseLevel(state.dbfsLeft),
        right: this.#sanitiseLevel(state.dbfsRight)
      };
    } catch (error) {
      console.warn('[MetricsCollector] PPM collection error:', error);
      return createEmptyPPM();
    }
  }

  /**
   * Collect stereo analysis metrics.
   * @private
   * @returns {import('../types.js').StereoMetrics}
   */
  #collectStereo() {
    try {
      const correlation = this.#sources.getCorrelation?.() ?? { r: 0 };
      const balance = this.#sources.getBalance?.() ?? 0;
      const width = this.#sources.getWidth?.() ?? 0;

      return {
        correlation: this.#sanitiseCorrelation(correlation.r ?? correlation),
        balance: this.#clamp(balance, -1, 1),
        width: Math.max(0, width)
      };
    } catch (error) {
      console.warn('[MetricsCollector] Stereo collection error:', error);
      return createEmptyStereo();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Sanitise level value for transmission.
   * Replaces NaN/-Infinity with -Infinity, caps at reasonable bounds.
   *
   * @private
   * @param {number} value - Raw level value
   * @returns {number} Sanitised value
   */
  #sanitiseLevel(value) {
    if (!Number.isFinite(value) || value < -120) {
      return -Infinity;
    }
    return Math.max(-120, Math.min(6, value));
  }

  /**
   * Sanitise correlation value.
   *
   * @private
   * @param {number} value - Raw correlation
   * @returns {number} Clamped to [-1, 1]
   */
  #sanitiseCorrelation(value) {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return this.#clamp(value, -1, 1);
  }

  /**
   * Clamp value to range.
   *
   * @private
   * @param {number} value
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  #clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
}
