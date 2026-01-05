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
 * CALIBRATION MODULE INDEX
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Re-exports public API for calibration functionality.
 *
 * @module calibration
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export {
  // Engine
  CalibrationEngine,

  // Constants
  REFERENCE_STANDARDS,
  CALIBRATION_TONE,

  // Profile storage
  getCalibrationProfiles,
  saveCalibrationProfile,
  getProfileForDevice,
  getProfilesForDevice,
  setActiveProfile,
  deactivateProfile,
  deactivateAllProfiles,
  deleteCalibrationProfile,
  getProfileSummaries,

  // SSOT trim application
  applyProfileTrim,
  resetTrimToDefault,
  applyActiveProfilesOnStartup,

  // Profile naming
  generateProfileName,
  getUniqueProfileName,

  // Profile export/import
  exportProfilesToJSON,
  downloadProfiles,
  importProfilesFromJSON,
  importProfilesFromFile
} from './calibration-engine.js';
