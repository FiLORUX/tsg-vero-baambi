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
 * NORDIC PPM METER (IEC 60268-10 TYPE I / NTP 177-800)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * ───────
 * Programme Peak Meter per Nordic/DIN standard as used by SVT, NRK, YLE, DR.
 * This quasi-peak meter type provides consistent level indication for speech
 * and music with standardized attack and decay ballistics.
 *
 * NOTE: This module is NORDIC PPM ONLY. BBC PPM (Type IIa) has separate
 * constants and functions with BBC_ prefix. Do not mix them.
 *
 * REFERENCE LEVELS (EBU R68)
 * ──────────────────────────
 *   0 PPM = 0 dBu = −18 dBFS (peak) – broadcast alignment tone level (TEST)
 *   PML (Permitted Maximum Level) = +9 PPM = +9 dBu = −9 dBFS
 *   Digital full scale = +18 PPM = +18 dBu = 0 dBFS
 *
 * CONVERSION (EBU R68)
 * ────────────────────
 *   PPM = dBFS + 18
 *   dBFS = PPM − 18
 *
 * BALLISTICS (IEC 60268-10 Type I)
 * ─────────────────────────────────
 *   Integration time: 5ms (quasi-peak detector, not true peak)
 *   Rise time to −1dB of steady-state: 5ms ± 0.5ms
 *   Fall time: 20dB in 1.7s ± 0.3s (linear decay ≈ 11.76 dB/s)
 *
 * SCALE (NTP 177-800 style)
 * ─────────────────────────
 *   Minimum: −40 PPM (−58 dBFS)
 *   Maximum: +18 PPM (0 dBFS) – digital full scale
 *   Range: 58 dB
 *   PML: +9 PPM (−9 dBFS) – operational limit, NOT scale maximum
 *
 * @module metering/ppm
 * @see IEC 60268-10 (Sound system equipment - Peak programme level meters)
 * @see EBU R68 (Alignment level in digital audio production equipment)
 * @see NTP 177-800 (Nordic PPM meter specification)
 * @see ITU-R BS.645 (Test signals and metering)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// NORDIC PPM CONSTANTS (IEC 60268-10 Type I / NTP 177-800)
// These are NORDIC-specific. BBC PPM uses separate BBC_* constants below.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nordic PPM quasi-peak integration time in milliseconds.
 * Time for meter to reach within 1dB of steady-state for a tone burst.
 * @type {number}
 */
export const NORDIC_PPM_ATTACK_MS = 5;

/**
 * Hysteresis threshold in dB to prevent meter instability.
 * Prevents constant attack/decay switching due to minor sample variations.
 * A constant tone should show a stable reading per IEC 60268-10.
 * NOTE: Used internally for Nordic PPM 'window' mode. RC mode handles this differently.
 * @type {number}
 */
const NORDIC_HYSTERESIS_DB = 0.1;

/**
 * Nordic PPM fall time: 20dB decay in 1.7 seconds.
 * @type {number}
 */
export const NORDIC_PPM_FALL_TIME_S = 1.7;

/**
 * Nordic PPM decay rate in dB per second.
 * Calculated as 20 / 1.7 ≈ 11.76 dB/s
 * @type {number}
 */
export const NORDIC_PPM_DECAY_DB_PER_S = 20 / NORDIC_PPM_FALL_TIME_S;

/**
 * Nordic PPM scale minimum in dBFS (NTP 177-800 style).
 * Corresponds to −40 PPM.
 * @type {number}
 */
export const NORDIC_PPM_MIN_DBFS = -58;

/**
 * Nordic PPM scale maximum in dBFS (NTP 177-800 style).
 * Corresponds to +18 PPM = 0 dBFS (digital full scale).
 * Note: PML (Permitted Maximum Level) is +9 PPM = −9 dBFS, but the
 * SCALE extends to +18 PPM to show overload above PML.
 * @type {number}
 */
export const NORDIC_PPM_MAX_DBFS = 0;

/**
 * Nordic PPM to dBFS offset (EBU R68).
 * PPM = dBFS + 18
 * @type {number}
 */
export const NORDIC_PPM_DBFS_OFFSET = 18;

/**
 * Nordic PPM peak hold duration in seconds (RTW/DK convention).
 * @type {number}
 */
export const NORDIC_PPM_PEAK_HOLD_S = 3;

// Legacy aliases for backwards compatibility (deprecated, use NORDIC_PPM_* instead)
/** @deprecated Use NORDIC_PPM_ATTACK_MS */
export const PPM_ATTACK_MS = NORDIC_PPM_ATTACK_MS;
/** @deprecated Use NORDIC_PPM_FALL_TIME_S */
export const PPM_FALL_TIME_S = NORDIC_PPM_FALL_TIME_S;
/** @deprecated Use NORDIC_PPM_DECAY_DB_PER_S */
export const PPM_DECAY_DB_PER_S = NORDIC_PPM_DECAY_DB_PER_S;
/** @deprecated Use NORDIC_PPM_MIN_DBFS */
export const PPM_MIN_DBFS = NORDIC_PPM_MIN_DBFS;
/** @deprecated Use NORDIC_PPM_MAX_DBFS */
export const PPM_MAX_DBFS = NORDIC_PPM_MAX_DBFS;
/** @deprecated Use NORDIC_PPM_DBFS_OFFSET */
export const PPM_DBFS_OFFSET = NORDIC_PPM_DBFS_OFFSET;
/** @deprecated Use NORDIC_PPM_PEAK_HOLD_S */
export const PPM_PEAK_HOLD_S = NORDIC_PPM_PEAK_HOLD_S;

/**
 * RC detector attack time constant in seconds.
 *
 * IEC 60268-10 Type I specifies that the meter shall reach within −1 dB of
 * steady-state value after 5 ms (±0.5 ms) of a tone burst.
 *
 * For an RC charging circuit:
 *
 *   V(t) = V_final × (1 − e^(−t/τ))
 *
 * At t = 5 ms, we require V(5ms) = 0.891 × V_final (−1 dB = 10^(−1/20) ≈ 0.8913).
 * Solving for τ:
 *
 *   0.891 = 1 − e^(−0.005/τ)
 *   e^(−0.005/τ) = 0.109
 *   τ = −0.005 / ln(0.109) = 0.005 / 2.216 ≈ 0.00226 s
 *
 * @type {number}
 * @see IEC 60268-10 Section 6.2 (Integration characteristics)
 */
export const RC_ATTACK_TIME_CONSTANT_S = 0.00226;

/**
 * Linear decay rate in dB per second.
 *
 * IEC 60268-10 Type I specifies 20 dB decay in 1.7 s (±0.3 s).
 * This is LINEAR decay on the dB scale, meaning a constant dB/s rate
 * regardless of current level.
 *
 * Rate = 20 dB / 1.7 s ≈ 11.76 dB/s
 *
 * Note: This is NOT equivalent to exponential decay in linear amplitude.
 * Exponential decay in linear domain gives non-constant dB/s rate.
 * The spec explicitly requires linear dB decay for consistent fall time.
 *
 * @type {number}
 * @see IEC 60268-10 Section 6.2 (Return characteristics)
 */
export const RC_DECAY_DB_PER_SECOND = 20 / NORDIC_PPM_FALL_TIME_S; // ≈ 11.76 dB/s

// ─────────────────────────────────────────────────────────────────────────────
// BBC PPM CONSTANTS (IEC 60268-10 TYPE IIa)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * BBC PPM integration time in milliseconds.
 * Type IIa uses 10 ms (vs Type I's 5 ms).
 * @type {number}
 */
export const BBC_ATTACK_MS = 10;

/**
 * BBC PPM fall time: 24 dB in 2.8 seconds.
 * @type {number}
 */
export const BBC_FALL_TIME_S = 2.8;

/**
 * BBC PPM decay rate in dB per second.
 * 24 dB / 2.8 s ≈ 8.57 dB/s (slower than Type I's 11.76 dB/s)
 * @type {number}
 */
export const BBC_DECAY_DB_PER_SECOND = 24 / BBC_FALL_TIME_S;

/**
 * BBC PPM RC attack time constant in seconds.
 *
 * IEC 60268-10 Type IIa specifies −2 dB at 10 ms.
 * −2 dB = 10^(−2/20) ≈ 0.794
 *
 * Solving: 0.794 = 1 − e^(−0.01/τ)
 *          e^(−0.01/τ) = 0.206
 *          τ = 0.01 / 1.58 ≈ 0.00633 s
 *
 * @type {number}
 * @see IEC 60268-10 Section 6.2 (Integration characteristics for Type IIa)
 */
export const BBC_ATTACK_TIME_CONSTANT_S = 0.00633;

/**
 * BBC PPM scale minimum in dBFS.
 * PPM 1 corresponds to −30 dBFS.
 * @type {number}
 */
export const BBC_MIN_DBFS = -30;

/**
 * BBC PPM scale maximum in dBFS.
 * PPM 7 corresponds to −6 dBFS.
 * @type {number}
 */
export const BBC_MAX_DBFS = -6;

// ─────────────────────────────────────────────────────────────────────────────
// QUASI-PEAK DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate quasi-peak level from audio buffer.
 *
 * Unlike true peak, quasi-peak uses an integration time that approximates
 * the behaviour of analogue PPM rectifier circuits. This provides consistent
 * readings for speech peaks while being less sensitive to transients.
 *
 * @param {Float32Array} buffer - Audio samples
 * @param {number} sampleRate - Sample rate in Hz
 * @returns {number} Quasi-peak level in dBFS
 *
 * @example
 * analyser.getFloatTimeDomainData(buffer);
 * const qp = calculateQuasiPeak(buffer, audioContext.sampleRate);
 */
export function calculateQuasiPeak(buffer, sampleRate) {
  // Guard: invalid or empty buffer
  if (!buffer || buffer.length === 0) return -Infinity;

  // Calculate integration window size in samples (5 ms for Nordic Type I)
  const windowSamples = Math.max(1, Math.round(sampleRate * NORDIC_PPM_ATTACK_MS / 1000));

  let maxPeak = 0;

  // Find maximum peak within integration windows
  for (let i = 0; i < buffer.length; i += windowSamples) {
    let windowMax = 0;
    const end = Math.min(i + windowSamples, buffer.length);

    for (let j = i; j < end; j++) {
      const abs = Math.abs(buffer[j]);
      if (abs > windowMax) windowMax = abs;
    }

    if (windowMax > maxPeak) maxPeak = windowMax;
  }

  // Convert to dBFS
  return 20 * Math.log10(maxPeak + 1e-12);
}

/**
 * Calculate quasi-peak for stereo buffers.
 *
 * @param {Float32Array} leftBuffer - Left channel samples
 * @param {Float32Array} rightBuffer - Right channel samples
 * @param {number} sampleRate - Sample rate in Hz
 * @returns {QuasiPeakStereo} Per-channel quasi-peak levels
 */
export function calculateQuasiPeakStereo(leftBuffer, rightBuffer, sampleRate) {
  return {
    left: calculateQuasiPeak(leftBuffer, sampleRate),
    right: calculateQuasiPeak(rightBuffer, sampleRate)
  };
}

/**
 * @typedef {Object} QuasiPeakStereo
 * @property {number} left - Left channel quasi-peak in dBFS
 * @property {number} right - Right channel quasi-peak in dBFS
 */

// ─────────────────────────────────────────────────────────────────────────────
// RC DETECTOR (IEC 60268-10 COMPLIANT)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} RCDetectorState
 * @property {number} envelope - Current envelope value (linear amplitude)
 * @property {number} peakDb - Current peak level in dB (for linear dB decay)
 * @property {Float32Array} [windowBuffer] - Rolling window buffer for peak detection
 * @property {number} [windowIdx] - Current index in rolling window
 */

/**
 * Process audio buffer through a quasi-peak detector per IEC 60268-10.
 *
 * This implements IEC 60268-10 Type I ballistics using:
 *   - RC charging model for attack (reaches −2 dB in 5 ms per spec)
 *   - Linear dB decay (20 dB / 1.7 s constant rate)
 *   - Rolling window peak detection to handle sine wave zero crossings
 *
 * The attack phase uses true RC circuit modelling:
 *
 *   V_new = V_old + α × (V_in − V_old)
 *
 * Where α = 1 − e^(−Δt/τ) with τ ≈ 2.26 ms.
 *
 * ALGORITHM (sample-by-sample with rolling window):
 *   1. Track peak over sliding window (integration time = 5 ms)
 *   2. Apply RC attack toward window peak (quasi-peak for transients)
 *   3. Apply decay only when window peak drops (not during sine dips)
 *
 * This ensures:
 *   - Continuous tones: window peak stays at true peak → correct level
 *   - Short transients: RC integrates over burst → under-reads per spec
 *   - Decay: only when signal actually drops, not at zero crossings
 *
 * @param {Float32Array} buffer - Audio samples
 * @param {number} sampleRate - Sample rate in Hz
 * @param {RCDetectorState} state - Persistent state object (modified in place)
 * @returns {number} Quasi-peak level in dBFS
 *
 * @see IEC 60268-10 Section 6.2 (Integration and return characteristics)
 */
export function calculateQuasiPeakRC(buffer, sampleRate, state) {
  // Guard: invalid or empty buffer
  if (!buffer || buffer.length === 0) {
    return state?.peakDb ?? -Infinity;
  }

  // Per-sample timing
  const dt = 1 / sampleRate;
  const attackCoeff = 1 - Math.exp(-dt / RC_ATTACK_TIME_CONSTANT_S);
  const decayDbPerSample = RC_DECAY_DB_PER_SECOND / sampleRate;

  // Integration window size (5 ms for Nordic Type I)
  const windowSamples = Math.ceil(sampleRate * NORDIC_PPM_ATTACK_MS / 1000);

  // Initialise state
  let envelope = state.envelope || 0;
  let peakDb = state.peakDb ?? -60;

  // Initialise rolling window buffer if needed
  if (!state.windowBuffer || state.windowBuffer.length !== windowSamples) {
    state.windowBuffer = new Float32Array(windowSamples);
    state.windowIdx = 0;
  }

  const windowBuffer = state.windowBuffer;
  let windowIdx = state.windowIdx;

  // Process each sample
  for (let i = 0; i < buffer.length; i++) {
    const rectified = Math.abs(buffer[i]);

    // Update rolling window
    windowBuffer[windowIdx] = rectified;
    windowIdx = (windowIdx + 1) % windowSamples;

    // Find peak in rolling window (O(windowSamples) but windowSamples is small ~240 at 48kHz)
    let windowPeak = 0;
    for (let j = 0; j < windowSamples; j++) {
      if (windowBuffer[j] > windowPeak) windowPeak = windowBuffer[j];
    }

    // Apply RC attack toward window peak
    if (windowPeak > envelope) {
      // Attack: RC charging toward window peak
      envelope += attackCoeff * (windowPeak - envelope);
      peakDb = 20 * Math.log10(envelope + 1e-12);
    } else if (windowPeak > envelope * 0.5) {
      // Signal present but below envelope: hold (no decay during continuous signal)
      // The 0.5 threshold means we hold if signal is within 6 dB of envelope
    } else {
      // Signal dropped significantly: apply linear dB decay
      peakDb -= decayDbPerSample;
      envelope = Math.pow(10, peakDb / 20);
      if (envelope < 1e-6) envelope = 1e-6;
    }
  }

  // Store state for next buffer
  state.envelope = envelope;
  state.peakDb = peakDb;
  state.windowIdx = windowIdx;

  return peakDb;
}

/**
 * Process stereo buffers through RC detector (Nordic Type I).
 *
 * @param {Float32Array} leftBuffer - Left channel samples
 * @param {Float32Array} rightBuffer - Right channel samples
 * @param {number} sampleRate - Sample rate in Hz
 * @param {{left: RCDetectorState, right: RCDetectorState}} state - Per-channel state
 * @returns {QuasiPeakStereo} Per-channel quasi-peak levels
 */
export function calculateQuasiPeakRCStereo(leftBuffer, rightBuffer, sampleRate, state) {
  return {
    left: calculateQuasiPeakRC(leftBuffer, sampleRate, state.left),
    right: calculateQuasiPeakRC(rightBuffer, sampleRate, state.right)
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BBC PPM QUASI-PEAK DETECTOR (IEC 60268-10 TYPE IIa)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process audio buffer through BBC PPM quasi-peak detector per IEC 60268-10 Type IIa.
 *
 * Key differences from Nordic (Type I):
 *   - Integration time: 10 ms (not 5 ms)
 *   - Attack τ: 6.33 ms (not 2.26 ms) — slower attack
 *   - Decay: 24 dB / 2.8 s = 8.57 dB/s (not 11.76 dB/s) — slower decay
 *
 * @param {Float32Array} buffer - Audio samples
 * @param {number} sampleRate - Sample rate in Hz
 * @param {RCDetectorState} state - Persistent state object (modified in place)
 * @returns {number} Quasi-peak level in dBFS
 *
 * @see IEC 60268-10 Section 6.2 (Type IIa characteristics)
 */
export function calculateBBCQuasiPeakRC(buffer, sampleRate, state) {
  // Guard: invalid or empty buffer
  if (!buffer || buffer.length === 0) {
    return state?.peakDb ?? -Infinity;
  }

  // Per-sample timing — BBC-SPECIFIC CONSTANTS
  const dt = 1 / sampleRate;
  const attackCoeff = 1 - Math.exp(-dt / BBC_ATTACK_TIME_CONSTANT_S);
  const decayDbPerSample = BBC_DECAY_DB_PER_SECOND / sampleRate;

  // Integration window size (10 ms for Type IIa — DIFFERENT FROM TYPE I's 5 ms)
  const windowSamples = Math.ceil(sampleRate * BBC_ATTACK_MS / 1000);

  // Initialise state
  let envelope = state.envelope || 0;
  let peakDb = state.peakDb ?? -60;

  // Initialise rolling window buffer if needed
  if (!state.windowBuffer || state.windowBuffer.length !== windowSamples) {
    state.windowBuffer = new Float32Array(windowSamples);
    state.windowIdx = 0;
  }

  const windowBuffer = state.windowBuffer;
  let windowIdx = state.windowIdx;

  // Process each sample
  for (let i = 0; i < buffer.length; i++) {
    const rectified = Math.abs(buffer[i]);

    // Update rolling window
    windowBuffer[windowIdx] = rectified;
    windowIdx = (windowIdx + 1) % windowSamples;

    // Find peak in rolling window
    let windowPeak = 0;
    for (let j = 0; j < windowSamples; j++) {
      if (windowBuffer[j] > windowPeak) windowPeak = windowBuffer[j];
    }

    // Apply RC attack toward window peak
    if (windowPeak > envelope) {
      // Attack: RC charging toward window peak (slower than Type I)
      envelope += attackCoeff * (windowPeak - envelope);
      peakDb = 20 * Math.log10(envelope + 1e-12);
    } else if (windowPeak > envelope * 0.5) {
      // Signal present but below envelope: hold (no decay during continuous signal)
      // The 0.5 threshold means we hold if signal is within 6 dB of envelope
    } else {
      // Signal dropped significantly: apply linear dB decay (slower than Type I)
      peakDb -= decayDbPerSample;
      envelope = Math.pow(10, peakDb / 20);
      if (envelope < 1e-6) envelope = 1e-6;
    }
  }

  // Store state for next buffer
  state.envelope = envelope;
  state.peakDb = peakDb;
  state.windowIdx = windowIdx;

  return peakDb;
}

/**
 * Process stereo buffers through BBC PPM detector (Type IIa).
 *
 * @param {Float32Array} leftBuffer - Left channel samples
 * @param {Float32Array} rightBuffer - Right channel samples
 * @param {number} sampleRate - Sample rate in Hz
 * @param {{left: RCDetectorState, right: RCDetectorState}} state - Per-channel state
 * @returns {QuasiPeakStereo} Per-channel quasi-peak levels in dBFS
 */
export function calculateBBCQuasiPeakRCStereo(leftBuffer, rightBuffer, sampleRate, state) {
  return {
    left: calculateBBCQuasiPeakRC(leftBuffer, sampleRate, state.left),
    right: calculateBBCQuasiPeakRC(rightBuffer, sampleRate, state.right)
  };
}

/**
 * Convert dBFS to BBC PPM scale.
 * BBC PPM: PPM 4 = 0 dBu = −18 dBFS (alignment level)
 * Scale: 4 dB per division, PPM 1 at −30 dBFS, PPM 7 at −6 dBFS
 *
 * @param {number} dbfs - Level in dBFS
 * @returns {number} Level in BBC PPM scale (1-7)
 */
export function dbfsToBBCPPM(dbfs) {
  // PPM = (dBFS + 18) / 4 + 4
  return (dbfs + 18) / 4 + 4;
}

/**
 * Convert BBC PPM scale to dBFS.
 *
 * @param {number} ppm - Level in BBC PPM scale
 * @returns {number} Level in dBFS
 */
export function bbcPpmToDbfs(ppm) {
  // dBFS = (PPM - 4) × 4 - 18
  return (ppm - 4) * 4 - 18;
}

// ─────────────────────────────────────────────────────────────────────────────
// PPM METER CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nordic PPM Meter with IEC 60268-10 Type I ballistics.
 *
 * Provides broadcast-standard Programme Peak Metering with:
 * - RC detector modelling analogue quasi-peak behaviour (default)
 * - 5 ms integration time (−1 dB after 5 ms tone burst)
 * - 20 dB / 1.7 s linear decay on dB scale
 * - 3-second peak hold (RTW/DK convention)
 *
 * Two detector modes are available:
 * - **'rc'** (default): True RC circuit model per IEC 60268-10, provides
 *   smooth analogue-style response with correct burst transient behaviour.
 * - **'window'**: Simplified window-maximum approach, faster but may
 *   over-read on fast transients.
 *
 * @example
 * const ppm = new PPMMeter({ sampleRate: 48000 });
 *
 * // In animation loop:
 * analyserL.getFloatTimeDomainData(bufferL);
 * analyserR.getFloatTimeDomainData(bufferR);
 * ppm.update(bufferL, bufferR);
 *
 * const { left, right, ppmLeft, ppmRight } = ppm.getState();
 */
export class PPMMeter {
  /** @type {number} */
  sampleRate;
  /** @type {number} */
  peakHoldSeconds;
  /** @type {'rc'|'window'} */
  detectorMode;
  /** @type {number} */
  holdL;
  /** @type {number} */
  holdR;
  /** @type {number} */
  lastUpdateTime;
  /** @type {number} */
  peakHoldL;
  /** @type {number} */
  peakHoldR;
  /** @type {number} */
  peakTimeL;
  /** @type {number} */
  peakTimeR;
  /** @type {RCDetectorState} */
  rcStateL;
  /** @type {RCDetectorState} */
  rcStateR;

  /**
   * @param {Object} options - Configuration options
   * @param {number} options.sampleRate - Audio sample rate in Hz
   * @param {number} [options.peakHoldSeconds=NORDIC_PPM_PEAK_HOLD_S] - Peak hold duration
   * @param {'rc'|'window'} [options.detectorMode='rc'] - Quasi-peak detector algorithm
   */
  constructor({ sampleRate, peakHoldSeconds = NORDIC_PPM_PEAK_HOLD_S, detectorMode = 'rc' }) {
    this.sampleRate = sampleRate;
    this.peakHoldSeconds = peakHoldSeconds;
    this.detectorMode = detectorMode;

    // Ballistic state (held values with decay)
    this.holdL = -60;
    this.holdR = -60;

    // RC detector state (persistent across buffer calls)
    // peakDb tracks the held level for linear dB decay
    this.rcStateL = { envelope: 0, peakDb: -60 };
    this.rcStateR = { envelope: 0, peakDb: -60 };

    // Timing for decay calculation (used in 'window' mode)
    this.lastUpdateTime = performance.now();

    // Peak hold state (3s hold)
    this.peakHoldL = -60;
    this.peakHoldR = -60;
    this.peakTimeL = 0;
    this.peakTimeR = 0;
  }

  /**
   * Update meter with new audio buffers.
   * Call this in your animation/render loop.
   *
   * @param {Float32Array} leftBuffer - Left channel samples
   * @param {Float32Array} rightBuffer - Right channel samples
   */
  update(leftBuffer, rightBuffer) {
    const now = performance.now();
    const dt = Math.max(0.001, (now - this.lastUpdateTime) / 1000);
    this.lastUpdateTime = now;

    let peakDbL, peakDbR;

    if (this.detectorMode === 'rc') {
      // RC detector: ballistics are applied sample-by-sample within the function
      // The returned value already has correct attack/decay characteristics
      peakDbL = calculateQuasiPeakRC(leftBuffer, this.sampleRate, this.rcStateL);
      peakDbR = calculateQuasiPeakRC(rightBuffer, this.sampleRate, this.rcStateR);

      // RC mode: use the detector output directly (ballistics already applied)
      this.holdL = peakDbL;
      this.holdR = peakDbR;
    } else {
      // Window mode: simplified peak detection with separate ballistics
      peakDbL = calculateQuasiPeak(leftBuffer, this.sampleRate);
      peakDbR = calculateQuasiPeak(rightBuffer, this.sampleRate);

      // Calculate decay for this frame
      const decayDb = NORDIC_PPM_DECAY_DB_PER_S * dt;

      // Apply IEC Type I ballistics: instant attack, linear decay
      // With hysteresis to prevent instability on constant tones
      if (peakDbL > this.holdL) {
        this.holdL = peakDbL;  // Instant attack
      } else if (peakDbL < this.holdL - NORDIC_HYSTERESIS_DB) {
        this.holdL = Math.max(NORDIC_PPM_MIN_DBFS, this.holdL - decayDb);  // Linear decay
      }

      if (peakDbR > this.holdR) {
        this.holdR = peakDbR;
      } else if (peakDbR < this.holdR - NORDIC_HYSTERESIS_DB) {
        this.holdR = Math.max(NORDIC_PPM_MIN_DBFS, this.holdR - decayDb);
      }
    }

    // Clamp to display range (Nordic PPM: -58 to 0 dBFS)
    const displayL = Math.max(NORDIC_PPM_MIN_DBFS, Math.min(NORDIC_PPM_MAX_DBFS, this.holdL));
    const displayR = Math.max(NORDIC_PPM_MIN_DBFS, Math.min(NORDIC_PPM_MAX_DBFS, this.holdR));

    // Peak hold logic (3s hold)
    const nowSec = now / 1000;

    if (displayL > this.peakHoldL) {
      this.peakHoldL = displayL;
      this.peakTimeL = nowSec;
    } else if (nowSec - this.peakTimeL > this.peakHoldSeconds) {
      this.peakHoldL = displayL;
      this.peakTimeL = nowSec;
    }

    if (displayR > this.peakHoldR) {
      this.peakHoldR = displayR;
      this.peakTimeR = nowSec;
    } else if (nowSec - this.peakTimeR > this.peakHoldSeconds) {
      this.peakHoldR = displayR;
      this.peakTimeR = nowSec;
    }
  }

  /**
   * Get current meter state.
   *
   * @returns {PPMMeterState} Current readings in both dBFS and PPM scale
   */
  getState() {
    const displayL = Math.max(NORDIC_PPM_MIN_DBFS, Math.min(NORDIC_PPM_MAX_DBFS, this.holdL));
    const displayR = Math.max(NORDIC_PPM_MIN_DBFS, Math.min(NORDIC_PPM_MAX_DBFS, this.holdR));

    return {
      // dBFS values (digital domain)
      dbfsLeft: displayL,
      dbfsRight: displayR,
      dbfsHoldLeft: this.peakHoldL,
      dbfsHoldRight: this.peakHoldR,

      // PPM scale values (Nordic -40 to +18)
      ppmScaleLeft: dbfsToPPM(displayL),
      ppmScaleRight: dbfsToPPM(displayR),
      ppmScaleHoldLeft: dbfsToPPM(this.peakHoldL),
      ppmScaleHoldRight: dbfsToPPM(this.peakHoldR),

      // Silence detection
      isSilentLeft: displayL <= NORDIC_PPM_MIN_DBFS + 1,
      isSilentRight: displayR <= NORDIC_PPM_MIN_DBFS + 1
    };
  }

  /**
   * Reset peak hold values.
   */
  resetPeakHold() {
    this.peakHoldL = -60;
    this.peakHoldR = -60;
  }

  /**
   * Full reset of all meter state.
   * Call before verification tests to ensure clean slate.
   */
  reset() {
    // Ballistic state
    this.holdL = -60;
    this.holdR = -60;

    // RC detector state
    this.rcStateL = { envelope: 0, peakDb: -60 };
    this.rcStateR = { envelope: 0, peakDb: -60 };

    // Peak hold state
    this.peakHoldL = -60;
    this.peakHoldR = -60;
    this.peakTimeL = 0;
    this.peakTimeR = 0;

    // Timing
    this.lastUpdateTime = performance.now();
  }
}

/**
 * @typedef {Object} PPMMeterState
 * @property {number} dbfsLeft - Current left level (dBFS)
 * @property {number} dbfsRight - Current right level (dBFS)
 * @property {number} dbfsHoldLeft - Peak hold left (dBFS, 3s)
 * @property {number} dbfsHoldRight - Peak hold right (dBFS, 3s)
 * @property {number} ppmScaleLeft - Current left level (Nordic PPM, -36 to +9)
 * @property {number} ppmScaleRight - Current right level (Nordic PPM)
 * @property {number} ppmScaleHoldLeft - Peak hold left (Nordic PPM)
 * @property {number} ppmScaleHoldRight - Peak hold right (Nordic PPM)
 * @property {boolean} isSilentLeft - Left channel below scale minimum
 * @property {boolean} isSilentRight - Right channel below scale minimum
 */

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert dBFS to PPM scale.
 * PPM = dBFS + 18 (per EBU R68)
 *
 * @param {number} dbfs - Level in dBFS
 * @returns {number} Level in PPM scale
 */
export function dbfsToPPM(dbfs) {
  return dbfs + PPM_DBFS_OFFSET;
}

/**
 * Convert PPM scale to dBFS.
 *
 * @param {number} ppm - Level in PPM scale
 * @returns {number} Level in dBFS
 */
export function ppmToDbfs(ppm) {
  return ppm - PPM_DBFS_OFFSET;
}

/**
 * Convert dBFS to dBu (analogue level).
 * Assuming 0 dBu = −18 dBFS (EBU R68)
 *
 * @param {number} dbfs - Level in dBFS
 * @returns {number} Level in dBu
 */
export function dbfsToDBu(dbfs) {
  return dbfs + PPM_DBFS_OFFSET;  // Same as PPM for EBU R68
}

/**
 * Format PPM value for display.
 *
 * @param {number} ppm - Level in PPM scale
 * @param {number} [decimals=1] - Decimal places
 * @returns {string} Formatted string (e.g., "+3.5 PPM" or "--.- PPM")
 */
export function formatPPM(ppm, decimals = 1) {
  if (!isFinite(ppm) || ppm < -36) {
    return '--.- PPM';
  }

  // Format with sign for positive values
  const sign = ppm >= 0 ? '+' : '';
  return sign + ppm.toFixed(decimals) + ' PPM';
}

/**
 * Format dBu value for display.
 *
 * @param {number} dbu - Level in dBu
 * @param {number} [decimals=1] - Decimal places
 * @returns {string} Formatted string (e.g., "+3.5 dBu")
 */
export function formatDBu(dbu, decimals = 1) {
  if (!isFinite(dbu)) {
    return '--.- dBu';
  }

  const sign = dbu >= 0 ? '+' : '';
  return sign + dbu.toFixed(decimals) + ' dBu';
}

// ─────────────────────────────────────────────────────────────────────────────
// NORDIC PPM DISPLAY COMPRESSION
// ─────────────────────────────────────────────────────────────────────────────
//
// Traditional Nordic PPM meters (RTW, DK-Audio, NTP) display scales from
// approximately -40 to +12, but the underlying math follows EBU R68 where
// +18 PPM = 0 dBFS. To achieve the traditional visual appearance while
// maintaining correct calibration, we compress the overload zone:
//
//   REAL PPM (EBU R68)     DISPLAY
//   ──────────────────     ───────
//   -40 to +6              -40 to +6  (linear 1:1)
//   +6 to +18 (12 dB)      +6 to +12  (compressed 2:1)
//
// This gives more visual resolution in the critical overload zone while
// keeping the meter calibration correct per EBU R68.
// ─────────────────────────────────────────────────────────────────────────────

/** Display compression breakpoint (real PPM value where compression starts) */
export const NORDIC_DISPLAY_COMPRESSION_START = 6;

/** Display maximum (what +18 PPM real shows as on display) */
export const NORDIC_DISPLAY_MAX = 12;

/** Real PPM maximum (EBU R68: 0 dBFS) */
export const NORDIC_REAL_MAX = 18;

/**
 * Convert real Nordic PPM value to compressed display value.
 *
 * Below +6 PPM: linear 1:1 mapping
 * Above +6 PPM: compressed 2:1 (12 dB real → 6 dB display)
 *
 * @param {number} realPpm - Real PPM value (EBU R68: PPM = dBFS + 18)
 * @returns {number} Display PPM value (compressed above +6)
 */
export function nordicPpmToDisplay(realPpm) {
  if (realPpm <= NORDIC_DISPLAY_COMPRESSION_START) {
    return realPpm;
  }
  // Compress +6...+18 (12 dB) to +6...+12 (6 dB display)
  // Factor 0.5: each real dB above +6 becomes 0.5 display dB
  const overAmount = realPpm - NORDIC_DISPLAY_COMPRESSION_START;
  return NORDIC_DISPLAY_COMPRESSION_START + overAmount * 0.5;
}

/**
 * Convert compressed display value back to real Nordic PPM.
 *
 * @param {number} displayPpm - Display PPM value
 * @returns {number} Real PPM value (EBU R68)
 */
export function nordicDisplayToPpm(displayPpm) {
  if (displayPpm <= NORDIC_DISPLAY_COMPRESSION_START) {
    return displayPpm;
  }
  // Expand +6...+12 (6 dB display) to +6...+18 (12 dB real)
  const overAmount = displayPpm - NORDIC_DISPLAY_COMPRESSION_START;
  return NORDIC_DISPLAY_COMPRESSION_START + overAmount * 2;
}

/**
 * Convert dBFS directly to compressed Nordic display value.
 *
 * @param {number} dbfs - Level in dBFS
 * @returns {number} Display PPM value (compressed above +6)
 */
export function nordicDbfsToDisplay(dbfs) {
  const realPpm = dbfs + NORDIC_PPM_DBFS_OFFSET;
  return nordicPpmToDisplay(realPpm);
}

/**
 * Convert dBFS to display-scale dBFS for Nordic PPM bar drawing.
 * This maps the -58 to 0 dBFS range to a compressed display range
 * where -12 to 0 dBFS (real) maps to -12 to -6 dBFS (display).
 *
 * @param {number} dbfs - Real dBFS value
 * @returns {number} Display-scale dBFS for bar drawing
 */
export function nordicDbfsToDisplayDbfs(dbfs) {
  // Convert to PPM, compress, convert back to dBFS
  const realPpm = dbfs + NORDIC_PPM_DBFS_OFFSET;
  const displayPpm = nordicPpmToDisplay(realPpm);
  return displayPpm - NORDIC_PPM_DBFS_OFFSET;
}

/**
 * Get PPM scale markings for meter rendering.
 *
 * @returns {Array<{ppm: number, dbfs: number, label: string}>} Scale markings
 */
export function getPPMScaleMarkings() {
  return [
    { ppm: 9, dbfs: -9, label: '+9' },
    { ppm: 6, dbfs: -12, label: 'TEST' },
    { ppm: 3, dbfs: -15, label: '+3' },
    { ppm: 0, dbfs: -18, label: '0' },
    { ppm: -6, dbfs: -24, label: '-6' },
    { ppm: -12, dbfs: -30, label: '-12' },
    { ppm: -18, dbfs: -36, label: '-18' },
    { ppm: -24, dbfs: -42, label: '-24' },
    { ppm: -36, dbfs: -54, label: '-36' }
  ];
}
