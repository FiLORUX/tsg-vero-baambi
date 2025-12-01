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
 * UTILITIES MODULE INDEX
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * @module utils
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// Formatting utilities
export {
  formatDb,
  formatDbu,
  formatDbSigned,
  formatLufs,
  formatLRA,
  formatCorr,
  formatBalance,
  formatTime,
  formatDuration,
  formatSampleRate,
  formatFrequency
} from './format.js';

// Math utilities
export {
  clamp,
  lerp,
  mapRange,
  normalize,
  dbToGain,
  gainToDb,
  dbToPower,
  powerToDb,
  calculateRMS,
  calculatePeak,
  calculateCrestFactor,
  createSmoother,
  smoothingCoefficient,
  smooth,
  degToRad,
  radToDeg,
  normalizeAngle,
  calculatePercentile,
  mean,
  standardDeviation
} from './math.js';

// DOM utilities
export {
  getCssVar,
  setCssVar,
  getCssVars,
  setupCanvas,
  getDPR,
  clearCanvas,
  createElement,
  $,
  $$,
  createAnimationLoop,
  createResizeObserver
} from './dom.js';
