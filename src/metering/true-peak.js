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
 * TRUE-PEAK MEASUREMENT (ITU-R BS.1770-4 ANNEX 2 / EBU R 128)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * ───────
 * A sampled signal can peak between its samples. The waveform reconstructed by
 * a D/A converter, a sample-rate converter or a codec may therefore exceed the
 * largest sample value, and a sample-peak meter under-reads by up to 3 dB for
 * content near fs/4. True-peak metering estimates the continuous-time maximum
 * so that the EBU R 128 ceiling of −1 dBTP can be held with confidence.
 *
 * METHOD (ITU-R BS.1770-4 Annex 2)
 * ────────────────────────────────
 *   1. Over-sample by four (48 kHz → 192 kHz) with the 48-tap FIR interpolation
 *      filter tabulated in Annex 2, realised as four 12-tap polyphase branches.
 *      Each branch evaluates the reconstructed waveform at one of four evenly
 *      spaced instants per input sample period.
 *   2. Take the absolute value of every over-sampled output.
 *   3. The true-peak level is the maximum of those values, converted to dB TP
 *      with 20·log10. The 12.04 dB attenuation stage of Annex 2 only provides
 *      headroom for integer arithmetic and is omitted in floating point.
 *
 * SAMPLE RATES
 * ────────────
 *   ≤ 48 kHz        4× (all four branches)
 *   88.2 / 96 kHz   2× (branches 0 and 2, half an input sample apart), the
 *                   ratio Annex 2 names as sufficient for 96 kHz input
 *   ≥ 176.4 kHz     no over-sampling; the sample peak already satisfies the
 *                   ≥ 192 kHz criterion of Annex 2
 *
 * ACCURACY
 * ────────
 * EBU Tech 3341 test cases 15 to 23 read within +0.2/−0.4 dB
 * (tests/true-peak-test.js). The Annex 2 filter has ≈ ±0.3 dB passband ripple
 * below 20 kHz and rolls off above it (−0.5 dB at 22 kHz); every meter built
 * on the tabulated filter shares these figures, and the EBU tolerance
 * explicitly includes them.
 *
 * FEEDING THE METER
 * ─────────────────
 * TruePeakDetector is a stream processor: it keeps the last eleven input
 * samples so that a peak straddling two consecutive blocks is still found.
 * That presumes gap-free blocks. TruePeakMeter.update() defaults to window
 * semantics because src/app feeds it a rolling window of the most recent
 * samples (AnalyserNode or worklet ring buffer): consecutive windows overlap,
 * and splicing them through a shared history would read the discontinuity as
 * a peak (+1.3 dB measured on a full-scale 1 kHz sine). Pass
 * { contiguous: true } when consecutive update() buffers follow each other
 * without gap or overlap.
 *
 * TRUE PEAK LIMITS (Broadcast standards)
 * ──────────────────────────────────────
 *   EBU R128:     −1.0 dBTP (broadcast)
 *   Streaming:    −2.0 dBTP (lossy codec headroom)
 *   Safe master:  −3.0 dBTP (extra safety margin)
 *
 * @module metering/true-peak
 * @see ITU-R BS.1770-4 Annex 2 (Guidelines for accurate measurement of true-peak level)
 * @see EBU Tech 3341 §2.6 and Table 1, cases 15–23 (true-peak minimum requirements)
 * @see EBU R 128 (maximum permitted true-peak level −1 dBTP)
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
 * Peak hold duration in seconds (RTW-style 3s hold).
 * @type {number}
 */
export const PEAK_HOLD_SECONDS = 3;

/**
 * Polyphase branches of the Annex 2 interpolator (4× over-sampling).
 * @type {number}
 */
export const BS1770_PHASES = 4;

/**
 * Taps per polyphase branch (48-tap prototype ÷ 4 branches).
 * @type {number}
 */
export const BS1770_TAPS_PER_PHASE = 12;

/**
 * Input samples the filter must remember between blocks (taps − 1).
 * @type {number}
 */
const HISTORY_LENGTH = BS1770_TAPS_PER_PHASE - 1;

/**
 * Sample rate assumed when a caller does not state one.
 * @type {number}
 */
const DEFAULT_SAMPLE_RATE = 48000;

/**
 * Zero block used to drain the filter at the end of a complete signal.
 * @type {Float32Array}
 */
const FLUSH_BLOCK = new Float32Array(HISTORY_LENGTH);

// ─────────────────────────────────────────────────────────────────────────────
// ITU-R BS.1770-4 ANNEX 2 INTERPOLATION FILTER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The four 12-tap polyphase branches of the 48-tap, 4× over-sampling FIR
 * interpolation filter, verbatim from ITU-R BS.1770-4 Annex 2 §3.
 *
 * Branch p produces the over-sampled output y[4n + p] = Σₖ hₚ[k] · x[n − k],
 * k = 0..11, with hₚ[0] applied to the newest input sample. Interleaving the
 * branches restores the linear-phase prototype (h[4k + p] = hₚ[k]), which is
 * why branch 3 mirrors branch 0 and branch 2 mirrors branch 1: reversing the
 * tap order merely swaps those pairs and leaves the measured maximum unchanged.
 *
 * Every value is an integer multiple of 2⁻¹³; the table is exact in binary
 * floating point, so the filter behaves identically in every implementation.
 * DC gain is 1.0016 for branches 0 and 3 and 0.9730 for branches 1 and 2;
 * this ripple is part of the standard's filter and lies inside the EBU
 * Tech 3341 tolerance of +0.2/−0.4 dB.
 *
 * @type {ReadonlyArray<Float64Array>}
 * @see ITU-R BS.1770-4 Annex 2 §3 (Detailed description)
 */
export const BS1770_TRUE_PEAK_COEFFICIENTS = Object.freeze([
  // Phase 0
  Float64Array.from([
    0.0017089843750, 0.0109863281250, -0.0196533203125, 0.0332031250000,
    -0.0594482421875, 0.1373291015625, 0.9721679687500, -0.1022949218750,
    0.0476074218750, -0.0266113281250, 0.0148925781250, -0.0083007812500
  ]),
  // Phase 1
  Float64Array.from([
    -0.0291748046875, 0.0292968750000, -0.0517578125000, 0.0891113281250,
    -0.1665039062500, 0.4650878906250, 0.7797851562500, -0.2003173828125,
    0.1015625000000, -0.0582275390625, 0.0330810546875, -0.0189208984375
  ]),
  // Phase 2
  Float64Array.from([
    -0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625000000,
    -0.2003173828125, 0.7797851562500, 0.4650878906250, -0.1665039062500,
    0.0891113281250, -0.0517578125000, 0.0292968750000, -0.0291748046875
  ]),
  // Phase 3
  Float64Array.from([
    -0.0083007812500, 0.0148925781250, -0.0266113281250, 0.0476074218750,
    -0.1022949218750, 0.9721679687500, 0.1373291015625, -0.0594482421875,
    0.0332031250000, -0.0196533203125, 0.0109863281250, 0.0017089843750
  ])
]);

/**
 * Over-sampling ratio the Annex 2 method requires for a given input rate.
 *
 * Annex 2 presumes 48 kHz and a 4× ratio, and states that input at a higher
 * rate needs proportionately less: 2× for 96 kHz. The ratios below keep the
 * over-sampled rate at or above the 192 kHz the Annex names as the basis for
 * the dB TP scale. An invalid rate is treated as 48 kHz so that a meter never
 * degrades to sample peak by accident.
 *
 * @param {number} sampleRate - Input sample rate in Hz
 * @returns {4|2|1} Over-sampling ratio
 */
export function oversamplingFactor(sampleRate) {
  if (!(sampleRate > 0) || sampleRate <= 48000) return 4;
  if (sampleRate <= 96000) return 2;
  return 1;
}

/**
 * Select the polyphase branches for an over-sampling ratio.
 *
 * With 2× over-sampling every second branch is used: branches 0 and 2 sit
 * half an input sample apart, which is exactly the 2× grid. The branch
 * coefficients themselves need no change because the interpolation kernel
 * scales with the input sample period.
 *
 * @param {number} factor - Over-sampling ratio from oversamplingFactor()
 * @returns {Float64Array[]} Branches to evaluate (empty for sample peak)
 */
function branchesForFactor(factor) {
  if (factor === 4) return [...BS1770_TRUE_PEAK_COEFFICIENTS];
  if (factor === 2) return [BS1770_TRUE_PEAK_COEFFICIENTS[0], BS1770_TRUE_PEAK_COEFFICIENTS[2]];
  return [];
}

/**
 * Largest absolute sample value in a buffer.
 *
 * @param {ArrayLike<number>} buffer - Audio samples
 * @returns {number} Sample peak, linear
 */
function samplePeak(buffer) {
  let max = 0;
  for (let i = 0; i < buffer.length; i++) {
    const abs = buffer[i] < 0 ? -buffer[i] : buffer[i];
    if (abs > max) max = abs;
  }
  return max;
}

/**
 * Largest absolute over-sampled output for output indices [from, to).
 *
 * Output i of branch h reads x[i − k] for k = 0..11, so `from` must be at
 * least HISTORY_LENGTH for the lookback to stay inside the array.
 *
 * @param {ArrayLike<number>} x - Input samples, including any history prefix
 * @param {number} from - First output index (inclusive)
 * @param {number} to - Last output index (exclusive)
 * @param {Float64Array[]} branches - Polyphase branches to evaluate
 * @returns {number} Over-sampled peak, linear
 */
function branchMaximum(x, from, to, branches) {
  let max = 0;
  for (const h of branches) {
    for (let i = from; i < to; i++) {
      let acc = 0;
      for (let k = 0; k < BS1770_TAPS_PER_PHASE; k++) {
        acc += h[k] * x[i - k];
      }
      const abs = acc < 0 ? -acc : acc;
      if (abs > max) max = abs;
    }
  }
  return max;
}

// ─────────────────────────────────────────────────────────────────────────────
// STREAMING DETECTOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ITU-R BS.1770-4 Annex 2 true-peak detector for a single channel.
 *
 * `process()` treats successive buffers as one gap-free stream: the last
 * eleven input samples are carried over, so an inter-sample peak between the
 * final sample of one block and the first sample of the next is measured
 * exactly as it would be in a single pass. The result is independent of block
 * size, down to one sample per call.
 *
 * `measureWindow()` treats a buffer as a self-contained rolling window and
 * keeps no state. Outputs that would need samples from before the window are
 * not evaluated, which is correct for overlapping windows because those
 * samples were interior to an earlier window.
 *
 * @example
 * const detector = new TruePeakDetector(48000);
 * let peak = 0;
 * for (const block of blocks) peak = Math.max(peak, detector.process(block));
 * peak = Math.max(peak, detector.flush());
 * console.log(`${amplitudeToDbTP(peak).toFixed(1)} dBTP`);
 */
export class TruePeakDetector {
  /** @type {number} */
  #sampleRate;

  /** @type {number} */
  #factor;

  /** @type {Float64Array[]} */
  #branches;

  /** @type {Float64Array} */
  #history = new Float64Array(HISTORY_LENGTH);

  /** @type {Float64Array} */
  #scratch = new Float64Array(0);

  /**
   * @param {number} [sampleRate=48000] - Input sample rate in Hz
   */
  constructor(sampleRate = DEFAULT_SAMPLE_RATE) {
    this.#sampleRate = sampleRate;
    this.#factor = oversamplingFactor(sampleRate);
    this.#branches = branchesForFactor(this.#factor);
  }

  /**
   * Input sample rate in Hz.
   * @type {number}
   */
  get sampleRate() {
    return this.#sampleRate;
  }

  /**
   * Over-sampling ratio in use (4, 2 or 1).
   * @type {number}
   */
  get oversamplingFactor() {
    return this.#factor;
  }

  /**
   * Forget the carried history. Call between unrelated signals.
   */
  reset() {
    this.#history.fill(0);
  }

  /**
   * Measure the next block of a gap-free stream.
   *
   * @param {ArrayLike<number>} buffer - Samples following the previous call's
   * @returns {number} Largest over-sampled absolute value in this block, linear
   */
  process(buffer) {
    const n = buffer.length;
    if (n === 0) return 0;
    if (this.#branches.length === 0) return samplePeak(buffer);

    // Prefix the block with the carried history so that the first outputs
    // see the samples that preceded them.
    const extended = this.#extend(buffer);
    const peak = branchMaximum(extended, HISTORY_LENGTH, HISTORY_LENGTH + n, this.#branches);

    // The last eleven samples of the extended block become the next history.
    this.#history.set(extended.subarray(n, n + HISTORY_LENGTH));
    return peak;
  }

  /**
   * Drain the filter with silence after the final block of a complete signal.
   *
   * The interpolator is causal with a group delay of about six input samples,
   * so the values between the last few samples are only evaluated once
   * further input arrives. Feeding eleven zeros completes the reconstruction
   * of the signal's tail and leaves the history cleared.
   *
   * @returns {number} Largest over-sampled absolute value in the tail, linear
   */
  flush() {
    return this.process(FLUSH_BLOCK);
  }

  /**
   * Measure a self-contained window without touching the stream state.
   *
   * Windows shorter than the filter length cannot produce a fully warmed
   * output and fall back to sample peak.
   *
   * @param {ArrayLike<number>} buffer - Rolling window of recent samples
   * @returns {number} Largest over-sampled absolute value, linear
   */
  measureWindow(buffer) {
    const n = buffer.length;
    if (n === 0) return 0;
    if (this.#branches.length === 0 || n < BS1770_TAPS_PER_PHASE) return samplePeak(buffer);
    return branchMaximum(buffer, HISTORY_LENGTH, n, this.#branches);
  }

  /**
   * Copy history followed by the block into a reusable scratch array.
   *
   * @param {ArrayLike<number>} buffer - Current block
   * @returns {Float64Array} History prefix followed by the block
   */
  #extend(buffer) {
    const needed = HISTORY_LENGTH + buffer.length;
    if (this.#scratch.length < needed) {
      this.#scratch = new Float64Array(needed);
    }
    const extended = this.#scratch;
    extended.set(this.#history, 0);
    extended.set(buffer, HISTORY_LENGTH);
    return extended;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ONE-SHOT MEASUREMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * True-peak level of a complete signal held in one buffer.
 *
 * The buffer is treated as the whole signal, with silence before and after:
 * the filter starts from a cleared history and is drained at the end, so
 * peaks at both edges are included.
 *
 * @param {ArrayLike<number>} buffer - Audio samples
 * @param {number} [sampleRate=48000] - Sample rate in Hz (selects 4×, 2× or 1×)
 * @returns {number} True Peak in dBTP (−Infinity for an empty buffer)
 *
 * @example
 * const truePeak = calculateTruePeak(samples, 48000);
 * console.log(`True Peak: ${truePeak.toFixed(1)} dBTP`);
 */
export function calculateTruePeak(buffer, sampleRate = DEFAULT_SAMPLE_RATE) {
  if (!buffer || buffer.length === 0) return -Infinity;

  const detector = new TruePeakDetector(sampleRate);
  const peak = Math.max(detector.process(buffer), detector.flush());
  return amplitudeToDbTP(peak);
}

/**
 * True-peak level of a complete stereo signal.
 *
 * @param {ArrayLike<number>} leftBuffer - Left channel samples
 * @param {ArrayLike<number>} rightBuffer - Right channel samples
 * @param {number} [sampleRate=48000] - Sample rate in Hz
 * @returns {TruePeakStereo} Per-channel and combined True Peak
 */
export function calculateTruePeakStereo(leftBuffer, rightBuffer, sampleRate = DEFAULT_SAMPLE_RATE) {
  const left = calculateTruePeak(leftBuffer, sampleRate);
  const right = calculateTruePeak(rightBuffer, sampleRate);
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
 * Measurement modes accepted by TruePeakMeter.
 *
 * The meter has a single method, the ITU-R BS.1770-4 Annex 2 polyphase FIR.
 * The enumeration remains so that stored preferences and existing callers
 * keep working; any other value is ignored.
 *
 * @readonly
 * @enum {string}
 */
export const TRUE_PEAK_MODE = {
  /** ITU-R BS.1770-4 Annex 2 compliant polyphase FIR. */
  POLYPHASE: 'polyphase'
};

/**
 * True Peak Meter with smoothing and peak hold.
 *
 * Provides broadcast-style metering with:
 * - Instantaneous True Peak (smoothed for display stability)
 * - 3-second peak hold (RTW/DK convention)
 * - Over indicator with latch
 *
 * @example
 * const tpMeter = new TruePeakMeter({ limit: -1.0, sampleRate: ac.sampleRate });
 *
 * // In animation loop:
 * analyserL.getFloatTimeDomainData(bufferL);
 * analyserR.getFloatTimeDomainData(bufferR);
 * tpMeter.update(bufferL, bufferR);
 *
 * const { dbtpLeft, dbtpRight, dbtpHoldLeft, dbtpHoldRight, isOverAny } = tpMeter.getState();
 */
export class TruePeakMeter {
  /** @type {TruePeakDetector} */
  #detectorL;

  /** @type {TruePeakDetector} */
  #detectorR;

  /**
   * @param {Object} options - Configuration options
   * @param {number} [options.limit=TP_LIMIT_EBU] - True Peak limit for over detection
   * @param {number} [options.smoothing=0.25] - Smoothing factor (0-1, higher = faster)
   * @param {number} [options.peakHoldSeconds=PEAK_HOLD_SECONDS] - Peak hold duration
   * @param {number} [options.sampleRate=48000] - Input sample rate in Hz (selects the over-sampling ratio)
   * @param {boolean} [options.contiguous=false] - True when successive update() buffers
   *   are gap-free consecutive blocks; false when each buffer is a rolling window
   *   of the most recent samples (AnalyserNode / ring buffer)
   * @param {string} [options.mode='polyphase'] - Accepted for API stability; see TRUE_PEAK_MODE
   */
  constructor({
    limit = TP_LIMIT_EBU,
    smoothing = 0.25,
    peakHoldSeconds = PEAK_HOLD_SECONDS,
    sampleRate = DEFAULT_SAMPLE_RATE,
    contiguous = false,
    mode = TRUE_PEAK_MODE.POLYPHASE
  } = {}) {
    this.limit = limit;
    this.smoothing = smoothing;
    this.peakHoldSeconds = peakHoldSeconds;
    this.sampleRate = sampleRate;
    this.contiguous = contiguous;
    this.mode = TRUE_PEAK_MODE.POLYPHASE;
    this.setMode(mode);

    this.#detectorL = new TruePeakDetector(sampleRate);
    this.#detectorR = new TruePeakDetector(sampleRate);

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
   * Set the measurement mode.
   *
   * Only TRUE_PEAK_MODE.POLYPHASE exists; other values are ignored so that a
   * stale stored preference cannot take the meter out of conformance.
   *
   * @param {string} mode - A value of TRUE_PEAK_MODE
   */
  setMode(mode) {
    if (mode === TRUE_PEAK_MODE.POLYPHASE) {
      this.mode = mode;
    }
  }

  /**
   * Get the current measurement mode.
   *
   * @returns {string} A value of TRUE_PEAK_MODE
   */
  getMode() {
    return this.mode;
  }

  /**
   * Over-sampling ratio derived from the configured sample rate.
   *
   * @returns {number} 4, 2 or 1
   */
  getOversamplingFactor() {
    return this.#detectorL.oversamplingFactor;
  }

  /**
   * Update meter with new audio buffers.
   *
   * @param {Float32Array} leftBuffer - Left channel samples
   * @param {Float32Array} rightBuffer - Right channel samples
   */
  update(leftBuffer, rightBuffer) {
    const rawL = amplitudeToDbTP(this.#measure(this.#detectorL, leftBuffer));
    const rawR = amplitudeToDbTP(this.#measure(this.#detectorR, rightBuffer));

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
    const isOverLeft = this.peakHoldL >= this.limit;
    const isOverRight = this.peakHoldR >= this.limit;

    return {
      dbtpLeft: this.smoothL,
      dbtpRight: this.smoothR,
      dbtpHoldLeft: this.peakHoldL,
      dbtpHoldRight: this.peakHoldR,
      dbtpMax: this.maxPeak,
      isOverLeft,
      isOverRight,
      isOverAny: isOverLeft || isOverRight
    };
  }

  /**
   * Reset peak hold, over indicator and the filter history.
   */
  reset() {
    this.peakHoldL = -60;
    this.peakHoldR = -60;
    this.maxPeak = -Infinity;
    this.isOver = false;
    this.#detectorL.reset();
    this.#detectorR.reset();
  }

  /**
   * Measure one channel according to the configured feed semantics.
   *
   * @param {TruePeakDetector} detector - Channel detector
   * @param {Float32Array} buffer - Channel samples
   * @returns {number} Largest over-sampled absolute value, linear
   */
  #measure(detector, buffer) {
    if (!buffer || buffer.length === 0) return 0;
    return this.contiguous ? detector.process(buffer) : detector.measureWindow(buffer);
  }
}

/**
 * @typedef {Object} TruePeakMeterState
 * @property {number} dbtpLeft - Current left True Peak (dBTP)
 * @property {number} dbtpRight - Current right True Peak (dBTP)
 * @property {number} dbtpHoldLeft - Peak hold left (dBTP, 3s)
 * @property {number} dbtpHoldRight - Peak hold right (dBTP, 3s)
 * @property {number} dbtpMax - Maximum True Peak since reset (dBTP)
 * @property {boolean} isOverLeft - Left channel exceeded limit
 * @property {boolean} isOverRight - Right channel exceeded limit
 * @property {boolean} isOverAny - Either channel exceeded limit
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
    return ' --.- dBTP';
  }
  // Fixed-width format: pad to 5 chars for negative values (e.g., " -3.2" or "-12.5")
  return dbTP.toFixed(decimals).padStart(5, ' ') + ' dBTP';
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
