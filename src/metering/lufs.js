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
 * EBU R128 / ITU-R BS.1770-4 LOUDNESS MEASUREMENT
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * ───────
 * Programme loudness measurement per EBU R128 and ITU-R BS.1770-4.
 * Provides Momentary, Short-term, and Integrated loudness in LUFS.
 *
 * INTEGRATION WINDOWS (BS.1770)
 * ─────────────────────────────
 *   Momentary (M): 400ms sliding window, updated per frame
 *   Short-term (S): 3s sliding window, updated per frame
 *   Integrated (I): Gated measurement over entire programme
 *
 * GATING ALGORITHM (BS.1770-4)
 * ────────────────────────────
 *   1. Absolute gate: −70 LUFS (discard silence)
 *   2. Relative gate: −10 LU below ungated integrated loudness
 *   Only blocks exceeding both gates contribute to integrated loudness.
 *
 * LOUDNESS RANGE (EBU Tech 3342)
 * ──────────────────────────────
 *   LRA is calculated from short-term loudness distribution:
 *   - Discard values below −10 LU from ungated integrated loudness
 *   - LRA = 95th percentile − 10th percentile
 *   - Requires ~60s of data for stable measurement
 *
 * @module metering/lufs
 * @see ITU-R BS.1770-4 (Algorithms to measure audio programme loudness)
 * @see EBU R128 (Loudness normalisation and permitted maximum level)
 * @see EBU Tech 3341 (Loudness Metering: 'EBU Mode')
 * @see EBU Tech 3342 (Loudness Range)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Momentary loudness window duration in seconds.
 * @type {number}
 */
export const MOMENTARY_WINDOW_S = 0.4; // 400ms

/**
 * Short-term loudness window duration in seconds.
 * @type {number}
 */
export const SHORT_TERM_WINDOW_S = 3.0; // 3s

/**
 * Absolute gate threshold in LUFS.
 * Blocks below this are considered silence and discarded.
 * @type {number}
 */
export const ABSOLUTE_GATE_LUFS = -70;

/**
 * Relative gate offset in LU.
 * Relative gate = integrated loudness − 10 LU
 * @type {number}
 */
export const RELATIVE_GATE_OFFSET_LU = -10;

/**
 * Default loudness target per EBU R128.
 * @type {number}
 */
export const DEFAULT_TARGET_LUFS = -23;

/**
 * ATSC A/85 target (US broadcast).
 * @type {number}
 */
export const ATSC_TARGET_LKFS = -24;

/**
 * Minimum short-term blocks required for LRA calculation.
 * ~60s of data at typical frame rates.
 * @type {number}
 */
export const MIN_LRA_BLOCKS = 15;

/**
 * ITU-R BS.1770-4 calibration constant.
 *
 * This offset compensates for the K-weighting filter's gain at the reference
 * frequency (997 Hz per IEC 61606). Without this constant, a 0 dBFS sine wave
 * at 997 Hz would not yield the expected −3.01 LUFS reading.
 *
 * From ITU-R BS.1770-4 equation (2):
 *   L_K = −0.691 + 10 × log₁₀(Σ Gᵢ × zᵢ)  LKFS
 *
 * Where:
 *   - zᵢ = mean square of K-weighted channel i
 *   - Gᵢ = channel weight (1.0 for L/R/C, 1.41 for Ls/Rs)
 *
 * @type {number}
 * @see ITU-R BS.1770-4 Section 4, Equation (2)
 */
export const BS1770_CALIBRATION_OFFSET = -0.691;

// ─────────────────────────────────────────────────────────────────────────────
// LUFS METER CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * EBU R128 Loudness Meter.
 *
 * Processes K-weighted stereo audio and calculates:
 * - Momentary loudness (400ms window)
 * - Short-term loudness (3s window)
 * - Integrated loudness (gated, programme-length)
 * - Loudness Range (LRA)
 *
 * @example
 * const meter = new LUFSMeter({ sampleRate: 48000, blockSize: 2048 });
 *
 * // In your audio processing loop:
 * const energy = meter.calculateBlockEnergy(kWeightedL, kWeightedR);
 * meter.pushBlock(energy);
 * const readings = meter.getReadings();
 * console.log(`M: ${readings.momentary.toFixed(1)} LUFS`);
 */
export class LUFSMeter {
  /** @type {number} */
  sampleRate;
  /** @type {number} */
  blockSize;
  /** @type {number} */
  momentaryLength;
  /** @type {number} */
  shortTermLength;
  /** @type {number[]} */
  momentaryQueue;
  /** @type {number[]} */
  shortTermQueue;
  /** @type {number} */
  integratedEnergy;
  /** @type {number} */
  integratedCount;
  /** @type {number[]} */
  shortTermHistory;
  /** @type {number} */
  maxHistoryLength;

  /**
   * @param {Object} options - Configuration options
   * @param {number} [options.sampleRate=48000] - Audio sample rate
   * @param {number} [options.blockSize=2048] - Samples per block
   * @param {number} [options.historyDuration=60] - Seconds of ST history for LRA
   */
  constructor({ sampleRate = 48000, blockSize = 2048, historyDuration = 60 } = {}) {
    this.sampleRate = sampleRate;
    this.blockSize = blockSize;

    // Calculate queue sizes based on window durations
    const blockDuration = blockSize / sampleRate;
    this.momentaryLength = Math.max(1, Math.round(MOMENTARY_WINDOW_S / blockDuration));
    this.shortTermLength = Math.max(1, Math.round(SHORT_TERM_WINDOW_S / blockDuration));

    // Sliding window queues
    /** @type {number[]} */
    this.momentaryQueue = [];
    /** @type {number[]} */
    this.shortTermQueue = [];

    // Integrated loudness accumulators
    this.integratedEnergy = 0;
    this.integratedCount = 0;

    // Short-term history for LRA calculation
    /** @type {number[]} */
    this.shortTermHistory = [];
    this.maxHistoryLength = Math.round(historyDuration / SHORT_TERM_WINDOW_S);
  }

  /**
   * Calculate mean square energy from K-weighted stereo buffers.
   *
   * @param {Float32Array} leftBuffer - K-weighted left channel
   * @param {Float32Array} rightBuffer - K-weighted right channel
   * @returns {number} Combined mean square energy
   */
  calculateBlockEnergy(leftBuffer, rightBuffer) {
    let energyL = 0;
    let energyR = 0;
    const length = leftBuffer.length;

    for (let i = 0; i < length; i++) {
      energyL += leftBuffer[i] * leftBuffer[i];
      energyR += rightBuffer[i] * rightBuffer[i];
    }

    // Mean square, then average L+R (equal weighting for stereo)
    const msL = energyL / length;
    const msR = energyR / length;

    return (msL + msR) / 2;
  }

  /**
   * Push a new energy block and update all measurements.
   *
   * @param {number} energy - Mean square energy from calculateBlockEnergy()
   */
  pushBlock(energy) {
    // Update momentary queue (400ms)
    this.momentaryQueue.push(energy);
    if (this.momentaryQueue.length > this.momentaryLength) {
      this.momentaryQueue.shift();
    }

    // Update short-term queue (3s)
    this.shortTermQueue.push(energy);
    if (this.shortTermQueue.length > this.shortTermLength) {
      const shifted = this.shortTermQueue.shift();

      // Add to history for LRA calculation (shift always returns a value here)
      if (shifted !== undefined) {
        this.shortTermHistory.push(shifted);
        if (this.shortTermHistory.length > this.maxHistoryLength) {
          this.shortTermHistory.shift();
        }
      }
    }

    // Update integrated loudness with gating
    const shortTermLUFS = this._queueToLUFS(this.shortTermQueue);
    const currentGate = this._calculateGate();

    if (shortTermLUFS >= currentGate) {
      this.integratedEnergy += energy;
      this.integratedCount++;
    }
  }

  /**
   * Get current loudness readings.
   *
   * @returns {LoudnessReadings} Current momentary, short-term, integrated, and LRA
   */
  getReadings() {
    const momentary = this._queueToLUFS(this.momentaryQueue);
    const shortTerm = this._queueToLUFS(this.shortTermQueue);
    const integrated = this.integratedCount > 0
      ? energyToLUFS(this.integratedEnergy / this.integratedCount)
      : -Infinity;
    const lra = this._calculateLRA(integrated);

    return {
      momentary,
      shortTerm,
      integrated,
      lra
    };
  }

  /**
   * Reset all measurements.
   */
  reset() {
    this.momentaryQueue.length = 0;
    this.shortTermQueue.length = 0;
    this.integratedEnergy = 0;
    this.integratedCount = 0;
    this.shortTermHistory.length = 0;
  }

  /**
   * Calculate LUFS from energy queue.
   * @private
   * @param {number[]} queue - Energy values
   * @returns {number} LUFS value
   */
  _queueToLUFS(queue) {
    if (queue.length === 0) return -Infinity;
    const meanEnergy = queue.reduce((a, b) => a + b, 0) / queue.length;
    return energyToLUFS(meanEnergy);
  }

  /**
   * Calculate current gating threshold.
   * @private
   * @returns {number} Gate threshold in LUFS
   */
  _calculateGate() {
    if (this.integratedCount === 0) {
      return ABSOLUTE_GATE_LUFS;
    }

    const ungatedIntegrated = energyToLUFS(this.integratedEnergy / this.integratedCount);
    return Math.max(ABSOLUTE_GATE_LUFS, ungatedIntegrated + RELATIVE_GATE_OFFSET_LU);
  }

  /**
   * Calculate Loudness Range (LRA) from short-term history.
   * @private
   * @param {number} integratedLUFS - Integrated loudness for gating
   * @returns {number|null} LRA in LU, or null if insufficient data
   */
  _calculateLRA(integratedLUFS) {
    // Need sufficient data for stable LRA
    if (this.shortTermHistory.length < MIN_LRA_BLOCKS) {
      return null;
    }

    // Convert history to LUFS and filter below integrated - 20 LU
    const threshold = integratedLUFS - 20;
    const values = this.shortTermHistory
      .map(e => energyToLUFS(e))
      .filter(v => v > threshold);

    if (values.length < MIN_LRA_BLOCKS) {
      return null;
    }

    // Sort and calculate percentiles
    const sorted = [...values].sort((a, b) => a - b);
    const p10 = sorted[Math.floor(sorted.length * 0.10)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];

    return p95 - p10;
  }
}

/**
 * @typedef {Object} LoudnessReadings
 * @property {number} momentary - Momentary loudness in LUFS (400ms window)
 * @property {number} shortTerm - Short-term loudness in LUFS (3s window)
 * @property {number} integrated - Integrated loudness in LUFS (gated)
 * @property {number|null} lra - Loudness Range in LU, or null if insufficient data
 */

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert mean square energy to LUFS per ITU-R BS.1770-4.
 *
 * Applies the BS.1770-4 loudness formula:
 *   L_K = −0.691 + 10 × log₁₀(energy)
 *
 * The −0.691 dB calibration constant ensures that a 0 dBFS sine wave
 * at 997 Hz yields exactly −3.01 LUFS when measured on a single channel,
 * matching the RMS-to-peak relationship (20 × log₁₀(1/√2) ≈ −3.01 dB).
 *
 * @param {number} energy - Mean square energy from K-weighted signal
 * @returns {number} Loudness in LUFS (LKFS)
 *
 * @example
 * // 0 dBFS sine wave has mean square energy of 0.5 (RMS² = 0.707² = 0.5)
 * // energyToLUFS(0.5) = -0.691 + 10 * log10(0.5) = -0.691 + (-3.01) = -3.70 LUFS
 *
 * @see ITU-R BS.1770-4 Section 4, Equation (2)
 */
export function energyToLUFS(energy) {
  // BS.1770-4: L_K = −0.691 + 10 × log₁₀(Σ Gᵢ × zᵢ)
  // Add small epsilon to avoid log(0) for silence
  return BS1770_CALIBRATION_OFFSET + 10 * Math.log10(energy + 1e-12);
}

/**
 * Convert LUFS to mean square energy.
 *
 * Inverse of energyToLUFS(), accounting for the BS.1770-4 calibration offset.
 *
 * @param {number} lufs - Loudness in LUFS
 * @returns {number} Mean square energy
 *
 * @see ITU-R BS.1770-4 Section 4, Equation (2)
 */
export function lufsToEnergy(lufs) {
  // Inverse: energy = 10^((lufs - offset) / 10)
  return Math.pow(10, (lufs - BS1770_CALIBRATION_OFFSET) / 10);
}

/**
 * Calculate offset from target loudness.
 *
 * @param {number} lufs - Measured loudness in LUFS
 * @param {number} [target=DEFAULT_TARGET_LUFS] - Target loudness
 * @returns {number} Offset in LU (positive = too loud, negative = too quiet)
 */
export function loudnessOffset(lufs, target = DEFAULT_TARGET_LUFS) {
  return lufs - target;
}

/**
 * Get colour indication for loudness relative to target.
 * Based on EBU R128 guidance and TC/RTW meter conventions.
 *
 * @param {number} lufs - Measured loudness in LUFS
 * @param {number} [target=DEFAULT_TARGET_LUFS] - Target loudness
 * @returns {'on-target'|'quiet'|'loud'|'too-loud'|'silent'} Colour zone
 */
export function loudnessZone(lufs, target = DEFAULT_TARGET_LUFS) {
  if (!isFinite(lufs)) return 'silent';

  const offset = lufs - target;

  if (offset >= -1 && offset <= 1) return 'on-target';  // Green: ±1 LU
  if (offset < -1) return 'quiet';                       // Cyan: too quiet
  if (offset <= 3) return 'loud';                        // Amber: bit loud
  return 'too-loud';                                     // Red: too loud
}

/**
 * Format LUFS value for display.
 *
 * @param {number} lufs - Loudness in LUFS
 * @param {number} [decimals=1] - Decimal places
 * @returns {string} Formatted string (e.g., "-23.0 LUFS" or "--.- LUFS")
 */
export function formatLUFS(lufs, decimals = 1) {
  if (!isFinite(lufs) || lufs < -60) {
    return '--.- LUFS';
  }
  return lufs.toFixed(decimals) + ' LUFS';
}

/**
 * Format LRA value for display.
 *
 * @param {number|null} lra - Loudness Range in LU
 * @param {number} [decimals=1] - Decimal places
 * @returns {string} Formatted string (e.g., "8.5 LU" or "--.- LU")
 */
export function formatLRA(lra, decimals = 1) {
  if (lra === null || !isFinite(lra)) {
    return '--.- LU';
  }
  return lra.toFixed(decimals) + ' LU';
}
