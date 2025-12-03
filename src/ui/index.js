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

// Colours and themes (British English canonical exports)
export {
  DEFAULT_COLOURS,
  getLoudnessColour,
  getRadarColour,
  getTruePeakColour,
  getTruePeakBarColour,
  getPPMBarColour,
  getCorrelationColour,
  getBalanceColour,
  createMeterGradient,
  createTPGradient,
  getColoursFromCSS
} from './colours.js';

// Legacy aliases for backwards compatibility (American spelling → British)
export {
  DEFAULT_COLOURS as DEFAULT_COLORS,
  getLoudnessColour as getLoudnessColor,
  getCorrelationColour as getCorrelationColor
} from './colours.js';

// Meter bar components
export {
  DBFS_CONFIG,
  TRUE_PEAK_CONFIG,
  PPM_CONFIG,
  MeterBar,
  StereoMeterBar
} from './meter-bar.js';

// Loudness radar
export { LoudnessRadar } from './radar.js';

// Goniometer / vectorscope
export { Goniometer } from './goniometer.js';

// Correlation meter
export { corrNow, CorrelationMeter } from './correlation-meter.js';

// Balance meter
export { BalanceMeter } from './balance-meter.js';
