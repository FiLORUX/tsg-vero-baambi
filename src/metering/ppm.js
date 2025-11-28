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
 * NORDIC PPM METER (IEC 60268-10 TYPE I)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * ───────
 * Programme Peak Meter per Nordic/DIN standard as used by SVT, NRK, YLE, DR.
 * This quasi-peak meter type provides consistent level indication for speech
 * and music with standardized attack and decay ballistics.
 *
 * REFERENCE LEVELS (EBU R68)
 * ──────────────────────────
 *   0 PPM = 0 dBu = −18 dBFS (peak) – broadcast alignment tone level
 *   TEST  = +6 PPM = +6 dBu = −12 dBFS – Nordic test level
 *   PML (Permitted Maximum Level) = +9 PPM = +9 dBu = −9 dBFS
 *
 * BALLISTICS (IEC 60268-10 Type I)
 * ─────────────────────────────────
 *   Integration time: 5ms (quasi-peak detector, not true peak)
 *   Rise time to −1dB of steady-state: 5ms ± 0.5ms
 *   Fall time: 20dB in 1.7s ± 0.3s (linear decay ≈ 11.76 dB/s)
 *
 * SCALE
 * ─────
 *   Minimum: −36 PPM (−54 dBFS)
 *   Maximum: +9 PPM (−9 dBFS)
 *   Range: 45 dB
 *
 * @module metering/ppm
 * @see IEC 60268-10 (Sound system equipment - Peak programme level meters)
 * @see EBU R68 (Alignment level in digital audio production equipment)
 * @see ITU-R BS.645 (Test signals and metering)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS (IEC 60268-10 Type I)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Quasi-peak integration time in milliseconds.
 * Time for meter to reach within 1dB of steady-state for a tone burst.
 * @type {number}
 */
export const PPM_ATTACK_MS = 5;

/**
 * Fall time: 20dB decay in 1.7 seconds.
 * @type {number}
 */
export const PPM_FALL_TIME_S = 1.7;

/**
 * Decay rate in dB per second.
 * Calculated as 20 / 1.7 ≈ 11.76 dB/s
 * @type {number}
 */
export const PPM_DECAY_DB_PER_S = 20 / PPM_FALL_TIME_S;

/**
 * PPM scale minimum in dBFS.
 * Corresponds to −36 PPM.
 * @type {number}
 */
export const PPM_MIN_DBFS = -54;

/**
 * PPM scale maximum in dBFS.
 * Corresponds to +9 PPM (Permitted Maximum Level).
 * @type {number}
 */
export const PPM_MAX_DBFS = -9;

/**
 * PPM to dBFS offset.
 * PPM = dBFS + 18
 * @type {number}
 */
export const PPM_DBFS_OFFSET = 18;

/**
 * Peak hold duration in seconds (RTW/DK convention).
 * @type {number}
 */
export const PPM_PEAK_HOLD_S = 3;

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
  // Calculate integration window size in samples
  const windowSamples = Math.max(1, Math.round(sampleRate * PPM_ATTACK_MS / 1000));

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
// PPM METER CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nordic PPM Meter with IEC 60268-10 Type I ballistics.
 *
 * Provides broadcast-standard Programme Peak Metering with:
 * - 5ms quasi-peak integration (attack)
 * - 20dB/1.7s linear decay (release)
 * - 3-second peak hold
 *
 * @example
 * const ppm = new PPMMeter({ sampleRate: 48000 });
 *
 * // In animation loop:
 * analyserL.getFloatTimeDomainData(bufferL);
 * analyserR.getFloatTimeDomainData(bufferR);
 * ppm.update(bufferL, bufferR);
 *
 * const { displayL, displayR, ppmL, ppmR } = ppm.getState();
 */
export class PPMMeter {
  /**
   * @param {Object} options - Configuration options
   * @param {number} options.sampleRate - Audio sample rate in Hz
   * @param {number} [options.peakHoldSeconds=PPM_PEAK_HOLD_S] - Peak hold duration
   */
  constructor({ sampleRate, peakHoldSeconds = PPM_PEAK_HOLD_S }) {
    this.sampleRate = sampleRate;
    this.peakHoldSeconds = peakHoldSeconds;

    // Ballistic state (held values with decay)
    this.holdL = -60;
    this.holdR = -60;

    // Timing for decay calculation
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

    // Get current quasi-peak levels
    const peakDbL = calculateQuasiPeak(leftBuffer, this.sampleRate);
    const peakDbR = calculateQuasiPeak(rightBuffer, this.sampleRate);

    // Calculate decay for this frame
    const decayDb = PPM_DECAY_DB_PER_S * dt;

    // Apply IEC Type I ballistics: instant attack, linear decay
    // Left channel
    if (peakDbL > this.holdL) {
      this.holdL = peakDbL;  // Instant attack
    } else {
      this.holdL = Math.max(PPM_MIN_DBFS, this.holdL - decayDb);  // Linear decay
    }

    // Right channel
    if (peakDbR > this.holdR) {
      this.holdR = peakDbR;
    } else {
      this.holdR = Math.max(PPM_MIN_DBFS, this.holdR - decayDb);
    }

    // Clamp to display range
    const displayL = Math.max(PPM_MIN_DBFS, Math.min(PPM_MAX_DBFS, this.holdL));
    const displayR = Math.max(PPM_MIN_DBFS, Math.min(PPM_MAX_DBFS, this.holdR));

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
    const displayL = Math.max(PPM_MIN_DBFS, Math.min(PPM_MAX_DBFS, this.holdL));
    const displayR = Math.max(PPM_MIN_DBFS, Math.min(PPM_MAX_DBFS, this.holdR));

    return {
      // dBFS values (for meter drawing)
      displayL,
      displayR,
      peakHoldL: this.peakHoldL,
      peakHoldR: this.peakHoldR,

      // PPM scale values (for display)
      ppmL: dbfsToPPM(displayL),
      ppmR: dbfsToPPM(displayR),
      ppmPeakL: dbfsToPPM(this.peakHoldL),
      ppmPeakR: dbfsToPPM(this.peakHoldR),

      // Silence detection
      isSilentL: displayL <= PPM_MIN_DBFS + 1,
      isSilentR: displayR <= PPM_MIN_DBFS + 1
    };
  }

  /**
   * Reset peak hold values.
   */
  resetPeakHold() {
    this.peakHoldL = -60;
    this.peakHoldR = -60;
  }
}

/**
 * @typedef {Object} PPMMeterState
 * @property {number} displayL - Left level in dBFS (clamped to scale)
 * @property {number} displayR - Right level in dBFS (clamped to scale)
 * @property {number} peakHoldL - Left peak hold in dBFS
 * @property {number} peakHoldR - Right peak hold in dBFS
 * @property {number} ppmL - Left level in PPM scale
 * @property {number} ppmR - Right level in PPM scale
 * @property {number} ppmPeakL - Left peak hold in PPM scale
 * @property {number} ppmPeakR - Right peak hold in PPM scale
 * @property {boolean} isSilentL - True if left channel is below scale
 * @property {boolean} isSilentR - True if right channel is below scale
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
