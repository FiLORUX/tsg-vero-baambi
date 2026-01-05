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
 * GATING ALGORITHM (ITU-R BS.1770-4 §5)
 * ─────────────────────────────────────
 *   Gating is performed on 400ms blocks (momentary loudness), NOT short-term.
 *
 *   TWO-STAGE GATING:
 *   Stage 1 – Absolute gate at Γₐ = −70 LKFS:
 *     Blocks with loudness < −70 LKFS are discarded (silence/noise floor).
 *     Remaining blocks contribute to "ungated integrated loudness".
 *
 *   Stage 2 – Relative gate at Γᵣ = Γᵢ − 10 LU:
 *     Where Γᵢ is the ungated integrated loudness from Stage 1.
 *     Blocks with loudness < Γᵣ are discarded.
 *     Remaining blocks contribute to final "gated integrated loudness".
 *
 *   The relative gate adapts continuously as programme content is analysed.
 *
 * LOUDNESS RANGE (EBU Tech 3342 §3.5)
 * ───────────────────────────────────
 *   LRA is calculated from short-term (3s) loudness distribution:
 *   1. Absolute gate: Discard short-term values below −70 LUFS
 *   2. Relative gate: Discard values below Γᵢ − 20 LU (note: −20, not −10)
 *   3. LRA = 95th percentile − 10th percentile of remaining values
 *   Requires ≥60s of data for stable measurement per EBU recommendation
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
 * Relative gate offset for integrated loudness in LU.
 * Per ITU-R BS.1770-4: Γᵣ = Γᵢ − 10 LU (where Γᵢ is ungated integrated)
 * @type {number}
 */
export const RELATIVE_GATE_OFFSET_LU = -10;

/**
 * Relative gate offset for LRA calculation in LU.
 * Per EBU Tech 3342 §3.5: LRA uses −20 LU (not −10) from ungated integrated.
 * @type {number}
 */
export const LRA_RELATIVE_GATE_OFFSET_LU = -20;

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
 * Supports EBU Tech 3341 §5.5 Play/Pause:
 * - When paused, M and S continue updating (live monitoring)
 * - Only I and LRA accumulation stops
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
  /** @type {number} Sum of energy from blocks passing absolute gate (−70 LKFS) */
  ungatedEnergy;
  /** @type {number} Count of blocks passing absolute gate */
  ungatedCount;
  /** @type {number} Sum of energy from blocks passing both gates (final gated) */
  integratedEnergy;
  /** @type {number} Count of blocks passing both gates */
  integratedCount;
  /** @type {number[]} Short-term loudness values (LUFS) for LRA calculation */
  shortTermHistory;
  /** @type {number} Maximum entries in shortTermHistory */
  maxHistoryLength;
  /** @type {number} Counter for short-term sampling interval */
  shortTermSampleCounter;
  /** @type {boolean} EBU Tech 3341 §5.5 pause state */
  isPaused;

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

    // BS.1770-4 two-stage gating accumulators
    // Stage 1: Ungated (blocks passing absolute gate only)
    this.ungatedEnergy = 0;
    this.ungatedCount = 0;
    // Stage 2: Gated (blocks passing both absolute and relative gates)
    this.integratedEnergy = 0;
    this.integratedCount = 0;

    // Short-term history for LRA calculation per EBU Tech 3342
    // Stores SHORT-TERM loudness values (3s windows), NOT individual block energies
    /** @type {number[]} Stored as LUFS values */
    this.shortTermHistory = [];
    this.maxHistoryLength = Math.round(historyDuration / SHORT_TERM_WINDOW_S);
    /** @type {number} Counter to sample short-term loudness every 3s */
    this.shortTermSampleCounter = 0;

    // EBU Tech 3341 §5.5 pause state
    this.isPaused = false;
  }

  /**
   * Pause integrated loudness and LRA accumulation.
   * Per EBU Tech 3341 §5.5, M and S continue updating.
   */
  pause() {
    this.isPaused = true;
  }

  /**
   * Resume integrated loudness and LRA accumulation.
   */
  resume() {
    this.isPaused = false;
  }

  /**
   * Calculate mean square energy from K-weighted stereo buffers.
   *
   * @param {Float32Array} leftBuffer - K-weighted left channel
   * @param {Float32Array} rightBuffer - K-weighted right channel
   * @returns {number} Combined mean square energy
   */
  calculateBlockEnergy(leftBuffer, rightBuffer) {
    // Guard: invalid or empty buffers
    if (!leftBuffer || !rightBuffer || leftBuffer.length === 0) {
      return 0;
    }

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
   * Per EBU Tech 3341 §5.5: When paused, M and S continue updating,
   * but I and LRA accumulation stops.
   *
   * @param {number} energy - Mean square energy from calculateBlockEnergy()
   */
  pushBlock(energy) {
    // Update momentary queue (400ms) - ALWAYS update for live M
    this.momentaryQueue.push(energy);
    if (this.momentaryQueue.length > this.momentaryLength) {
      this.momentaryQueue.shift();
    }

    // Update short-term queue (3s) - ALWAYS update for live S
    this.shortTermQueue.push(energy);
    if (this.shortTermQueue.length > this.shortTermLength) {
      this.shortTermQueue.shift();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LRA HISTORY SAMPLING (EBU Tech 3342)
    // ─────────────────────────────────────────────────────────────────────────
    // LRA is calculated from SHORT-TERM loudness distribution (3s windows).
    // Sample the current short-term value at ~3s intervals (every shortTermLength blocks).
    if (!this.isPaused && this.shortTermQueue.length >= this.shortTermLength) {
      this.shortTermSampleCounter++;
      if (this.shortTermSampleCounter >= this.shortTermLength) {
        // Store the current short-term loudness (3s window average) as LUFS
        const shortTermLUFS = this._queueToLUFS(this.shortTermQueue);
        this.shortTermHistory.push(shortTermLUFS);
        if (this.shortTermHistory.length > this.maxHistoryLength) {
          this.shortTermHistory.shift();
        }
        this.shortTermSampleCounter = 0;
      }
    }

    // Skip integrated loudness accumulation when paused (freezes I)
    if (this.isPaused) return;

    // ─────────────────────────────────────────────────────────────────────────
    // ITU-R BS.1770-4 TWO-STAGE GATING ALGORITHM
    // ─────────────────────────────────────────────────────────────────────────
    // Gating is performed on 400ms blocks (momentary), NOT 3s short-term.
    // This is specified in BS.1770-4 §5 and clarified in EBU Tech 3341.

    const momentaryLUFS = this._queueToLUFS(this.momentaryQueue);

    // STAGE 1: Absolute gate (Γₐ = −70 LKFS)
    // Blocks below absolute gate are considered silence/noise floor and discarded.
    if (momentaryLUFS < ABSOLUTE_GATE_LUFS) {
      return; // Block fails absolute gate - do not accumulate
    }

    // Block passes absolute gate - contribute to ungated integrated
    this.ungatedEnergy += energy;
    this.ungatedCount++;

    // STAGE 2: Relative gate (Γᵣ = Γᵢ − 10 LU)
    // Γᵢ is the ungated integrated loudness computed from all blocks passing Stage 1.
    // The relative gate adapts as programme content is accumulated.
    const ungatedIntegrated = energyToLUFS(this.ungatedEnergy / this.ungatedCount);
    const relativeGate = ungatedIntegrated + RELATIVE_GATE_OFFSET_LU;

    // Block must exceed relative gate to contribute to final gated integrated
    if (momentaryLUFS >= relativeGate) {
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
    // Final gated integrated loudness (blocks passing both absolute and relative gates)
    const integrated = this.integratedCount > 0
      ? energyToLUFS(this.integratedEnergy / this.integratedCount)
      : -Infinity;
    const lra = this._calculateLRA();

    return {
      momentary,
      shortTerm,
      integrated,
      lra
    };
  }

  /**
   * Reset all measurements.
   * Clears M, S, I, LRA accumulators and pause state per EBU Tech 3341.
   */
  reset() {
    this.momentaryQueue.length = 0;
    this.shortTermQueue.length = 0;
    // Reset BS.1770-4 two-stage gating accumulators
    this.ungatedEnergy = 0;
    this.ungatedCount = 0;
    this.integratedEnergy = 0;
    this.integratedCount = 0;
    // Reset LRA history and sample counter
    this.shortTermHistory.length = 0;
    this.shortTermSampleCounter = 0;
    this.isPaused = false;
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
   * Calculate Loudness Range (LRA) per EBU Tech 3342 §3.5.
   *
   * LRA is calculated from the distribution of short-term (3s) loudness values
   * using a two-stage gating process:
   *   1. Absolute gate: Discard values below −70 LUFS
   *   2. Relative gate: Discard values below Γᵢ − 20 LU
   *      (where Γᵢ is the ungated integrated loudness)
   *   3. LRA = 95th percentile − 10th percentile of remaining values
   *
   * Note: LRA uses −20 LU for the relative gate (not −10 LU as for integrated).
   *
   * @private
   * @returns {number|null} LRA in LU, or null if insufficient data
   */
  _calculateLRA() {
    // Need sufficient data for stable LRA (≥60s per EBU recommendation)
    if (this.shortTermHistory.length < MIN_LRA_BLOCKS) {
      return null;
    }

    // Compute ungated integrated loudness for relative gate calculation
    // (uses blocks passing absolute gate only)
    const ungatedIntegrated = this.ungatedCount > 0
      ? energyToLUFS(this.ungatedEnergy / this.ungatedCount)
      : -Infinity;

    // EBU Tech 3342 §3.5: Relative gate for LRA is Γᵢ − 20 LU (not −10)
    const relativeGateLRA = ungatedIntegrated + LRA_RELATIVE_GATE_OFFSET_LU;

    // Apply two-stage gating to short-term history (already stored as LUFS values)
    const values = this.shortTermHistory
      .filter(v => v >= ABSOLUTE_GATE_LUFS && v >= relativeGateLRA);

    if (values.length < MIN_LRA_BLOCKS) {
      return null;
    }

    // Sort ascending and extract 10th/95th percentiles
    const sorted = [...values].sort((a, b) => a - b);
    const idx10 = Math.floor(sorted.length * 0.10);
    const idx95 = Math.floor(sorted.length * 0.95);
    const p10 = sorted[idx10];
    const p95 = sorted[idx95];

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
    return ' --.- LUFS';
  }
  // Fixed-width format: pad to 5 chars for negative values (e.g., " -3.2" or "-23.5")
  return lufs.toFixed(decimals).padStart(5, ' ') + ' LUFS';
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
