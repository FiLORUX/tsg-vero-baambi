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
 *   > 48 kHz        2× (branches 0 and 2, half an input sample apart), the
 *                   ratio Annex 2 names as sufficient for 96 kHz input
 *
 * Tech 3341 defines its signals relative to fs (fs/4, fs/6, fs/8), so at a
 * higher rate the same sample sequences recur at proportionally higher
 * frequencies. With 2× all nine cases stay within tolerance at 96 and
 * 192 kHz; without over-sampling at 192 kHz seven of them would fail (case 16
 * would read −9.0 dBTP), which is why the ratio never drops to 1×.
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
 * That presumes gap-free blocks. TruePeakMeter accepts three feeds:
 *
 *   updateFromPeaks()   linear peaks already measured on every sample, for
 *                       example by the stereo-sampler AudioWorklet. This is
 *                       the sample-complete path and the one src/app uses
 *                       whenever the worklet or ScriptProcessor sampler runs.
 *   update(), default   a rolling window of recent samples (AnalyserNode).
 *                       Each window is measured on its own, because splicing
 *                       overlapping windows through a shared history reads the
 *                       join as a peak (+1.3 dB on a full-scale 1 kHz sine).
 *                       Coverage is complete only while windows overlap.
 *   update(), contiguous: true
 *                       gap-free consecutive blocks, measured through the
 *                       carried history.
 *
 * BALLISTICS
 * ──────────
 * TPmax, peak hold and the over indication are taken from the unsmoothed
 * over-sampled peak of each update, so a single inter-sample over is never
 * lost to display smoothing. Only the bar reading has ballistics: it rises
 * instantly to a new peak and falls at a fixed rate in dB per second
 * (default 20 dB in 1.7 s, the IEC 60268-10 return time), independent of
 * how often update() is called.
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
 * Default fall rate of the bar reading: 20 dB in 1.7 s (IEC 60268-10 return
 * time), roughly 11.76 dB per second.
 * @type {number}
 */
export const TP_RELEASE_DB_PER_SECOND = 20 / 1.7;

/**
 * Lowest bar and hold reading in dBTP; matches the bottom of the bar scale.
 * @type {number}
 */
export const TP_DISPLAY_FLOOR_DB = -60;

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
 * rate needs proportionately less: 2× for 96 kHz. Above 96 kHz the ratio
 * stays at 2×, because the Tech 3341 signals are defined relative to fs and
 * need an evaluation point half-way between samples at every rate. An
 * invalid rate is treated as 48 kHz.
 *
 * @param {number} sampleRate - Input sample rate in Hz
 * @returns {4|2} Over-sampling ratio
 */
export function oversamplingFactor(sampleRate) {
  return !(sampleRate > 0) || sampleRate <= 48000 ? 4 : 2;
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
 * @returns {Float64Array[]} Branches to evaluate
 */
function branchesForFactor(factor) {
  return factor === 4
    ? [...BS1770_TRUE_PEAK_COEFFICIENTS]
    : [BS1770_TRUE_PEAK_COEFFICIENTS[0], BS1770_TRUE_PEAK_COEFFICIENTS[2]];
}

/**
 * Polyphase branches to evaluate for a given input sample rate.
 *
 * Returns independent copies, suitable for transfer to an AudioWorklet
 * through processorOptions.
 *
 * @param {number} sampleRate - Input sample rate in Hz
 * @returns {Float64Array[]} Branch coefficient arrays, hₚ[0] applied to the newest sample
 */
export function interpolationBranches(sampleRate) {
  return branchesForFactor(oversamplingFactor(sampleRate)).map(branch => Float64Array.from(branch));
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
   * Over-sampling ratio in use (4 or 2).
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
    if (n < BS1770_TAPS_PER_PHASE) return samplePeak(buffer);
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
 * Monotonic clock in milliseconds.
 * @returns {number}
 */
const monotonicMs = () => performance.now();

/**
 * True Peak Meter with bar ballistics, peak hold, TPmax and over indication.
 *
 * TPmax, the per-channel maxima, peak hold and the over indication are
 * derived from the unsmoothed over-sampled peak of every update. The bar
 * reading (dbtpLeft/dbtpRight) rises instantly and falls at
 * releaseDbPerSecond, measured on the meter's clock.
 *
 * @example
 * const tpMeter = new TruePeakMeter({ limit: -1.0, sampleRate: ac.sampleRate });
 *
 * // Sample-complete feed: peaks measured on every sample by the sampler
 * const { left, right } = stereoSampler.consumeTruePeaks();
 * tpMeter.updateFromPeaks(left, right);
 *
 * // Window feed: the most recent analyser samples
 * analyserL.getFloatTimeDomainData(bufferL);
 * analyserR.getFloatTimeDomainData(bufferR);
 * tpMeter.update(bufferL, bufferR);
 *
 * const { dbtpLeft, dbtpRight, dbtpMax, isOverAny } = tpMeter.getState();
 */
export class TruePeakMeter {
  /** @type {TruePeakDetector} */
  #detectorL;

  /** @type {TruePeakDetector} */
  #detectorR;

  /** @type {() => number} */
  #now;

  /** @type {number|null} Clock reading of the previous update in seconds */
  #lastUpdateSeconds = null;

  /** @type {Set<{left: number, right: number}>} Open peak readers */
  #readers = new Set();

  /**
   * @param {Object} options - Configuration options
   * @param {number} [options.limit=TP_LIMIT_EBU] - True Peak limit for over detection
   * @param {number} [options.peakHoldSeconds=PEAK_HOLD_SECONDS] - Peak hold duration
   * @param {number} [options.releaseDbPerSecond=TP_RELEASE_DB_PER_SECOND] - Fall rate of the bar reading
   * @param {number} [options.sampleRate=48000] - Input sample rate in Hz (selects the over-sampling ratio)
   * @param {boolean} [options.contiguous=false] - True when successive update() buffers
   *   are gap-free consecutive blocks; false when each buffer is a rolling window
   *   of the most recent samples (AnalyserNode / ring buffer)
   * @param {string} [options.mode='polyphase'] - Accepted for API stability; see TRUE_PEAK_MODE
   * @param {() => number} [options.now] - Monotonic clock in milliseconds (performance.now by default)
   */
  constructor({
    limit = TP_LIMIT_EBU,
    peakHoldSeconds = PEAK_HOLD_SECONDS,
    releaseDbPerSecond = TP_RELEASE_DB_PER_SECOND,
    sampleRate = DEFAULT_SAMPLE_RATE,
    contiguous = false,
    mode = TRUE_PEAK_MODE.POLYPHASE,
    now = monotonicMs
  } = {}) {
    this.limit = limit;
    this.peakHoldSeconds = peakHoldSeconds;
    this.releaseDbPerSecond = releaseDbPerSecond;
    this.sampleRate = sampleRate;
    this.contiguous = contiguous;
    this.mode = TRUE_PEAK_MODE.POLYPHASE;
    this.setMode(mode);

    this.#now = now;
    this.#detectorL = new TruePeakDetector(sampleRate);
    this.#detectorR = new TruePeakDetector(sampleRate);

    // Bar readings (instant attack, timed release)
    this.smoothL = TP_DISPLAY_FLOOR_DB;
    this.smoothR = TP_DISPLAY_FLOOR_DB;

    // Peak hold state (from unsmoothed peaks)
    this.peakHoldL = TP_DISPLAY_FLOOR_DB;
    this.peakHoldR = TP_DISPLAY_FLOOR_DB;
    this.peakTimeL = 0;
    this.peakTimeR = 0;

    // Over indicator (latched until reset)
    this.isOver = false;

    // Maximum true-peak level since reset (TPmax), per channel and combined
    this.maxPeakL = -Infinity;
    this.maxPeakR = -Infinity;
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
   * @returns {number} 4 or 2
   */
  getOversamplingFactor() {
    return this.#detectorL.oversamplingFactor;
  }

  /**
   * Measure new audio buffers and update the meter.
   *
   * @param {Float32Array} leftBuffer - Left channel samples
   * @param {Float32Array} rightBuffer - Right channel samples
   */
  update(leftBuffer, rightBuffer) {
    this.#apply(this.#measure(this.#detectorL, leftBuffer), this.#measure(this.#detectorR, rightBuffer));
  }

  /**
   * Update the meter with peaks measured elsewhere on every sample.
   *
   * The values are the largest over-sampled absolute values (linear) of all
   * samples since the previous call, as produced by TruePeakDetector. Pass
   * zero when no samples arrived; the bar then only falls.
   *
   * @param {number} [peakLeft=0] - Left channel peak, linear
   * @param {number} [peakRight=0] - Right channel peak, linear
   */
  updateFromPeaks(peakLeft = 0, peakRight = 0) {
    this.#apply(sanitisePeak(peakLeft), sanitisePeak(peakRight));
  }

  /**
   * Create an independent reader of the unsmoothed peaks.
   *
   * A consumer that samples the meter on its own schedule (a network sender,
   * a logger) would otherwise see only the bar reading at that instant and
   * miss a peak that has already begun to fall. Each reader accumulates the
   * largest unsmoothed level per channel since its own previous take().
   *
   * @returns {TruePeakReader} Reader handle
   */
  createPeakReader() {
    const pending = { left: -Infinity, right: -Infinity };
    this.#readers.add(pending);
    return {
      take: () => {
        const peaks = { left: pending.left, right: pending.right };
        pending.left = -Infinity;
        pending.right = -Infinity;
        return peaks;
      },
      close: () => {
        this.#readers.delete(pending);
      }
    };
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
      dbtpMaxLeft: this.maxPeakL,
      dbtpMaxRight: this.maxPeakR,
      isOverLeft,
      isOverRight,
      isOverAny: isOverLeft || isOverRight
    };
  }

  /**
   * Reset peak hold, TPmax, over indicator and the filter history.
   */
  reset() {
    this.peakHoldL = TP_DISPLAY_FLOOR_DB;
    this.peakHoldR = TP_DISPLAY_FLOOR_DB;
    this.maxPeakL = -Infinity;
    this.maxPeakR = -Infinity;
    this.maxPeak = -Infinity;
    this.isOver = false;
    this.#detectorL.reset();
    this.#detectorR.reset();
  }

  /**
   * Apply one pair of unsmoothed linear peaks to readings, holds and TPmax.
   *
   * @param {number} peakL - Left channel peak, linear
   * @param {number} peakR - Right channel peak, linear
   */
  #apply(peakL, peakR) {
    const nowSeconds = this.#now() / 1000;
    const elapsed = this.#lastUpdateSeconds === null ? 0 : Math.max(0, nowSeconds - this.#lastUpdateSeconds);
    this.#lastUpdateSeconds = nowSeconds;

    const rawL = amplitudeToDbTP(peakL);
    const rawR = amplitudeToDbTP(peakR);

    // Bar reading: instant attack, fixed release rate in dB per second
    const fall = this.releaseDbPerSecond * elapsed;
    this.smoothL = Math.max(rawL, this.smoothL - fall, TP_DISPLAY_FLOOR_DB);
    this.smoothR = Math.max(rawR, this.smoothR - fall, TP_DISPLAY_FLOOR_DB);

    // Peak hold from the unsmoothed peak; after the hold time it follows the bar
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

    // Independent readers see every unsmoothed peak since their last take()
    for (const pending of this.#readers) {
      if (rawL > pending.left) pending.left = rawL;
      if (rawR > pending.right) pending.right = rawR;
    }

    // TPmax and the latched over indication from the unsmoothed peak
    if (rawL > this.maxPeakL) this.maxPeakL = rawL;
    if (rawR > this.maxPeakR) this.maxPeakR = rawR;
    this.maxPeak = Math.max(this.maxPeakL, this.maxPeakR);
    if (this.maxPeak >= this.limit) {
      this.isOver = true;
    }
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
 * Coerce an externally supplied peak to a non-negative finite value.
 *
 * NaN (a broken upstream measurement) reads as silence rather than poisoning
 * the maxima; +Infinity is kept so a non-finite signal still shows as an over.
 *
 * @param {number} peak - Linear peak
 * @returns {number} Sanitised linear peak
 */
function sanitisePeak(peak) {
  if (Number.isNaN(peak) || typeof peak !== 'number') return 0;
  return peak < 0 ? -peak : peak;
}

/**
 * @typedef {Object} TruePeakReader
 * @property {() => {left: number, right: number}} take - Largest unsmoothed
 *   levels in dBTP since the previous take(); −Infinity when no update occurred
 * @property {() => void} close - Detach the reader from the meter
 */

/**
 * @typedef {Object} TruePeakMeterState
 * @property {number} dbtpLeft - Left bar reading (dBTP, instant attack, timed release)
 * @property {number} dbtpRight - Right bar reading (dBTP, instant attack, timed release)
 * @property {number} dbtpHoldLeft - Peak hold left (dBTP, 3s)
 * @property {number} dbtpHoldRight - Peak hold right (dBTP, 3s)
 * @property {number} dbtpMax - Maximum True Peak since reset, both channels (dBTP)
 * @property {number} dbtpMaxLeft - Maximum left True Peak since reset (dBTP)
 * @property {number} dbtpMaxRight - Maximum right True Peak since reset (dBTP)
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
