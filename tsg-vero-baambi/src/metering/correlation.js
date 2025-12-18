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
 * STEREO ANALYSIS: PHASE CORRELATION & L/R BALANCE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * ───────
 * Analyze stereo signal characteristics for broadcast quality verification:
 * - Phase correlation: detect out-of-phase content (mono compatibility issues)
 * - L/R balance: detect channel imbalance
 * - Stereo width: measure spatial distribution
 *
 * PHASE CORRELATION
 * ─────────────────
 * Pearson correlation coefficient between L and R channels:
 *   +1.0 = perfect positive correlation (mono, in-phase)
 *    0.0 = uncorrelated (independent stereo, typical music)
 *   −1.0 = perfect negative correlation (anti-phase, cancellation risk)
 *
 * Sustained values below −0.3 indicate potential mono compatibility problems.
 * Broadcast standards typically flag content with correlation < 0.
 *
 * L/R BALANCE
 * ───────────
 * Difference between left and right RMS levels:
 *   0.0 = balanced
 *   positive = louder on right
 *   negative = louder on left
 *
 * @module metering/correlation
 * @see DIN 45406 (Level and phase metering)
 * @see EBU R68 (Reference levels)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// CORRELATION CALCULATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate Pearson correlation coefficient between L and R channels.
 *
 * The correlation coefficient measures the linear relationship between
 * the two channels. For audio signals:
 *   +1.0 = identical signals (mono)
 *    0.0 = unrelated signals (independent stereo)
 *   −1.0 = inverted signals (phase cancellation)
 *
 * @param {Float32Array} leftBuffer - Left channel samples
 * @param {Float32Array} rightBuffer - Right channel samples
 * @returns {number} Correlation coefficient (−1 to +1)
 *
 * @example
 * analyserL.getFloatTimeDomainData(bufL);
 * analyserR.getFloatTimeDomainData(bufR);
 * const corr = calculateCorrelation(bufL, bufR);
 * if (corr < -0.3) console.warn('Phase issue detected!');
 */
export function calculateCorrelation(leftBuffer, rightBuffer) {
  const n = Math.min(leftBuffer.length, rightBuffer.length);
  if (n === 0) return 0;

  // Calculate means
  let sumL = 0;
  let sumR = 0;
  for (let i = 0; i < n; i++) {
    sumL += leftBuffer[i];
    sumR += rightBuffer[i];
  }
  const meanL = sumL / n;
  const meanR = sumR / n;

  // Calculate covariance and variances
  let numerator = 0;
  let varianceL = 0;
  let varianceR = 0;

  for (let i = 0; i < n; i++) {
    const deviationL = leftBuffer[i] - meanL;
    const deviationR = rightBuffer[i] - meanR;

    numerator += deviationL * deviationR;
    varianceL += deviationL * deviationL;
    varianceR += deviationR * deviationR;
  }

  // Pearson correlation coefficient
  const denominator = Math.sqrt(varianceL * varianceR);

  // Avoid division by zero (silent signal)
  if (denominator < 1e-20) return 0;

  return numerator / denominator;
}

/**
 * Calculate L/R balance (level difference).
 *
 * @param {Float32Array} leftBuffer - Left channel samples
 * @param {Float32Array} rightBuffer - Right channel samples
 * @returns {number} Balance (−1 = full left, 0 = centre, +1 = full right)
 */
export function calculateBalance(leftBuffer, rightBuffer) {
  let sumL = 0;
  let sumR = 0;
  const n = Math.min(leftBuffer.length, rightBuffer.length);

  for (let i = 0; i < n; i++) {
    sumL += leftBuffer[i] * leftBuffer[i];
    sumR += rightBuffer[i] * rightBuffer[i];
  }

  const rmsL = Math.sqrt(sumL / n);
  const rmsR = Math.sqrt(sumR / n);
  const total = rmsL + rmsR;

  // Avoid division by zero
  if (total < 1e-10) return 0;

  // −1 = full left, +1 = full right
  return (rmsR - rmsL) / total;
}

/**
 * Calculate stereo width using M/S analysis.
 *
 * Width = Side / Mid ratio
 *   0.0 = mono (no side content)
 *   1.0 = equal mid and side (typical stereo)
 *   > 1.0 = wide stereo (more side than mid)
 *
 * @param {Float32Array} leftBuffer - Left channel samples
 * @param {Float32Array} rightBuffer - Right channel samples
 * @returns {number} Stereo width (0 = mono, higher = wider)
 */
export function calculateStereoWidth(leftBuffer, rightBuffer) {
  let midEnergy = 0;
  let sideEnergy = 0;
  const n = Math.min(leftBuffer.length, rightBuffer.length);

  for (let i = 0; i < n; i++) {
    const mid = (leftBuffer[i] + rightBuffer[i]) * 0.5;
    const side = (leftBuffer[i] - rightBuffer[i]) * 0.5;

    midEnergy += mid * mid;
    sideEnergy += side * side;
  }

  // Avoid division by zero
  if (midEnergy < 1e-10) return 0;

  return Math.sqrt(sideEnergy / midEnergy);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEREO METER CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stereo Phase Correlation Meter with ballistics.
 *
 * Provides broadcast-style stereo metering with:
 * - Asymmetric ballistics (faster attack, slower release)
 * - Phase correlation (−1 to +1)
 * - L/R balance
 * - Stereo width
 *
 * @example
 * const stereoMeter = new StereoMeter();
 *
 * // In animation loop:
 * analyserL.getFloatTimeDomainData(bufL);
 * analyserR.getFloatTimeDomainData(bufR);
 * stereoMeter.update(bufL, bufR);
 *
 * const { correlation, balance, width } = stereoMeter.getState();
 */
export class StereoMeter {
  /**
   * @param {Object} options - Configuration options
   * @param {number} [options.attackCoeff=0.25] - Attack smoothing (0-1, higher = faster)
   * @param {number} [options.releaseCoeff=0.06] - Release smoothing (0-1, lower = slower)
   */
  constructor({
    attackCoeff = 0.25,
    releaseCoeff = 0.06
  } = {}) {
    this.attackCoeff = attackCoeff;
    this.releaseCoeff = releaseCoeff;

    // Held values with ballistics
    this.correlationHold = 0;
    this.balanceHold = 0;
    this.widthHold = 0;

    // Raw values (for reference)
    this.correlationRaw = 0;
    this.balanceRaw = 0;
    this.widthRaw = 0;
  }

  /**
   * Update meter with new audio buffers.
   *
   * @param {Float32Array} leftBuffer - Left channel samples
   * @param {Float32Array} rightBuffer - Right channel samples
   */
  update(leftBuffer, rightBuffer) {
    // Calculate raw values
    this.correlationRaw = calculateCorrelation(leftBuffer, rightBuffer);
    this.correlationRaw = Math.max(-1, Math.min(1, this.correlationRaw));

    this.balanceRaw = calculateBalance(leftBuffer, rightBuffer);
    this.widthRaw = calculateStereoWidth(leftBuffer, rightBuffer);

    // Apply asymmetric ballistics to correlation
    // Faster attack (catch phase issues quickly)
    // Slower release (stable visual indication)
    if (this.correlationRaw > this.correlationHold) {
      this.correlationHold += this.attackCoeff * (this.correlationRaw - this.correlationHold);
    } else {
      this.correlationHold += this.releaseCoeff * (this.correlationRaw - this.correlationHold);
    }

    // Symmetric smoothing for balance and width
    const smoothCoeff = 0.15;
    this.balanceHold += smoothCoeff * (this.balanceRaw - this.balanceHold);
    this.widthHold += smoothCoeff * (this.widthRaw - this.widthHold);
  }

  /**
   * Get current meter state.
   *
   * @returns {StereoMeterState} Current readings
   */
  getState() {
    return {
      correlation: this.correlationHold,
      correlationInstant: this.correlationRaw,
      balance: this.balanceHold,
      width: this.widthHold,
      zone: getCorrelationZone(this.correlationHold)
    };
  }

  /**
   * Reset meter state.
   */
  reset() {
    this.correlationHold = 0;
    this.balanceHold = 0;
    this.widthHold = 0;
  }
}

/**
 * @typedef {Object} StereoMeterState
 * @property {number} correlation - Smoothed phase correlation (−1 to +1)
 * @property {number} correlationInstant - Instantaneous correlation (−1 to +1)
 * @property {number} balance - L/R balance (−1 left, 0 centre, +1 right)
 * @property {number} width - Stereo width (0 = mono, 1 = typical stereo)
 * @property {'good'|'caution'|'problem'} zone - Correlation zone for display
 */

// ─────────────────────────────────────────────────────────────────────────────
// M/S (MID/SIDE) TRANSFORMS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert L/R to Mid/Side.
 *
 * @param {number} left - Left sample
 * @param {number} right - Right sample
 * @returns {{mid: number, side: number}} M/S values
 */
export function lrToMs(left, right) {
  return {
    mid: (left + right) * 0.5,   // Mono content (centre)
    side: (left - right) * 0.5  // Stereo difference
  };
}

/**
 * Convert Mid/Side to L/R.
 *
 * @param {number} mid - Mid sample
 * @param {number} side - Side sample
 * @returns {{left: number, right: number}} L/R values
 */
export function msToLr(mid, side) {
  return {
    left: mid + side,
    right: mid - side
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get correlation zone for display colouring.
 * Based on RTW/DK meter conventions.
 *
 * @param {number} correlation - Correlation value (−1 to +1)
 * @returns {'good'|'caution'|'problem'} Display zone
 */
export function getCorrelationZone(correlation) {
  if (correlation >= 0.3) return 'good';     // Green: good mono compatibility
  if (correlation >= -0.3) return 'caution'; // Amber: wide stereo, watch it
  return 'problem';                           // Red: phase issues
}

/**
 * @typedef {Object} CorrelationColourMap
 * @property {string} good - Colour for good correlation
 * @property {string} caution - Colour for caution zone
 * @property {string} problem - Colour for problem zone
 */

/**
 * Get CSS colour for correlation value.
 *
 * @param {number} correlation - Correlation value (−1 to +1)
 * @param {CorrelationColourMap} [colours] - Colour map
 * @returns {string} CSS colour
 */
export function getCorrelationColour(correlation, colours = {
  good: '#00d4aa',
  caution: '#ffaa00',
  problem: '#ff4444'
}) {
  const zone = getCorrelationZone(correlation);
  return colours[zone];
}

/**
 * Format correlation value for display.
 *
 * @param {number} correlation - Correlation value (−1 to +1)
 * @param {number} [decimals=2] - Decimal places
 * @returns {string} Formatted string (e.g., "+0.85" or "−0.42")
 */
export function formatCorrelation(correlation, decimals = 2) {
  if (!isFinite(correlation)) return '-.--';

  const clamped = Math.max(-1, Math.min(1, correlation));
  const sign = clamped >= 0 ? '+' : '';
  return sign + clamped.toFixed(decimals);
}

/**
 * Format balance value for display.
 *
 * @param {number} balance - Balance value (−1 to +1)
 * @returns {string} Formatted string (e.g., "L 3dB" or "R 2dB" or "C")
 */
export function formatBalance(balance) {
  if (!isFinite(balance) || Math.abs(balance) < 0.05) {
    return 'C'; // Centre
  }

  // Convert to approximate dB difference
  const db = Math.abs(balance) * 6; // Rough approximation

  if (balance < 0) {
    return `L ${db.toFixed(0)}dB`;
  } else {
    return `R ${db.toFixed(0)}dB`;
  }
}

/**
 * Check if signal has phase problems.
 *
 * @param {number} correlation - Correlation value
 * @param {number} [threshold=-0.3] - Problem threshold
 * @returns {boolean} True if phase problem detected
 */
export function hasPhaseIssue(correlation, threshold = -0.3) {
  return correlation < threshold;
}
