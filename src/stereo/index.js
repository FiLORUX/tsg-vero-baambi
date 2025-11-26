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
 * STEREO ANALYSIS MODULE INDEX
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Re-exports all stereo analysis modules for convenient imports:
 *
 *   import { StereoMeter, calculateCorrelation } from './stereo/index.js';
 *
 * @module stereo
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// Phase correlation and stereo analysis
export {
  calculateCorrelation,
  calculateBalance,
  calculateStereoWidth,
  StereoMeter,
  lrToMs,
  msToLr,
  getCorrelationZone,
  getCorrelationColor,
  formatCorrelation,
  formatBalance,
  hasPhaseIssue
} from './correlation.js';
