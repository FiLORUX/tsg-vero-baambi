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
 * MATH UTILITIES
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Common mathematical functions for audio metering and signal processing.
 *
 * @module utils/math
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// BASIC UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clamp value between min and max.
 *
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum bound
 * @param {number} max - Maximum bound
 * @returns {number} Clamped value
 *
 * @example
 * clamp(5, 0, 10)   // 5
 * clamp(-5, 0, 10)  // 0
 * clamp(15, 0, 10)  // 10
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Linear interpolation between two values.
 *
 * @param {number} a - Start value
 * @param {number} b - End value
 * @param {number} t - Interpolation factor (0 to 1)
 * @returns {number} Interpolated value
 *
 * @example
 * lerp(0, 100, 0.5) // 50
 * lerp(0, 100, 0.25) // 25
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Map value from one range to another.
 *
 * @param {number} value - Input value
 * @param {number} inMin - Input range minimum
 * @param {number} inMax - Input range maximum
 * @param {number} outMin - Output range minimum
 * @param {number} outMax - Output range maximum
 * @returns {number} Mapped value
 *
 * @example
 * mapRange(5, 0, 10, 0, 100) // 50
 * mapRange(-23, -60, 0, 0, 1) // ~0.617
 */
export function mapRange(value, inMin, inMax, outMin, outMax) {
  return outMin + (value - inMin) * (outMax - outMin) / (inMax - inMin);
}

/**
 * Normalise value to 0–1 range.
 *
 * @param {number} value - Value to normalise
 * @param {number} min - Minimum of range
 * @param {number} max - Maximum of range
 * @returns {number} Normalised value (0 to 1)
 */
export function normalise(value, min, max) {
  return (value - min) / (max - min);
}

// ─────────────────────────────────────────────────────────────────────────────
// dB / LINEAR CONVERSIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert dB to linear gain.
 *
 * @param {number} dB - Level in decibels
 * @returns {number} Linear gain (amplitude ratio)
 *
 * @example
 * dbToGain(0)   // 1.0
 * dbToGain(-6)  // ~0.501
 * dbToGain(-20) // 0.1
 */
export function dbToGain(dB) {
  return Math.pow(10, dB / 20);
}

/**
 * Convert linear gain to dB.
 *
 * @param {number} gain - Linear gain (amplitude ratio)
 * @returns {number} Level in decibels
 *
 * @example
 * gainToDb(1.0)  // 0
 * gainToDb(0.5)  // ~-6.02
 * gainToDb(0.1)  // -20
 */
export function gainToDb(gain) {
  return 20 * Math.log10(gain);
}

/**
 * Convert dB to linear power ratio.
 * Use for power/energy calculations (not amplitude).
 *
 * @param {number} dB - Level in decibels
 * @returns {number} Linear power ratio
 */
export function dbToPower(dB) {
  return Math.pow(10, dB / 10);
}

/**
 * Convert linear power ratio to dB.
 *
 * @param {number} power - Linear power ratio
 * @returns {number} Level in decibels
 */
export function powerToDb(power) {
  return 10 * Math.log10(power);
}

// ─────────────────────────────────────────────────────────────────────────────
// AMPLITUDE / RMS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate RMS (Root Mean Square) of a buffer.
 *
 * @param {Float32Array} buffer - Audio samples
 * @returns {number} RMS amplitude
 */
export function calculateRMS(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i] * buffer[i];
  }
  return Math.sqrt(sum / buffer.length);
}

/**
 * Calculate peak amplitude (maximum absolute value) of a buffer.
 *
 * @param {Float32Array} buffer - Audio samples
 * @returns {number} Peak amplitude
 */
export function calculatePeak(buffer) {
  let peak = 0;
  for (let i = 0; i < buffer.length; i++) {
    const abs = Math.abs(buffer[i]);
    if (abs > peak) peak = abs;
  }
  return peak;
}

/**
 * Calculate crest factor (peak-to-RMS ratio) in dB.
 *
 * @param {Float32Array} buffer - Audio samples
 * @returns {number} Crest factor in dB
 */
export function calculateCrestFactor(buffer) {
  const rms = calculateRMS(buffer);
  const peak = calculatePeak(buffer);
  if (rms < 1e-12) return 0;
  return 20 * Math.log10(peak / rms);
}

// ─────────────────────────────────────────────────────────────────────────────
// SMOOTHING / FILTERING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Single-pole lowpass filter (exponential smoothing).
 * Returns a function that smooths successive values.
 *
 * @param {number} tau - Time constant in seconds
 * @param {number} sampleRate - Update rate in Hz
 * @returns {function(number): number} Smoothing function
 *
 * @example
 * const smooth = createSmoother(0.3, 60);
 * smooth(10);  // First call
 * smooth(20);  // Smoothed towards 20
 */
export function createSmoother(tau, sampleRate) {
  const dt = 1 / sampleRate;
  const alpha = 1 - Math.exp(-dt / tau);
  let state = null;

  return function smooth(value) {
    if (state === null) {
      state = value;
    } else {
      state += alpha * (value - state);
    }
    return state;
  };
}

/**
 * Calculate exponential smoothing coefficient.
 *
 * @param {number} tau - Time constant in seconds
 * @param {number} dt - Time delta in seconds
 * @returns {number} Smoothing coefficient (0 to 1)
 */
export function smoothingCoefficient(tau, dt) {
  return 1 - Math.exp(-dt / tau);
}

/**
 * Apply exponential smoothing.
 *
 * @param {number} current - Current smoothed value
 * @param {number} target - Target value
 * @param {number} alpha - Smoothing coefficient (0 to 1)
 * @returns {number} New smoothed value
 */
export function smooth(current, target, alpha) {
  return current + alpha * (target - current);
}

// ─────────────────────────────────────────────────────────────────────────────
// ANGULAR / POLAR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert degrees to radians.
 *
 * @param {number} degrees - Angle in degrees
 * @returns {number} Angle in radians
 */
export function degToRad(degrees) {
  return degrees * Math.PI / 180;
}

/**
 * Convert radians to degrees.
 *
 * @param {number} radians - Angle in radians
 * @returns {number} Angle in degrees
 */
export function radToDeg(radians) {
  return radians * 180 / Math.PI;
}

/**
 * Normalise angle to 0–2π range.
 *
 * @param {number} angle - Angle in radians
 * @returns {number} Normalised angle
 */
export function normaliseAngle(angle) {
  return ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

// ─────────────────────────────────────────────────────────────────────────────
// PERCENTILES / STATISTICS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate percentile of a dataset.
 *
 * @param {number[]} data - Array of values (will be sorted)
 * @param {number} percentile - Percentile (0 to 100)
 * @returns {number} Value at percentile
 */
export function calculatePercentile(data, percentile) {
  if (data.length === 0) return NaN;

  const sorted = [...data].sort((a, b) => a - b);
  const index = Math.floor(sorted.length * percentile / 100);
  return sorted[Math.min(index, sorted.length - 1)];
}

/**
 * Calculate mean of an array.
 *
 * @param {number[]} data - Array of values
 * @returns {number} Mean value
 */
export function mean(data) {
  if (data.length === 0) return NaN;
  return data.reduce((a, b) => a + b, 0) / data.length;
}

/**
 * Calculate standard deviation.
 *
 * @param {number[]} data - Array of values
 * @returns {number} Standard deviation
 */
export function standardDeviation(data) {
  if (data.length === 0) return NaN;
  const avg = mean(data);
  const squareDiffs = data.map(value => Math.pow(value - avg, 2));
  return Math.sqrt(mean(squareDiffs));
}
