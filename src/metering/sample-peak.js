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
 * SAMPLE PEAK DETECTION (IEC 60268-18 / AES17-2015)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * ───────
 * Measure the maximum absolute sample value in the digital domain.
 * Unlike True Peak, Sample Peak does not use oversampling and therefore
 * cannot detect intersample peaks. This is the fundamental digital peak
 * measurement used in all pre-2006 digital meters.
 *
 * ALGORITHM
 * ─────────
 * Sample Peak (linear) = max(|x[n]|) for all n in buffer
 * Sample Peak (dBFS)   = 20 × log₁₀(linear peak)
 *
 * USE CASES
 * ─────────
 * - Historical reference (comparing with legacy meters)
 * - Codec headroom verification (MP3/AAC clip on sample peak > -1 dBFS)
 * - A/D converter verification (raw converter output)
 * - Debugging (compare with True Peak to see intersample overshoot)
 *
 * LIMITATIONS
 * ───────────
 * - Cannot detect peaks between samples (intersample peaks)
 * - May read up to +3 dB lower than True Peak for near-Nyquist content
 * - Full scale is exactly 0 dBFS (cannot exceed by definition)
 *
 * @module metering/sample-peak
 * @see IEC 60268-18 (Digital audio peak measurement)
 * @see AES17-2015 Section 4.3 (Peak level definition)
 * @see EBU Tech 3341 Section 3.2.1 (Sample peak level)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Peak hold duration in seconds (RTW-style 3s hold).
 * @type {number}
 */
export const SP_PEAK_HOLD_SECONDS = 3;

/**
 * Floor value for logarithm to prevent -Infinity.
 * @type {number}
 */
const LOG_FLOOR = 1e-12;

// ─────────────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate sample peak for a single channel buffer.
 *
 * @param {Float32Array} buffer - Audio samples (normalised -1.0 to +1.0)
 * @returns {number} Sample peak in dBFS
 */
export function calculateSamplePeak(buffer) {
  if (!buffer || buffer.length === 0) {
    return -Infinity;
  }

  let max = 0;
  for (let i = 0; i < buffer.length; i++) {
    const abs = Math.abs(buffer[i]);
    if (abs > max) max = abs;
  }

  return 20 * Math.log10(max + LOG_FLOOR);
}

/**
 * Calculate sample peak for stereo buffers.
 *
 * @param {Float32Array} leftBuffer - Left channel samples
 * @param {Float32Array} rightBuffer - Right channel samples
 * @returns {{left: number, right: number, max: number}} Sample peaks in dBFS
 */
export function calculateSamplePeakStereo(leftBuffer, rightBuffer) {
  const left = calculateSamplePeak(leftBuffer);
  const right = calculateSamplePeak(rightBuffer);
  const max = Math.max(left, right);

  return { left, right, max };
}

// ─────────────────────────────────────────────────────────────────────────────
// SAMPLE PEAK METER CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sample Peak Meter with smoothing and peak hold.
 *
 * Provides broadcast-style metering with:
 * - Instantaneous Sample Peak (smoothed for display stability)
 * - 3-second peak hold (RTW/DK convention)
 * - Clip indicator at 0 dBFS
 *
 * @example
 * const spMeter = new SamplePeakMeter();
 *
 * // In animation loop:
 * analyserL.getFloatTimeDomainData(bufferL);
 * analyserR.getFloatTimeDomainData(bufferR);
 * spMeter.update(bufferL, bufferR);
 *
 * const { left, right, holdLeft, holdRight, isClip } = spMeter.getState();
 */
export class SamplePeakMeter {
  /**
   * @param {Object} options - Configuration options
   * @param {number} [options.smoothing=0.25] - Smoothing factor (0-1, higher = faster)
   * @param {number} [options.peakHoldSeconds=SP_PEAK_HOLD_SECONDS] - Peak hold duration
   */
  constructor({
    smoothing = 0.25,
    peakHoldSeconds = SP_PEAK_HOLD_SECONDS
  } = {}) {
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

    // Clip indicator (latched until reset)
    this.isClipL = false;
    this.isClipR = false;

    // Maximum peak since reset
    this.maxPeak = -Infinity;
  }

  /**
   * Update meter with new audio buffers.
   *
   * @param {Float32Array} leftBuffer - Left channel samples
   * @param {Float32Array} rightBuffer - Right channel samples
   */
  update(leftBuffer, rightBuffer) {
    const rawL = calculateSamplePeak(leftBuffer);
    const rawR = calculateSamplePeak(rightBuffer);

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

    // Clip indicator (latched until reset) - triggers at 0 dBFS
    if (this.peakHoldL >= -0.01) {
      this.isClipL = true;
    }
    if (this.peakHoldR >= -0.01) {
      this.isClipR = true;
    }

    // Track maximum peak since reset
    const maxPeakHold = Math.max(this.peakHoldL, this.peakHoldR);
    if (maxPeakHold > this.maxPeak) {
      this.maxPeak = maxPeakHold;
    }
  }

  /**
   * Get current meter state.
   *
   * @returns {SamplePeakMeterState} Current readings and status
   */
  getState() {
    return {
      dbfsLeft: this.smoothL,
      dbfsRight: this.smoothR,
      dbfsHoldLeft: this.peakHoldL,
      dbfsHoldRight: this.peakHoldR,
      dbfsMax: this.maxPeak,
      isClipLeft: this.isClipL,
      isClipRight: this.isClipR,
      isClipAny: this.isClipL || this.isClipR
    };
  }

  /**
   * Reset peak hold and clip indicators.
   */
  reset() {
    this.peakHoldL = this.smoothL;
    this.peakHoldR = this.smoothR;
    this.peakTimeL = performance.now() / 1000;
    this.peakTimeR = performance.now() / 1000;
    this.isClipL = false;
    this.isClipR = false;
    this.maxPeak = -Infinity;
  }
}

/**
 * @typedef {Object} SamplePeakMeterState
 * @property {number} dbfsLeft - Current left channel sample peak in dBFS
 * @property {number} dbfsRight - Current right channel sample peak in dBFS
 * @property {number} dbfsHoldLeft - Peak hold left channel in dBFS
 * @property {number} dbfsHoldRight - Peak hold right channel in dBFS
 * @property {number} dbfsMax - Maximum peak since reset in dBFS
 * @property {boolean} isClipLeft - Left channel has clipped (0 dBFS)
 * @property {boolean} isClipRight - Right channel has clipped (0 dBFS)
 * @property {boolean} isClipAny - Either channel has clipped
 */
