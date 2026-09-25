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
 * DISPLAY (SamplePeakMeter)
 * ─────────────────────────
 * Instant attack, 20 dB in 1.7 s return on the meter's own clock, 3 s hold.
 * Hold, maximum and clip come from the unsmoothed peak, so a single sample
 * registers in full whatever the frame rate.
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
 * Fall rate of the bar reading in dB per second: 20 dB in 1.7 s, the return
 * of the True Peak bar and of the IEC 60268-10 Type I PPM.
 * @type {number}
 */
export const SP_RELEASE_DB_PER_SECOND = 20 / 1.7;

/**
 * Lowest bar and hold reading in dBFS, the bottom of the −60 dBFS scale.
 * @type {number}
 */
export const SP_DISPLAY_FLOOR_DB = -60;

/**
 * Clip threshold in dBFS. Full scale within 0.01 dB, so the largest 16- and
 * 24-bit codes (32767/32768 is −0.0003 dB) count as a clip.
 * @type {number}
 */
export const SP_CLIP_THRESHOLD_DB = -0.01;

/**
 * Linear level recorded for a non-finite peak: +60 dBFS, an unmistakable
 * over that a reset clears, as in the True Peak meter.
 * @type {number}
 */
const NON_FINITE_PEAK = 1000;

/** @returns {number} Monotonic clock in milliseconds */
const monotonicMs = () => performance.now();

/**
 * Sample Peak Meter with bar ballistics, peak hold, maximum and clip
 * indication.
 *
 * The reading is the largest absolute sample value, so it rises in one
 * sample: the bar takes each new peak at once and falls at a fixed rate in
 * dB per second on the meter's own clock (20 dB in 1.7 s). The hold, the
 * maximum since reset and the latched clip indication come from the
 * unsmoothed peak of every update. How often the meter is updated changes
 * nothing but the display's time resolution: a single full-scale sample
 * reads 0 dBFS and trips the clip indicator at 30 fps as at 180 fps.
 *
 * @example
 * const spMeter = new SamplePeakMeter();
 *
 * // Each frame, with the largest samples since the previous frame
 * // (e.g. consumeSamplePeaks() from the stereo sampler):
 * spMeter.updateFromPeaks(peakLeft, peakRight);
 *
 * // Or with a buffer of recent samples:
 * spMeter.update(bufferL, bufferR);
 *
 * const { dbfsLeft, dbfsHoldLeft, isClipAny } = spMeter.getState();
 */
export class SamplePeakMeter {
  /** @type {() => number} */
  #now;

  /** @type {number|null} Clock reading of the previous update in seconds */
  #lastUpdateSeconds = null;

  /**
   * @param {Object} options - Configuration options
   * @param {number} [options.peakHoldSeconds=SP_PEAK_HOLD_SECONDS] - Peak hold duration
   * @param {number} [options.releaseDbPerSecond=SP_RELEASE_DB_PER_SECOND] - Fall rate of the bar reading
   * @param {() => number} [options.now] - Monotonic clock in milliseconds (performance.now by default)
   */
  constructor({
    peakHoldSeconds = SP_PEAK_HOLD_SECONDS,
    releaseDbPerSecond = SP_RELEASE_DB_PER_SECOND,
    now = monotonicMs
  } = {}) {
    this.peakHoldSeconds = peakHoldSeconds;
    this.releaseDbPerSecond = releaseDbPerSecond;
    this.#now = now;

    // Bar readings (instant attack, timed release)
    this.smoothL = SP_DISPLAY_FLOOR_DB;
    this.smoothR = SP_DISPLAY_FLOOR_DB;

    // Peak hold state (from unsmoothed peaks)
    this.peakHoldL = SP_DISPLAY_FLOOR_DB;
    this.peakHoldR = SP_DISPLAY_FLOOR_DB;
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
    this.#applyPeaks(linearPeak(leftBuffer), linearPeak(rightBuffer));
  }

  /**
   * Update meter with sample peaks measured elsewhere.
   *
   * For a source that delivers peaks rather than the samples themselves:
   * the stereo sampler (consumeSamplePeaks), which measures every sample,
   * or the native engine's packets. Pass the largest magnitudes since the
   * previous update, or zero when nothing new arrived; the bar then only
   * falls. Ballistics, hold and clip indication are those of update().
   *
   * @param {number} [peakLeft=0] - Largest left sample magnitude, linear
   * @param {number} [peakRight=0] - Largest right sample magnitude, linear
   */
  updateFromPeaks(peakLeft = 0, peakRight = 0) {
    this.#applyPeaks(peakLeft, peakRight);
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
   * Reset peak hold, maximum and clip indicators. The bar carries on.
   */
  reset() {
    const nowSeconds = this.#now() / 1000;
    this.peakHoldL = this.smoothL;
    this.peakHoldR = this.smoothR;
    this.peakTimeL = nowSeconds;
    this.peakTimeR = nowSeconds;
    this.isClipL = false;
    this.isClipR = false;
    this.maxPeak = -Infinity;
  }

  /**
   * Apply one pair of unsmoothed linear peaks to bar, hold, maximum and clip.
   *
   * @param {number} peakL - Left channel peak, linear
   * @param {number} peakR - Right channel peak, linear
   */
  #applyPeaks(peakL, peakR) {
    const nowSeconds = this.#now() / 1000;
    const elapsed = this.#lastUpdateSeconds === null ? 0 : Math.max(0, nowSeconds - this.#lastUpdateSeconds);
    this.#lastUpdateSeconds = nowSeconds;

    const rawL = 20 * Math.log10(sanitisePeak(peakL) + LOG_FLOOR);
    const rawR = 20 * Math.log10(sanitisePeak(peakR) + LOG_FLOOR);

    // Bar reading: instant attack, fixed release rate in dB per second
    const fall = this.releaseDbPerSecond * elapsed;
    this.smoothL = Math.max(rawL, this.smoothL - fall, SP_DISPLAY_FLOOR_DB);
    this.smoothR = Math.max(rawR, this.smoothR - fall, SP_DISPLAY_FLOOR_DB);

    // Peak hold from the unsmoothed peak; after the hold time it drops to
    // the bar reading and holds that
    if (rawL > this.peakHoldL) {
      this.peakHoldL = rawL;
      this.peakTimeL = nowSeconds;
    } else if (nowSeconds - this.peakTimeL > this.peakHoldSeconds) {
      this.peakHoldL = this.smoothL;
      this.peakTimeL = nowSeconds;
    }
    if (rawR > this.peakHoldR) {
      this.peakHoldR = rawR;
      this.peakTimeR = nowSeconds;
    } else if (nowSeconds - this.peakTimeR > this.peakHoldSeconds) {
      this.peakHoldR = this.smoothR;
      this.peakTimeR = nowSeconds;
    }

    // Clip indicator (latched until reset) and maximum, from the unsmoothed peak
    if (rawL >= SP_CLIP_THRESHOLD_DB) this.isClipL = true;
    if (rawR >= SP_CLIP_THRESHOLD_DB) this.isClipR = true;
    this.maxPeak = Math.max(this.maxPeak, rawL, rawR);
  }
}

/**
 * Largest absolute sample value of a buffer.
 *
 * @param {Float32Array} buffer - Audio samples
 * @returns {number} Linear peak; 0 for an empty buffer, NaN samples ignored
 */
function linearPeak(buffer) {
  let max = 0;
  const n = buffer?.length ?? 0;
  for (let i = 0; i < n; i++) {
    const abs = Math.abs(buffer[i]);
    if (abs > max) max = abs;
  }
  return max;
}

/**
 * Magnitude of a reported peak: NaN reads as silence, ±Infinity as the
 * non-finite over.
 *
 * @param {number} peak - Linear peak
 * @returns {number} Non-negative linear peak
 */
function sanitisePeak(peak) {
  if (typeof peak !== 'number' || Number.isNaN(peak)) return 0;
  if (!Number.isFinite(peak)) return NON_FINITE_PEAK;
  return peak < 0 ? -peak : peak;
}

/**
 * @typedef {Object} SamplePeakMeterState
 * @property {number} dbfsLeft - Current left channel bar reading in dBFS
 * @property {number} dbfsRight - Current right channel bar reading in dBFS
 * @property {number} dbfsHoldLeft - Peak hold left channel in dBFS
 * @property {number} dbfsHoldRight - Peak hold right channel in dBFS
 * @property {number} dbfsMax - Maximum peak since reset in dBFS
 * @property {boolean} isClipLeft - Left channel has clipped (0 dBFS)
 * @property {boolean} isClipRight - Right channel has clipped (0 dBFS)
 * @property {boolean} isClipAny - Either channel has clipped
 */
