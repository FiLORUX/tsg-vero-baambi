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
 * UI MODULE INDEX
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * @module ui
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// Colors and themes
export {
  DEFAULT_COLORS,
  getLoudnessColor,
  getRadarColor,
  getTruePeakColor,
  getTruePeakBarColor,
  getPPMBarColor,
  getCorrelationColor,
  getBalanceColor,
  createMeterGradient,
  createTPGradient,
  getColorsFromCSS
} from './colors.js';
