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
 * CALIBRATION ENGINE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Reference-level calibration system for broadcast audio metering.
 * Supports automatic and manual calibration workflows per EBU Tech 3341.
 *
 * AUTOMATIC CALIBRATION
 * ─────────────────────
 * System generates 1 kHz reference tone at −18 dBFS (EBU R68), measures
 * integrated loudness over 30 seconds, and calculates trim offset to
 * achieve target loudness.
 *
 * MANUAL CALIBRATION
 * ──────────────────
 * User adjusts trim whilst monitoring LUFS-I until offset from target
 * reaches zero. Supports both internal tone and external reference signals.
 *
 * PROFILE STORAGE
 * ───────────────
 * Calibration profiles are keyed by device ID for automatic application
 * when input source is selected. Browser capture uses 'browser' as key.
 *
 * REFERENCE STANDARDS
 * ───────────────────
 *   EBU R128:     −23 LUFS ± 1 LU, TP ≤ −1 dBTP
 *   ATSC A/85:    −24 LKFS ± 2 LU, TP ≤ −2 dBTP
 *   Streaming:    −14 to −16 LUFS, TP ≤ −1 dBTP
 *
 * @module calibration/calibration-engine
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { STORAGE_KEYS, getJSON, setJSON } from '../config/storage.js';
import { appState } from '../app/state.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reference standards for loudness normalisation.
 * Values per ITU-R BS.1770-4 and regional specifications.
 * @type {Object<string, {name: string, targetLufs: number, tpLimit: number}>}
 */
export const REFERENCE_STANDARDS = Object.freeze({
  'ebu-23': {
    name: 'EBU R128',
    targetLufs: -23,
    tpLimit: -1,
    tolerance: 1.0
  },
  'atsc-24': {
    name: 'ATSC A/85',
    targetLufs: -24,
    tpLimit: -2,
    tolerance: 2.0
  },
  'streaming-16': {
    name: 'Streaming',
    targetLufs: -16,
    tpLimit: -1,
    tolerance: 1.0
  },
  'streaming-14': {
    name: 'Podcast',
    targetLufs: -14,
    tpLimit: -1,
    tolerance: 1.0
  }
});

/**
 * Calibration tone parameters per EBU R68 / ITU-R BR.1385.
 * 1 kHz at −18 dBFS peak (0 dBu alignment level).
 * @type {Object}
 */
export const CALIBRATION_TONE = Object.freeze({
  frequency: 1000,
  level: -18,
  type: 'sine'
});

/**
 * Alignment type classification.
 * Distinguishes between proper hardware alignment and digital compensation.
 * @type {Object<string, string>}
 */
export const ALIGNMENT_TYPE = Object.freeze({
  /** Internal digital source (generator, browser tab) - no external gain to adjust */
  INTERNAL: 'internal',
  /** External analog source - user adjusted hardware input gain */
  EXTERNAL: 'external',
  /** Digital compensation fallback - trim offset applied when hardware can't be adjusted */
  COMPENSATED: 'compensated'
});

/**
 * Level alignment configuration for external sources.
 * @type {Object}
 */
const LEVEL_ALIGNMENT_CONFIG = Object.freeze({
  /** Target peak level for alignment (dBFS) */
  targetPeakDbfs: -18,
  /** Tolerance for "on target" status (dB) */
  onTargetTolerance: 0.5,
  /** Tolerance for "close" status (dB) */
  closeTolerance: 1.5,
  /** Minimum signal level to consider valid (dBFS) */
  noSignalThreshold: -60,
  /** Poll interval for live meter updates (ms) */
  pollInterval: 50,
  /** Stability window for confirming alignment (ms) */
  stabilityWindow: 2000,
  /** Minimum samples in stability window */
  minStabilitySamples: 30
});

/**
 * Auto-calibration timing parameters.
 * @type {Object}
 */
const AUTO_CAL_CONFIG = Object.freeze({
  /** Total measurement duration (ms) */
  duration: 30000,
  /** Minimum duration before early finish allowed (ms) */
  minDuration: 10000,
  /** Measurement polling interval (ms) */
  pollInterval: 100,
  /** Window for stability calculation (ms) */
  confidenceWindow: 5000,
  /** Minimum confidence to allow early finish (%) */
  earlyFinishConfidence: 90
});

/**
 * Calibration profile storage schema version.
 * Increment when storage format changes require migration.
 *
 * Version history:
 *   1 - Initial: profiles keyed by deviceId (one per device)
 *   2 - Multi-profile: profiles keyed by UUID, multiple per device, isActive flag
 *
 * @type {number}
 */
const CALIBRATION_SCHEMA_VERSION = 2;

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE STORAGE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Notify UI components that calibration profiles have changed.
 * Increments appState.calibrationRevision to trigger reactive updates.
 * @private
 */
function notifyCalibrationChange() {
  const current = appState.get('calibrationRevision') || 0;
  appState.set({ calibrationRevision: current + 1 });
}

/**
 * Apply a profile's trim offset to the appropriate appState trim value.
 * This is the SSOT model: calibration directly sets the trim value that
 * the user slider controls. When a profile is activated, its trimOffset
 * becomes the new trim value for that input source.
 *
 * @param {CalibrationProfile} profile - Profile to apply trim from
 * @param {boolean} [log=true] - Whether to log the trim application
 */
export function applyProfileTrim(profile, log = true) {
  if (!profile || profile.trimOffset === null || profile.trimOffset === undefined) {
    return;
  }

  const trimValue = profile.trimOffset;

  if (profile.deviceId === 'browser') {
    appState.set({ browserTrim: trimValue });
    if (log) {
      console.log(`[Calibration] Applied browser trim: ${trimValue.toFixed(1)} dB (profile: ${profile.profileName})`);
    }
  } else {
    appState.set({ externalTrim: trimValue });
    if (log) {
      console.log(`[Calibration] Applied external trim: ${trimValue.toFixed(1)} dB (profile: ${profile.profileName})`);
    }
  }
}

/**
 * Reset trim to default value for a device type.
 * Called when a profile is deactivated with no replacement.
 *
 * @param {string} deviceId - Device identifier or 'browser'
 */
export function resetTrimToDefault(deviceId) {
  if (deviceId === 'browser') {
    appState.set({ browserTrim: -12 }); // Default from state.js
    console.log('[Calibration] Reset browser trim to default: -12 dB');
  } else {
    appState.set({ externalTrim: 0 }); // Default from state.js
    console.log('[Calibration] Reset external trim to default: 0 dB');
  }
}

/**
 * Apply all active calibration profiles on application startup.
 * This ensures trim values are synchronised with active profiles after
 * the SSOT model upgrade or when localStorage was cleared.
 *
 * Should be called once during application initialisation.
 */
export function applyActiveProfilesOnStartup() {
  const data = getCalibrationProfiles();
  let appliedCount = 0;

  for (const profile of Object.values(data.profiles)) {
    if (profile.isActive) {
      applyProfileTrim(profile, false); // Suppress individual logs
      appliedCount++;
    }
  }

  if (appliedCount > 0) {
    console.log(`[Calibration] Applied ${appliedCount} active profile(s) on startup`);
  }
}

/**
 * @typedef {Object} CalibrationProfile
 * @property {string} id - Unique profile identifier (UUID)
 * @property {string} deviceId - Audio device ID or 'browser'
 * @property {string} deviceLabel - Human-readable device name
 * @property {string} profileName - User-defined profile name
 * @property {string} referenceStandard - Key from REFERENCE_STANDARDS
 * @property {number} targetLufs - Target programme loudness (LUFS)
 * @property {number} trimOffset - Calculated trim offset (dB), null if hardware aligned
 * @property {number} measuredLufs - LUFS-I at calibration
 * @property {number} measuredTp - True Peak max at calibration (dBTP)
 * @property {number} measuredPeakDbfs - Peak level at alignment (dBFS)
 * @property {number} toneFrequency - Calibration tone frequency (Hz)
 * @property {number} toneLevel - Calibration tone level (dBFS)
 * @property {string} method - Calibration method: 'auto' | 'manual' | 'level-alignment'
 * @property {string} alignmentType - From ALIGNMENT_TYPE: 'internal' | 'external' | 'compensated'
 * @property {boolean} hardwareAligned - True if user adjusted physical hardware gain
 * @property {number} calibratedAt - Calibration timestamp (ms)
 * @property {number} duration - Calibration duration (ms)
 * @property {number} confidence - Measurement stability (0-100)
 * @property {string} notes - User notes
 * @property {boolean} isActive - True if this is the active profile for its deviceId
 */

/**
 * Migrate v1 storage (keyed by deviceId) to v2 (keyed by profile UUID).
 * @private
 */
function migrateV1toV2(data) {
  const migrated = { version: 2, profiles: {} };

  for (const [deviceId, profile] of Object.entries(data.profiles || {})) {
    // Ensure profile has a UUID
    const id = profile.id || crypto.randomUUID();
    migrated.profiles[id] = {
      ...profile,
      id,
      deviceId: profile.deviceId || deviceId,
      isActive: true // Old profiles become active by default
    };
  }

  console.log(`[Calibration] Migrated ${Object.keys(migrated.profiles).length} profiles from v1 to v2`);
  return migrated;
}

/**
 * Retrieve all calibration profiles from storage.
 * Handles migration from older schema versions.
 *
 * @returns {{ version: number, profiles: Object<string, CalibrationProfile> }}
 */
export function getCalibrationProfiles() {
  const data = getJSON(STORAGE_KEYS.CALIBRATION_PROFILES, null);

  if (!data) {
    return { version: CALIBRATION_SCHEMA_VERSION, profiles: {} };
  }

  // Migrate from v1 if needed
  if (data.version === 1) {
    const migrated = migrateV1toV2(data);
    setJSON(STORAGE_KEYS.CALIBRATION_PROFILES, migrated);
    return migrated;
  }

  if (data.version !== CALIBRATION_SCHEMA_VERSION) {
    return { version: CALIBRATION_SCHEMA_VERSION, profiles: {} };
  }

  return data;
}

/**
 * Save calibration profile to storage.
 * New profiles are automatically set as active for their device.
 * SSOT: When saved as active, the profile's trim offset is applied immediately.
 *
 * @param {CalibrationProfile} profile - Profile to save
 * @param {boolean} [setActive=true] - Whether to set this profile as active
 */
export function saveCalibrationProfile(profile, setActive = true) {
  const data = getCalibrationProfiles();

  // Ensure profile has an ID
  if (!profile.id) {
    profile.id = crypto.randomUUID();
  }

  // If setting as active, deactivate other profiles for same device
  if (setActive) {
    for (const p of Object.values(data.profiles)) {
      if (p.deviceId === profile.deviceId) {
        p.isActive = false;
      }
    }
    profile.isActive = true;
  }

  data.profiles[profile.id] = profile;
  data.version = CALIBRATION_SCHEMA_VERSION;
  setJSON(STORAGE_KEYS.CALIBRATION_PROFILES, data);

  // SSOT: Apply trim immediately when profile is saved as active
  if (setActive && profile.isActive) {
    applyProfileTrim(profile);
  }

  notifyCalibrationChange();
}

/**
 * Retrieve the active profile for a specific device.
 *
 * @param {string} deviceId - Device identifier or 'browser'
 * @returns {CalibrationProfile|null}
 */
export function getProfileForDevice(deviceId) {
  if (!deviceId) return null;
  const data = getCalibrationProfiles();

  // Find active profile for this device
  for (const profile of Object.values(data.profiles)) {
    if (profile.deviceId === deviceId && profile.isActive) {
      return profile;
    }
  }

  return null;
}

/**
 * Get all profiles for a specific device.
 *
 * @param {string} deviceId - Device identifier
 * @returns {CalibrationProfile[]}
 */
export function getProfilesForDevice(deviceId) {
  if (!deviceId) return [];
  const data = getCalibrationProfiles();

  return Object.values(data.profiles)
    .filter(p => p.deviceId === deviceId)
    .sort((a, b) => b.calibratedAt - a.calibratedAt);
}

/**
 * Set a profile as active for its device.
 * Deactivates other profiles for the same device.
 * SSOT: The profile's trim offset is applied immediately.
 *
 * @param {string} profileId - Profile UUID to activate
 */
export function setActiveProfile(profileId) {
  const data = getCalibrationProfiles();
  const profile = data.profiles[profileId];

  if (!profile) {
    console.warn(`[Calibration] Profile not found: ${profileId}`);
    return;
  }

  // Deactivate other profiles for same device
  for (const p of Object.values(data.profiles)) {
    if (p.deviceId === profile.deviceId) {
      p.isActive = (p.id === profileId);
    }
  }

  setJSON(STORAGE_KEYS.CALIBRATION_PROFILES, data);

  // SSOT: Apply trim immediately
  applyProfileTrim(profile);

  notifyCalibrationChange();
  console.log(`[Calibration] Activated profile: ${profile.profileName}`);
}

/**
 * Deactivate a profile by ID.
 * Profile remains in storage but is no longer active.
 * SSOT: Trim is reset to default unless another profile for the same device is active.
 *
 * @param {string} profileId - Profile UUID to deactivate
 * @returns {boolean} True if profile was found and deactivated
 */
export function deactivateProfile(profileId) {
  const data = getCalibrationProfiles();
  const profile = data.profiles[profileId];

  if (!profile) {
    console.warn(`[Calibration] Profile not found: ${profileId}`);
    return false;
  }

  if (!profile.isActive) {
    // Already inactive
    return false;
  }

  const deviceId = profile.deviceId;
  profile.isActive = false;
  setJSON(STORAGE_KEYS.CALIBRATION_PROFILES, data);

  // SSOT: Reset trim to default (no other profile will be active for this device)
  resetTrimToDefault(deviceId);

  notifyCalibrationChange();
  console.log(`[Calibration] Deactivated profile: ${profile.profileName}`);
  return true;
}

/**
 * Deactivate all active profiles across all devices.
 * Profiles remain in storage but none are active.
 * SSOT: All affected trims are reset to their defaults.
 *
 * @returns {number} Number of profiles deactivated
 */
export function deactivateAllProfiles() {
  const data = getCalibrationProfiles();
  let count = 0;
  const affectedDevices = new Set();

  for (const profile of Object.values(data.profiles)) {
    if (profile.isActive) {
      affectedDevices.add(profile.deviceId);
      profile.isActive = false;
      count++;
    }
  }

  if (count > 0) {
    setJSON(STORAGE_KEYS.CALIBRATION_PROFILES, data);

    // SSOT: Reset all affected trims to defaults
    for (const deviceId of affectedDevices) {
      resetTrimToDefault(deviceId);
    }

    notifyCalibrationChange();
    console.log(`[Calibration] Deactivated ${count} profile(s)`);
  }

  return count;
}

/**
 * Delete calibration profile by ID.
 * SSOT: If deleting an active profile, trim is reset to default.
 *
 * @param {string} profileId - Profile UUID to delete
 */
export function deleteCalibrationProfile(profileId) {
  const data = getCalibrationProfiles();
  const profile = data.profiles[profileId];

  if (!profile) {
    return;
  }

  const wasActive = profile.isActive;
  const deviceId = profile.deviceId;

  delete data.profiles[profileId];
  setJSON(STORAGE_KEYS.CALIBRATION_PROFILES, data);

  // SSOT: Reset trim if deleted profile was active
  if (wasActive) {
    resetTrimToDefault(deviceId);
  }

  notifyCalibrationChange();
}

/**
 * Get all profile summaries for UI display.
 *
 * @returns {Array<{id: string, deviceId: string, profileName: string, referenceStandard: string, method: string, calibratedAt: number, deviceLabel: string, confidence: number, trimOffset: number, isActive: boolean}>}
 */
export function getProfileSummaries() {
  const data = getCalibrationProfiles();
  return Object.values(data.profiles).map(p => ({
    id: p.id,
    deviceId: p.deviceId,
    deviceLabel: p.deviceLabel || p.deviceId,
    profileName: p.profileName,
    referenceStandard: p.referenceStandard,
    method: p.method,
    calibratedAt: p.calibratedAt,
    confidence: p.confidence || 0,
    trimOffset: p.trimOffset,
    isActive: p.isActive || false
  }));
}

/**
 * Generate a smart default profile name with timestamp.
 * Format: "Device Label (DD/MM/YYYY HH:mm)"
 *
 * @param {string} deviceLabel - Human-readable device name
 * @returns {string} Generated profile name
 */
export function generateProfileName(deviceLabel) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const time = now.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  return `${deviceLabel} (${date} ${time})`;
}

/**
 * Generate a unique profile name, adding increment suffix if needed.
 * E.g., "Borås Hockey" → "Borås Hockey 2" → "Borås Hockey 3"
 *
 * @param {string} baseName - Desired profile name
 * @returns {string} Unique profile name
 */
export function getUniqueProfileName(baseName) {
  const data = getCalibrationProfiles();
  const existingNames = Object.values(data.profiles).map(p => p.profileName);

  if (!existingNames.includes(baseName)) {
    return baseName;
  }

  // Extract base name without existing number suffix
  const baseMatch = baseName.match(/^(.+?)\s*(\d+)?$/);
  const nameBase = baseMatch ? baseMatch[1].trim() : baseName;

  // Find highest existing number for this base
  let maxNum = 1;
  for (const name of existingNames) {
    const match = name.match(new RegExp(`^${escapeRegex(nameBase)}\\s*(\\d+)?$`));
    if (match) {
      const num = match[1] ? parseInt(match[1], 10) : 1;
      if (num >= maxNum) {
        maxNum = num + 1;
      }
    }
  }

  return `${nameBase} ${maxNum}`;
}

/**
 * Escape special regex characters in a string.
 * @private
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Export all calibration profiles to JSON string.
 * Includes metadata for validation on import.
 *
 * @returns {string} JSON string ready for download
 */
export function exportProfilesToJSON() {
  const data = getCalibrationProfiles();
  const exportData = {
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    application: 'TSG VERO-BAAMBI',
    schemaVersion: CALIBRATION_SCHEMA_VERSION,
    profiles: data.profiles
  };
  return JSON.stringify(exportData, null, 2);
}

/**
 * Download calibration profiles as JSON file.
 * Triggers browser download dialog.
 */
export function downloadProfiles() {
  const json = exportProfilesToJSON();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `vero-calibration-profiles-${timestamp}.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);
  console.log(`[Calibration] Exported profiles to ${filename}`);
}

/**
 * Import calibration profiles from JSON string.
 * Validates format and merges with existing profiles.
 *
 * @param {string} jsonString - JSON string from exported file
 * @param {Object} [options] - Import options
 * @param {boolean} [options.replace=false] - Replace all existing profiles (default: merge)
 * @returns {{ imported: number, skipped: number, errors: string[] }}
 */
export function importProfilesFromJSON(jsonString, options = {}) {
  const result = { imported: 0, skipped: 0, errors: [] };

  let importData;
  try {
    importData = JSON.parse(jsonString);
  } catch (e) {
    result.errors.push('Invalid JSON format');
    return result;
  }

  // Validate export format
  if (!importData.profiles || typeof importData.profiles !== 'object') {
    result.errors.push('Invalid export format: missing profiles object');
    return result;
  }

  if (importData.application && importData.application !== 'TSG VERO-BAAMBI') {
    result.errors.push(`Warning: profiles from different application (${importData.application})`);
  }

  const existingData = options.replace
    ? { version: CALIBRATION_SCHEMA_VERSION, profiles: {} }
    : getCalibrationProfiles();

  for (const [deviceId, profile] of Object.entries(importData.profiles)) {
    // Validate required fields
    if (!profile.deviceId || !profile.referenceStandard || profile.calibratedAt === undefined) {
      result.errors.push(`Skipped invalid profile: ${deviceId}`);
      result.skipped++;
      continue;
    }

    // Check for existing profile
    if (existingData.profiles[deviceId] && !options.replace) {
      const existing = existingData.profiles[deviceId];
      // Keep newer profile
      if (existing.calibratedAt >= profile.calibratedAt) {
        result.skipped++;
        continue;
      }
    }

    existingData.profiles[deviceId] = profile;
    result.imported++;
  }

  if (result.imported > 0) {
    setJSON(STORAGE_KEYS.CALIBRATION_PROFILES, existingData);
    console.log(`[Calibration] Imported ${result.imported} profiles`);
  }

  return result;
}

/**
 * Open file picker and import profiles from selected JSON file.
 *
 * @param {Object} [options] - Import options
 * @param {boolean} [options.replace=false] - Replace all existing profiles
 * @returns {Promise<{ imported: number, skipped: number, errors: string[] }>}
 */
export function importProfilesFromFile(options = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';

    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) {
        resolve({ imported: 0, skipped: 0, errors: ['No file selected'] });
        return;
      }

      try {
        const text = await file.text();
        const result = importProfilesFromJSON(text, options);
        resolve(result);
      } catch (err) {
        resolve({ imported: 0, skipped: 0, errors: [err.message] });
      }
    };

    input.oncancel = () => {
      resolve({ imported: 0, skipped: 0, errors: [] });
    };

    input.click();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CALIBRATION ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calibration engine for automatic and manual workflows.
 *
 * ARCHITECTURE
 * ────────────
 * The engine operates as a state machine with callbacks for UI updates.
 * It does not directly manipulate DOM; all UI updates flow through
 * the onProgress callback.
 *
 * @example
 * const engine = new CalibrationEngine({
 *   sourceController: app.sourceController,
 *   lufsMeter: app.lufsMeter,
 *   truePeakMeter: app.truePeakMeter,
 *   resetMeters: () => app.resetIntegration()
 * });
 *
 * engine.startAutoCalibration(
 *   { deviceId: 'abc', referenceStandard: 'ebu-23' },
 *   (step, data) => updateUI(step, data),
 *   (profile) => onComplete(profile),
 *   (error) => onError(error)
 * );
 */
export class CalibrationEngine {
  /**
   * @param {Object} deps - Dependencies
   * @param {import('../app/sources.js').SourceController} deps.sourceController
   * @param {import('../metering/lufs.js').LUFSMeter} deps.lufsMeter
   * @param {import('../metering/true-peak.js').TruePeakMeter} deps.truePeakMeter
   * @param {Function} deps.resetMeters - Function to reset meter integration
   * @param {Function} [deps.getTrim] - Function to get current trim value
   * @param {Function} [deps.setTrim] - Function to set trim value
   */
  constructor(deps) {
    /** @type {import('../app/sources.js').SourceController} */
    this._sourceController = deps.sourceController;

    /** @type {import('../metering/lufs.js').LUFSMeter} */
    this._lufsMeter = deps.lufsMeter;

    /** @type {import('../metering/true-peak.js').TruePeakMeter} */
    this._truePeakMeter = deps.truePeakMeter;

    /** @type {Function} */
    this._resetMeters = deps.resetMeters;

    /** @type {Function|null} */
    this._getTrim = deps.getTrim || null;

    /** @type {Function|null} */
    this._setTrim = deps.setTrim || null;

    // ─── Remote mode configuration ───
    /**
     * Remote calibration mode configuration.
     * When enabled, engine reads metrics from remote probe via metricsGetter
     * and sends trim commands via trimSender instead of local controls.
     * @type {{enabled: boolean, probeId: string|null, metricsGetter: Function|null, trimSender: Function|null, getTrim: Function|null}|null}
     */
    this._remoteMode = null;

    // Calibration state
    /** @type {boolean} */
    this._isCalibrating = false;

    /** @type {'auto'|'manual'|null} */
    this._mode = null;

    /** @type {string|null} */
    this._step = null;

    /** @type {Object|null} */
    this._config = null;

    /** @type {Array<{t: number, m: number, s: number, i: number, tp: number}>} */
    this._measurements = [];

    /** @type {number|null} */
    this._startTime = null;

    /** @type {number|null} */
    this._intervalId = null;

    // Callbacks
    /** @type {Function|null} */
    this._onProgress = null;

    /** @type {Function|null} */
    this._onComplete = null;

    /** @type {Function|null} */
    this._onError = null;

    // Previous source state for restoration
    /** @type {string|null} */
    this._previousSourceMode = null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if calibration is in progress.
   * @returns {boolean}
   */
  get isCalibrating() {
    return this._isCalibrating;
  }

  /**
   * Get current calibration step.
   * @returns {string|null}
   */
  get currentStep() {
    return this._step;
  }

  /**
   * Get current calibration mode.
   * @returns {'auto'|'manual'|null}
   */
  get mode() {
    return this._mode;
  }

  /**
   * Check if remote mode is enabled.
   * @returns {boolean}
   */
  get isRemoteMode() {
    return this._remoteMode?.enabled === true;
  }

  /**
   * Configure remote calibration mode.
   *
   * When enabled, the engine reads metrics from a remote probe via the
   * metricsGetter callback and sends trim commands via trimSender,
   * rather than using local meters and trim controls.
   *
   * @param {Object} config - Remote mode configuration
   * @param {boolean} config.enabled - Enable or disable remote mode
   * @param {string} [config.probeId] - Remote probe identifier
   * @param {Function} [config.metricsGetter] - Returns { momentary, shortTerm, integrated, truePeak }
   * @param {Function} [config.trimSender] - Called with (trimDb) to send trim to probe
   * @param {Function} [config.getTrim] - Returns current trim value from remote probe
   */
  setRemoteMode(config) {
    if (!config.enabled) {
      this._remoteMode = null;
      console.log('[CalibrationEngine] Remote mode disabled');
      return;
    }

    this._remoteMode = {
      enabled: true,
      probeId: config.probeId || null,
      metricsGetter: config.metricsGetter || null,
      trimSender: config.trimSender || null,
      getTrim: config.getTrim || null
    };

    console.log(`[CalibrationEngine] Remote mode enabled for probe: ${config.probeId || 'unknown'}`);
  }

  /**
   * Start automatic calibration.
   *
   * @param {Object} config - Calibration configuration
   * @param {string} config.deviceId - Device identifier or 'browser'
   * @param {string} config.deviceLabel - Human-readable device name
   * @param {string} config.referenceStandard - Key from REFERENCE_STANDARDS
   * @param {string} [config.profileName] - Profile name (auto-generated if omitted)
   * @param {Function} onProgress - Progress callback: (step, data) => void
   * @param {Function} onComplete - Completion callback: (profile) => void
   * @param {Function} onError - Error callback: (error) => void
   */
  startAutoCalibration(config, onProgress, onComplete, onError) {
    if (this._isCalibrating) {
      onError?.(new Error('Calibration already in progress'));
      return;
    }

    const standard = REFERENCE_STANDARDS[config.referenceStandard];
    if (!standard) {
      onError?.(new Error(`Unknown reference standard: ${config.referenceStandard}`));
      return;
    }

    this._isCalibrating = true;
    this._mode = 'auto';
    this._config = {
      ...config,
      targetLufs: standard.targetLufs,
      standardName: standard.name,
      tolerance: standard.tolerance
    };
    this._measurements = [];
    this._onProgress = onProgress;
    this._onComplete = onComplete;
    this._onError = onError;

    this._runAutoCalibration();
  }

  /**
   * Start manual calibration.
   *
   * @param {Object} config - Calibration configuration
   * @param {string} config.deviceId - Device identifier or 'browser'
   * @param {string} config.deviceLabel - Human-readable device name
   * @param {string} config.referenceStandard - Key from REFERENCE_STANDARDS
   * @param {string} [config.profileName] - Profile name
   * @param {boolean} [config.useExternalSignal=false] - Use external reference instead of internal tone
   * @param {Function} onProgress - Progress callback
   * @param {Function} onComplete - Completion callback
   * @param {Function} onError - Error callback
   */
  startManualCalibration(config, onProgress, onComplete, onError) {
    if (this._isCalibrating) {
      onError?.(new Error('Calibration already in progress'));
      return;
    }

    const standard = REFERENCE_STANDARDS[config.referenceStandard];
    if (!standard) {
      onError?.(new Error(`Unknown reference standard: ${config.referenceStandard}`));
      return;
    }

    this._isCalibrating = true;
    this._mode = 'manual';
    this._config = {
      ...config,
      targetLufs: standard.targetLufs,
      standardName: standard.name,
      tolerance: standard.tolerance
    };
    this._measurements = [];
    this._startTime = performance.now();
    this._onProgress = onProgress;
    this._onComplete = onComplete;
    this._onError = onError;

    this._step = 'adjust';

    // Start internal tone if not using external signal
    if (!config.useExternalSignal) {
      this._previousSourceMode = this._sourceController.activeMode;
      this._sourceController.startGenerator({
        type: CALIBRATION_TONE.type,
        freq: CALIBRATION_TONE.frequency,
        db: CALIBRATION_TONE.level,
        routing: 'stereo'
      });
    }

    // Reset meters for fresh measurement
    this._resetMeters?.();

    // Start measurement polling
    this._intervalId = setInterval(() => this._pollManualMeasurement(), AUTO_CAL_CONFIG.pollInterval);

    this._onProgress?.('adjust', {
      targetLufs: this._config.targetLufs,
      toneFrequency: CALIBRATION_TONE.frequency,
      toneLevel: CALIBRATION_TONE.level,
      useExternalSignal: config.useExternalSignal || false
    });
  }

  /**
   * Get current meter readings during calibration.
   * Uses remote metricsGetter when in remote mode.
   *
   * @returns {{ momentary: number, shortTerm: number, integrated: number, offset: number|null, truePeak: number, confidence: number }|null}
   */
  getCurrentReadings() {
    if (!this._isCalibrating) return null;

    const target = this._config?.targetLufs ?? -23;

    // Remote mode: read from metricsGetter instead of local meters
    if (this._remoteMode?.enabled && this._remoteMode.metricsGetter) {
      const remote = this._remoteMode.metricsGetter();
      const integrated = remote.integrated ?? -Infinity;

      return {
        momentary: remote.momentary ?? -Infinity,
        shortTerm: remote.shortTerm ?? -Infinity,
        integrated,
        offset: isFinite(integrated) ? integrated - target : null,
        truePeak: remote.truePeak ?? -Infinity,
        confidence: this._calculateConfidence()
      };
    }

    // Local mode: read from local meters
    const readings = this._lufsMeter.getReadings();
    const tpState = this._truePeakMeter.getState();

    return {
      momentary: readings.momentary,
      shortTerm: readings.shortTerm,
      integrated: readings.integrated,
      offset: isFinite(readings.integrated) ? readings.integrated - target : null,
      truePeak: Math.max(tpState.dbtpLeft, tpState.dbtpRight),
      confidence: this._calculateConfidence()
    };
  }

  /**
   * Adjust trim during manual calibration.
   * Uses remote trimSender when in remote mode.
   *
   * @param {number} trimDb - New trim value in dB
   */
  adjustTrim(trimDb) {
    if (!this._isCalibrating || this._mode !== 'manual') return;

    // Remote mode: send trim to probe via trimSender
    if (this._remoteMode?.enabled && this._remoteMode.trimSender) {
      this._remoteMode.trimSender(trimDb);
    } else {
      // Local mode: apply trim directly
      this._setTrim?.(trimDb);
    }

    // Reset integration after trim change
    this._resetMeters?.();
    this._measurements = [];
    this._startTime = performance.now();
  }

  /**
   * Reset meter integration during calibration.
   */
  resetIntegration() {
    if (!this._isCalibrating) return;

    this._resetMeters?.();
    this._measurements = [];
    this._startTime = performance.now();
  }

  /**
   * Finalise manual calibration and save profile.
   *
   * @returns {CalibrationProfile}
   */
  finaliseManualCalibration() {
    if (!this._isCalibrating || this._mode !== 'manual') {
      throw new Error('No manual calibration in progress');
    }

    const duration = performance.now() - this._startTime;

    let integrated, truePeak, trimOffset;

    // Remote mode: use remote metrics and trim
    if (this._remoteMode?.enabled && this._remoteMode.metricsGetter) {
      const remote = this._remoteMode.metricsGetter();
      integrated = remote.integrated ?? -Infinity;
      truePeak = remote.truePeak ?? -Infinity;
      trimOffset = this._remoteMode.getTrim?.() ?? 0;
    } else {
      // Local mode: use local meters
      const readings = this._lufsMeter.getReadings();
      const tpState = this._truePeakMeter.getState();
      integrated = readings.integrated;
      truePeak = Math.max(tpState.dbtpLeft, tpState.dbtpRight);
      trimOffset = this._getTrim?.() ?? 0;
    }

    const profile = this._createProfile({
      measuredLufs: integrated,
      measuredTp: truePeak,
      trimOffset,
      duration,
      confidence: this._calculateConfidence(),
      method: 'manual'
    });

    this._cleanup();
    saveCalibrationProfile(profile);
    this._onComplete?.(profile);

    return profile;
  }

  /**
   * Finish auto-calibration early if confidence is sufficient.
   */
  finishEarly() {
    if (!this._isCalibrating || this._mode !== 'auto') return;

    const elapsed = performance.now() - this._startTime;
    const confidence = this._calculateConfidence();

    if (elapsed >= AUTO_CAL_CONFIG.minDuration && confidence >= AUTO_CAL_CONFIG.earlyFinishConfidence) {
      clearInterval(this._intervalId);
      this._intervalId = null;
      this._completeAutoCalibration();
    }
  }

  /**
   * Cancel ongoing calibration.
   */
  cancel() {
    if (!this._isCalibrating) return;

    this._cleanup();
    this._onProgress?.('cancelled', {});
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: AUTO-CALIBRATION
  // ═══════════════════════════════════════════════════════════════════════════

  /** @private */
  async _runAutoCalibration() {
    try {
      // Step 1: Configure
      this._step = 'configure';
      this._onProgress?.('configure', {
        referenceStandard: this._config.referenceStandard,
        targetLufs: this._config.targetLufs,
        standardName: this._config.standardName
      });

      // Step 2: Start tone and measure
      this._step = 'measure';

      // Store previous source mode for restoration
      this._previousSourceMode = this._sourceController.activeMode;

      // Start calibration tone
      await this._sourceController.startGenerator({
        type: CALIBRATION_TONE.type,
        freq: CALIBRATION_TONE.frequency,
        db: CALIBRATION_TONE.level,
        routing: 'stereo'
      });

      // Reset meters
      this._resetMeters?.();
      this._measurements = [];
      this._startTime = performance.now();

      // Measure for configured duration
      await this._measureLoop();

      // Step 3: Calculate and save
      this._completeAutoCalibration();

    } catch (error) {
      this._cleanup();
      this._onError?.(error);
    }
  }

  /** @private */
  _measureLoop() {
    return new Promise((resolve) => {
      this._intervalId = setInterval(() => {
        const elapsed = performance.now() - this._startTime;

        let momentary, shortTerm, integrated, truePeak;

        // Remote mode: read from metricsGetter
        if (this._remoteMode?.enabled && this._remoteMode.metricsGetter) {
          const remote = this._remoteMode.metricsGetter();
          momentary = remote.momentary ?? -Infinity;
          shortTerm = remote.shortTerm ?? -Infinity;
          integrated = remote.integrated ?? -Infinity;
          truePeak = remote.truePeak ?? -Infinity;
        } else {
          // Local mode: read from local meters
          const readings = this._lufsMeter.getReadings();
          const tpState = this._truePeakMeter.getState();
          momentary = readings.momentary;
          shortTerm = readings.shortTerm;
          integrated = readings.integrated;
          truePeak = Math.max(tpState.dbtpLeft, tpState.dbtpRight);
        }

        // Store measurement
        this._measurements.push({
          t: elapsed,
          m: momentary,
          s: shortTerm,
          i: integrated,
          tp: truePeak
        });

        // Report progress
        const progress = Math.min(1, elapsed / AUTO_CAL_CONFIG.duration);
        const confidence = this._calculateConfidence();

        this._onProgress?.('measure', {
          elapsed,
          duration: AUTO_CAL_CONFIG.duration,
          progress,
          momentary,
          shortTerm,
          integrated,
          truePeak,
          offset: isFinite(integrated)
            ? integrated - this._config.targetLufs
            : null,
          confidence,
          canFinishEarly: elapsed >= AUTO_CAL_CONFIG.minDuration &&
                          confidence >= AUTO_CAL_CONFIG.earlyFinishConfidence
        });

        // Check if complete
        if (elapsed >= AUTO_CAL_CONFIG.duration) {
          clearInterval(this._intervalId);
          this._intervalId = null;
          resolve();
        }
      }, AUTO_CAL_CONFIG.pollInterval);
    });
  }

  /** @private */
  _completeAutoCalibration() {
    this._step = 'calculate';

    const duration = performance.now() - this._startTime;

    let measuredLufs, measuredTp;

    // Remote mode: use remote metrics
    if (this._remoteMode?.enabled && this._remoteMode.metricsGetter) {
      const remote = this._remoteMode.metricsGetter();
      measuredLufs = remote.integrated ?? -Infinity;
      measuredTp = remote.truePeak ?? -Infinity;
    } else {
      // Local mode: use local meters
      const readings = this._lufsMeter.getReadings();
      const tpState = this._truePeakMeter.getState();
      measuredLufs = readings.integrated;
      measuredTp = Math.max(tpState.dbtpLeft, tpState.dbtpRight);
    }

    // Calculate trim offset: target - measured
    // If measured is −21 LUFS and target is −23 LUFS, offset is −2 dB
    const trimOffset = this._config.targetLufs - measuredLufs;
    const confidence = this._calculateConfidence();

    const result = {
      measuredLufs,
      measuredTp,
      trimOffset,
      duration,
      confidence,
      target: this._config.targetLufs,
      deviation: measuredLufs - this._config.targetLufs,
      passed: Math.abs(measuredLufs - this._config.targetLufs) <= this._config.tolerance
    };

    // Create profile but DON'T save yet - let UI handle save on user confirmation
    const profile = this._createProfile({
      measuredLufs,
      measuredTp,
      trimOffset,
      duration,
      confidence,
      method: 'auto'
    });

    // Include profile in result for UI to display and optionally edit name
    result.profile = profile;

    this._onProgress?.('calculate', result);
    this._cleanup();

    // Note: Profile is NOT saved here and onComplete is NOT called.
    // The UI should call saveCalibrationProfile() when user confirms,
    // then handle completion UI itself.
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: MANUAL CALIBRATION
  // ═══════════════════════════════════════════════════════════════════════════

  /** @private */
  _pollManualMeasurement() {
    const elapsed = performance.now() - this._startTime;

    let momentary, shortTerm, integrated, truePeak;

    // Remote mode: read from metricsGetter
    if (this._remoteMode?.enabled && this._remoteMode.metricsGetter) {
      const remote = this._remoteMode.metricsGetter();
      momentary = remote.momentary ?? -Infinity;
      shortTerm = remote.shortTerm ?? -Infinity;
      integrated = remote.integrated ?? -Infinity;
      truePeak = remote.truePeak ?? -Infinity;
    } else {
      // Local mode: read from local meters
      const readings = this._lufsMeter.getReadings();
      const tpState = this._truePeakMeter.getState();
      momentary = readings.momentary;
      shortTerm = readings.shortTerm;
      integrated = readings.integrated;
      truePeak = Math.max(tpState.dbtpLeft, tpState.dbtpRight);
    }

    // Store for confidence calculation
    this._measurements.push({
      t: elapsed,
      m: momentary,
      s: shortTerm,
      i: integrated,
      tp: truePeak
    });

    // Keep only last 60 seconds
    const cutoff = elapsed - 60000;
    this._measurements = this._measurements.filter(m => m.t > cutoff);

    const offset = isFinite(integrated)
      ? integrated - this._config.targetLufs
      : null;

    this._onProgress?.('adjust', {
      elapsed,
      momentary,
      shortTerm,
      integrated,
      truePeak,
      offset,
      confidence: this._calculateConfidence(),
      targetLufs: this._config.targetLufs,
      onTarget: offset !== null && Math.abs(offset) < 0.5
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Calculate measurement confidence based on stability.
   * Uses standard deviation of integrated loudness over confidence window.
   *
   * @private
   * @returns {number} Confidence percentage (0-100)
   */
  _calculateConfidence() {
    // Need minimum data
    if (this._measurements.length < 50) return 0;

    const now = performance.now() - this._startTime;
    const windowStart = now - AUTO_CAL_CONFIG.confidenceWindow;

    // Get integrated values from confidence window
    const recent = this._measurements
      .filter(m => m.t > windowStart && isFinite(m.i))
      .map(m => m.i);

    if (recent.length < 10) return 0;

    // Calculate standard deviation
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((sum, val) => sum + (val - mean) ** 2, 0) / recent.length;
    const stdDev = Math.sqrt(variance);

    // Map standard deviation to confidence:
    // σ < 0.1 LU = 100% confidence
    // σ > 1.0 LU = 0% confidence
    const confidence = Math.max(0, Math.min(100, (1 - stdDev) * 100));

    return Math.round(confidence);
  }

  /**
   * Create calibration profile object.
   *
   * @private
   * @param {Object} result - Calibration result data
   * @returns {CalibrationProfile}
   */
  _createProfile(result) {
    return {
      id: crypto.randomUUID(),
      deviceId: this._config.deviceId,
      deviceLabel: this._config.deviceLabel,
      profileName: this._config.profileName ||
        `${this._config.deviceLabel} @ ${new Date().toLocaleDateString('en-GB')}`,
      referenceStandard: this._config.referenceStandard,
      targetLufs: this._config.targetLufs,
      trimOffset: result.trimOffset,
      measuredLufs: result.measuredLufs,
      measuredTp: result.measuredTp,
      toneFrequency: CALIBRATION_TONE.frequency,
      toneLevel: CALIBRATION_TONE.level,
      method: result.method,
      calibratedAt: Date.now(),
      duration: result.duration,
      confidence: result.confidence,
      notes: ''
    };
  }

  /**
   * Clean up calibration state and resources.
   *
   * @private
   */
  _cleanup() {
    this._isCalibrating = false;
    this._mode = null;
    this._step = null;
    this._config = null;
    this._measurements = [];
    this._startTime = null;

    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }

    // Stop generator
    this._sourceController.stopGenerator();

    // Clear callbacks
    this._onProgress = null;
    this._onComplete = null;
    this._onError = null;
  }
}
