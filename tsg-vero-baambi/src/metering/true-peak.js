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
 * TRUE PEAK DETECTION (ITU-R BS.1770-4 / EBU R128)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * ───────
 * Detect intersample peaks that exceed 0 dBFS in the analogue domain.
 * Digital samples may not capture the true peak when signal peaks occur
 * between sample points. True Peak detection uses oversampling to estimate
 * the actual maximum amplitude.
 *
 * ALGORITHM
 * ─────────
 * 1. Upsample the signal by 4× using interpolation
 * 2. Find maximum absolute value across all interpolated points
 * 3. Convert to dBTP (decibels True Peak)
 *
 * This implementation uses 4-point Hermite interpolation, which provides
 * a good balance between accuracy and computational efficiency.
 *
 * TRUE PEAK LIMITS (Broadcast standards)
 * ──────────────────────────────────────
 *   EBU R128:     −1.0 dBTP (broadcast)
 *   Streaming:    −2.0 dBTP (lossy codec headroom)
 *   Safe master:  −3.0 dBTP (extra safety margin)
 *
 * @module metering/true-peak
 * @see ITU-R BS.1770-4 Annex 2 (True-peak level measurement)
 * @see EBU Tech 3341 Section 3 (True peak)
 * @see AES17-2015 (Peak level measurement)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * EBU R128 True Peak limit for broadcast.
 * @type {number}
 */
export const TP_LIMIT_EBU = -1.0;

/**
 * True Peak limit for streaming (codec headroom).
 * @type {number}
 */
export const TP_LIMIT_STREAMING = -2.0;

/**
 * Conservative True Peak limit for masters.
 * @type {number}
 */
export const TP_LIMIT_SAFE = -3.0;

/**
 * Interpolation points between samples (4× oversampling).
 * @type {number}
 */
export const OVERSAMPLE_FACTOR = 4;

/**
 * Peak hold duration in seconds (RTW-style 3s hold).
 * @type {number}
 */
export const PEAK_HOLD_SECONDS = 3;

// ─────────────────────────────────────────────────────────────────────────────
// INTERPOLATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 4-point Hermite interpolation.
 *
 * Hermite interpolation provides smooth, continuous curves between sample
 * points. It uses 4 sample points (p0, p1, p2, p3) and interpolates
 * between p1 and p2 at position t (0 to 1).
 *
 * @param {number} p0 - Sample at i-1
 * @param {number} p1 - Sample at i (start of interpolation segment)
 * @param {number} p2 - Sample at i+1 (end of interpolation segment)
 * @param {number} p3 - Sample at i+2
 * @param {number} t - Interpolation position (0 to 1)
 * @returns {number} Interpolated value
 */
// EXACT from audio-meters-grid.html line 3564
export function hermiteInterpolate(p0, p1, p2, p3, t) {
  const a = (-0.5 * p0) + (1.5 * p1) + (-1.5 * p2) + (0.5 * p3);
  const b = (p0 * (-1)) + (2.5 * p1) + (-2 * p2) + (0.5 * p3);
  const c = (-0.5 * p0) + (0.5 * p2);
  const d = p1;

  return ((a * t + b) * t + c) * t + d;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRUE PEAK CALCULATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate True Peak level from audio buffer using 4× oversampling.
 *
 * Uses Hermite interpolation to estimate intersample peaks at
 * 0.25, 0.50, and 0.75 positions between each sample pair.
 *
 * @param {Float32Array} buffer - Audio samples (typically from AnalyserNode)
 * @returns {number} True Peak in dBTP
 *
 * @example
 * analyser.getFloatTimeDomainData(buffer);
 * const truePeak = calculateTruePeak(buffer);
 * console.log(`True Peak: ${truePeak.toFixed(1)} dBTP`);
 */
export function calculateTruePeak(buffer) {
  let maxAbs = 0;
  const n = buffer.length;

  // Need at least 4 samples for Hermite interpolation
  if (n < 4) {
    // Fallback to sample peak
    for (let i = 0; i < n; i++) {
      const abs = Math.abs(buffer[i]);
      if (abs > maxAbs) maxAbs = abs;
    }
    return amplitudeToDbTP(maxAbs);
  }

  // Process each segment with interpolation
  for (let i = 1; i < n - 2; i++) {
    const p0 = buffer[i - 1];
    const p1 = buffer[i];
    const p2 = buffer[i + 1];
    const p3 = buffer[i + 2];

    // Check the actual sample
    const abs1 = Math.abs(p1);
    if (abs1 > maxAbs) maxAbs = abs1;

    // Check interpolated points at 0.25, 0.50, 0.75
    const t1 = Math.abs(hermiteInterpolate(p0, p1, p2, p3, 0.25));
    if (t1 > maxAbs) maxAbs = t1;

    const t2 = Math.abs(hermiteInterpolate(p0, p1, p2, p3, 0.50));
    if (t2 > maxAbs) maxAbs = t2;

    const t3 = Math.abs(hermiteInterpolate(p0, p1, p2, p3, 0.75));
    if (t3 > maxAbs) maxAbs = t3;
  }

  return amplitudeToDbTP(maxAbs);
}

/**
 * Calculate True Peak for stereo (L/R) buffers.
 *
 * @param {Float32Array} leftBuffer - Left channel samples
 * @param {Float32Array} rightBuffer - Right channel samples
 * @returns {TruePeakStereo} Per-channel and combined True Peak
 */
export function calculateTruePeakStereo(leftBuffer, rightBuffer) {
  const left = calculateTruePeak(leftBuffer);
  const right = calculateTruePeak(rightBuffer);
  const max = Math.max(left, right);

  return { left, right, max };
}

/**
 * @typedef {Object} TruePeakStereo
 * @property {number} left - Left channel True Peak in dBTP
 * @property {number} right - Right channel True Peak in dBTP
 * @property {number} max - Maximum of L/R in dBTP
 */

// ─────────────────────────────────────────────────────────────────────────────
// TRUE PEAK METER CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * True Peak Meter with smoothing and peak hold.
 *
 * Provides broadcast-style metering with:
 * - Instantaneous True Peak (smoothed for display stability)
 * - 3-second peak hold (RTW/DK convention)
 * - Over indicator with latch
 *
 * @example
 * const tpMeter = new TruePeakMeter({ limit: -1.0 });
 *
 * // In animation loop:
 * analyserL.getFloatTimeDomainData(bufferL);
 * analyserR.getFloatTimeDomainData(bufferR);
 * tpMeter.update(bufferL, bufferR);
 *
 * const { left, right, peakHoldL, peakHoldR, isOver } = tpMeter.getState();
 */
export class TruePeakMeter {
  /**
   * @param {Object} options - Configuration options
   * @param {number} [options.limit=TP_LIMIT_EBU] - True Peak limit for over detection
   * @param {number} [options.smoothing=0.25] - Smoothing factor (0-1, higher = faster)
   * @param {number} [options.peakHoldSeconds=PEAK_HOLD_SECONDS] - Peak hold duration
   */
  constructor({
    limit = TP_LIMIT_EBU,
    smoothing = 0.25,
    peakHoldSeconds = PEAK_HOLD_SECONDS
  } = {}) {
    this.limit = limit;
    this.smoothing = smoothing;
    this.peakHoldSeconds = peakHoldSeconds;

    // Smoothed current values
    this.smoothL = -60;
    this.smoothR = -60;

    // Peak hold state
    this.peakHoldL = -60;
    this.peakHoldR = -60;
    this.peakTimeL = 0;
    this.peakTimeR = 0;

    // Over indicator (latched)
    this.isOver = false;

    // Maximum peak since reset (for TPmax display)
    this.maxPeak = -Infinity;
  }

  /**
   * Update meter with new audio buffers.
   *
   * @param {Float32Array} leftBuffer - Left channel samples
   * @param {Float32Array} rightBuffer - Right channel samples
   */
  update(leftBuffer, rightBuffer) {
    const rawL = calculateTruePeak(leftBuffer);
    const rawR = calculateTruePeak(rightBuffer);

    // Smooth for stable display
    const a = this.smoothing;
    this.smoothL = this.smoothL + a * (rawL - this.smoothL);
    this.smoothR = this.smoothR + a * (rawR - this.smoothR);

    // Peak hold logic (3s hold)
    const now = performance.now() / 1000;

    if (this.smoothL > this.peakHoldL) {
      this.peakHoldL = this.smoothL;
      this.peakTimeL = now;
    } else if (now - this.peakTimeL > this.peakHoldSeconds) {
      this.peakHoldL = this.smoothL;
      this.peakTimeL = now;
    }

    if (this.smoothR > this.peakHoldR) {
      this.peakHoldR = this.smoothR;
      this.peakTimeR = now;
    } else if (now - this.peakTimeR > this.peakHoldSeconds) {
      this.peakHoldR = this.smoothR;
      this.peakTimeR = now;
    }

    // Over indicator (latched until reset)
    const maxPeakHold = Math.max(this.peakHoldL, this.peakHoldR);
    if (maxPeakHold >= this.limit) {
      this.isOver = true;
    }

    // Track maximum peak since reset
    if (maxPeakHold > this.maxPeak) {
      this.maxPeak = maxPeakHold;
    }
  }

  /**
   * Get current meter state.
   *
   * @returns {TruePeakMeterState} Current readings and status
   */
  getState() {
    return {
      left: this.smoothL,
      right: this.smoothR,
      peakHoldL: this.peakHoldL,
      peakHoldR: this.peakHoldR,
      maxPeak: this.maxPeak,
      isOver: this.isOver
    };
  }

  /**
   * Reset peak hold and over indicator.
   */
  reset() {
    this.peakHoldL = -60;
    this.peakHoldR = -60;
    this.maxPeak = -Infinity;
    this.isOver = false;
  }
}

/**
 * @typedef {Object} TruePeakMeterState
 * @property {number} left - Smoothed left True Peak in dBTP
 * @property {number} right - Smoothed right True Peak in dBTP
 * @property {number} peakHoldL - Peak hold left in dBTP
 * @property {number} peakHoldR - Peak hold right in dBTP
 * @property {number} maxPeak - Maximum peak since reset in dBTP
 * @property {boolean} isOver - True if peak exceeded limit
 */

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert linear amplitude to dBTP.
 *
 * @param {number} amplitude - Linear amplitude (0 to 1+)
 * @returns {number} Level in dBTP
 */
export function amplitudeToDbTP(amplitude) {
  // Add small epsilon to avoid log(0)
  return 20 * Math.log10(amplitude + 1e-9);
}

/**
 * Convert dBTP to linear amplitude.
 *
 * @param {number} dbTP - Level in dBTP
 * @returns {number} Linear amplitude
 */
export function dbTPToAmplitude(dbTP) {
  return Math.pow(10, dbTP / 20);
}

/**
 * Format True Peak value for display.
 *
 * @param {number} dbTP - True Peak in dBTP
 * @param {number} [decimals=1] - Decimal places
 * @returns {string} Formatted string (e.g., "-1.5 dBTP" or "--.- dBTP")
 */
export function formatTruePeak(dbTP, decimals = 1) {
  if (!isFinite(dbTP) || dbTP < -59) {
    return '--.- dBTP';
  }
  return dbTP.toFixed(decimals) + ' dBTP';
}

/**
 * Check if True Peak exceeds limit.
 *
 * @param {number} dbTP - True Peak in dBTP
 * @param {number} [limit=TP_LIMIT_EBU] - Limit in dBTP
 * @returns {boolean} True if over limit
 */
export function isOverLimit(dbTP, limit = TP_LIMIT_EBU) {
  return dbTP >= limit;
}
