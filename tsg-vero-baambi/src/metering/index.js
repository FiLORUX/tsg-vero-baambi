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
 * METERING MODULE INDEX
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Re-exports all metering modules for convenient imports:
 *
 *   import { LUFSMeter, TruePeakMeter, PPMMeter } from './metering/index.js';
 *
 * Or import the entire module:
 *
 *   import * as Metering from './metering/index.js';
 *
 * @module metering
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// K-weighting filter (ITU-R BS.1770-4)
export {
  K_HIGHPASS_FREQUENCY,
  K_HIGHPASS_Q,
  K_HIGHSHELF_FREQUENCY,
  K_HIGHSHELF_GAIN,
  createKWeightingFilter,
  createStereoKWeightingFilters,
  BS1770_COEFFICIENTS_48K,
  applyKWeightingOffline
} from './k-weighting.js';

// LUFS / EBU R128 loudness measurement
export {
  MOMENTARY_WINDOW_S,
  SHORT_TERM_WINDOW_S,
  ABSOLUTE_GATE_LUFS,
  RELATIVE_GATE_OFFSET_LU,
  DEFAULT_TARGET_LUFS,
  ATSC_TARGET_LKFS,
  MIN_LRA_BLOCKS,
  LUFSMeter,
  energyToLUFS,
  lufsToEnergy,
  loudnessOffset,
  loudnessZone,
  formatLUFS,
  formatLRA
} from './lufs.js';

// True Peak detection (ITU-R BS.1770-4)
export {
  TP_LIMIT_EBU,
  TP_LIMIT_STREAMING,
  TP_LIMIT_SAFE,
  OVERSAMPLE_FACTOR,
  PEAK_HOLD_SECONDS,
  hermiteInterpolate,
  calculateTruePeak,
  calculateTruePeakStereo,
  TruePeakMeter,
  amplitudeToDbTP,
  dbTPToAmplitude,
  formatTruePeak,
  isOverLimit
} from './true-peak.js';

// Nordic PPM (IEC 60268-10 Type I)
export {
  PPM_ATTACK_MS,
  PPM_FALL_TIME_S,
  PPM_DECAY_DB_PER_S,
  PPM_MIN_DBFS,
  PPM_MAX_DBFS,
  PPM_DBFS_OFFSET,
  PPM_PEAK_HOLD_S,
  calculateQuasiPeak,
  calculateQuasiPeakStereo,
  PPMMeter,
  dbfsToPPM,
  ppmToDbfs,
  dbfsToDBu,
  formatPPM,
  formatDBu,
  getPPMScaleMarkings
} from './ppm.js';
