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

// Meter bar components
export {
  DBFS_CONFIG,
  TRUE_PEAK_CONFIG,
  PPM_CONFIG,
  MeterBar,
  StereoMeterBar
} from './meter-bar.js';

// Loudness radar
export {
  RADAR_MIN_LU,
  RADAR_MAX_LU,
  RADAR_RANGE_LU,
  DEFAULT_TARGET_LUFS,
  GRID_INTERVAL_LU,
  LoudnessRadar
} from './radar.js';

// Goniometer / vectorscope
export {
  MS_ROTATION,
  DEFAULT_DECAY,
  DEFAULT_SAMPLE_COUNT,
  Goniometer
} from './goniometer.js';

// Correlation and balance meters
export {
  CORR_MIN,
  CORR_MAX,
  PEAK_HOLD_MS,
  PEAK_FALL_RATE,
  CorrelationMeter,
  BalanceMeter
} from './correlation-meter.js';
