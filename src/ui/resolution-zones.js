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
 * VISUAL RESOLUTION ZONES
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * ───────
 * Provides zone-based visual sub-resolution ("sub-LED density") on top of the
 * existing 0.5 dB logical grid, matching broadcast (RTW / DK / Nordic) perceptual
 * standards.
 *
 * CONCEPT
 * ───────
 * The resolution multiplier controls how many visual sub-cells are drawn per
 * existing 0.5 dB unit. This creates denser visuals in critical regions without
 * changing the underlying meter scale or ballistics.
 *
 * - Maximum multiplier is x4, minimum is x2 (calmer visuals)
 * - Zone boundaries align with meaningful working ranges
 * - x2 for background, x4 for active working zones
 *
 * IMPLEMENTATION
 * ──────────────
 * Profiles are pure data. The rendering engine queries the profile to determine
 * subdivision for each dB position. No ballistics or scale math is modified.
 *
 * @module ui/resolution-zones
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// RESOLUTION PROFILE TYPE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ResolutionZone
 * @property {number} from - Start of zone (inclusive), in dB
 * @property {number} to - End of zone (exclusive), in dB
 * @property {number} multiplier - Visual subdivision multiplier (2 or 4)
 */

/**
 * @typedef {ResolutionZone[]} ResolutionProfile
 * Ordered list of zones from low to high dB values
 */

// ─────────────────────────────────────────────────────────────────────────────
// RMS dBFS PROFILE (−60 → 0 dBFS)
// ─────────────────────────────────────────────────────────────────────────────
// Range: 60 dB, TEST at -21 dBFS RMS (-18 dBFS peak for sine)
// Colour zones align with dBFS scale markers

/**
 * Resolution profile for RMS/dBFS meter
 * Multipliers: x2 (low), x4 (high) only for visual clarity
 * @type {ResolutionProfile}
 */
export const RESOLUTION_PROFILE_DBFS = [
  { from: -60, to: -18, multiplier: 2 },  // Background to TEST level
  { from: -18, to: 0,   multiplier: 4 },  // TEST and above (working range)
];

// ─────────────────────────────────────────────────────────────────────────────
// TRUE PEAK dBTP PROFILE (−60 → +3 dBTP)
// ─────────────────────────────────────────────────────────────────────────────
// Range: 63 dB, 0 dBTP fence at digital maximum
// Higher resolution near clipping to catch intersample peaks

/**
 * Resolution profile for True Peak meter
 * Multipliers: x2 (low), x4 (high) only for visual clarity
 * @type {ResolutionProfile}
 */
export const RESOLUTION_PROFILE_TP = [
  { from: -60, to: -12, multiplier: 2 },  // Background to warm zone
  { from: -12, to: 3,   multiplier: 4 },  // Working range and above
];

// ─────────────────────────────────────────────────────────────────────────────
// NORDIC PPM PROFILE (−54 → −9 dBFS / −36 → +9 PPM)
// ─────────────────────────────────────────────────────────────────────────────
// Range: 45 dB, TEST at 0 PPM (-18 dBFS), PML at +9 PPM (-9 dBFS)
// Zones match Nordic colour conventions

/**
 * Resolution profile for Nordic PPM meter
 * Multipliers: x2 (low), x4 (high) only for visual clarity
 * Note: Values are in dBFS (use -18 offset from PPM values)
 * @type {ResolutionProfile}
 */
export const RESOLUTION_PROFILE_PPM = [
  { from: -54, to: -24, multiplier: 2 },  // Background (-36 to -6 PPM)
  { from: -24, to: -9,  multiplier: 4 },  // Working range (-6 to +9 PPM)
];

// Extended profile with same multipliers (for backward compat)
export const RESOLUTION_PROFILE_PPM_EXTENDED = [
  { from: -54, to: -24, multiplier: 2 },  // Background (-36 to -6 PPM)
  { from: -24, to: -9,  multiplier: 4 },  // Working range (-6 to +9 PPM)
];

// ─────────────────────────────────────────────────────────────────────────────
// RESOLUTION LOOKUP FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the visual resolution multiplier for a given dB value.
 *
 * @param {number} db - The dB value to query
 * @param {ResolutionProfile} profile - The resolution profile to use
 * @returns {number} The subdivision multiplier (2 or 4)
 *
 * @example
 * const mult = getResolutionMultiplier(-18, RESOLUTION_PROFILE_DBFS); // returns 4
 * const mult = getResolutionMultiplier(-2, RESOLUTION_PROFILE_TP);    // returns 4
 */
export function getResolutionMultiplier(db, profile) {
  for (const zone of profile) {
    if (db >= zone.from && db < zone.to) {
      return zone.multiplier;
    }
  }
  // Default fallback (should not happen if profile covers full range)
  return 2;
}

/**
 * Get all zone boundaries for a profile (for alignment verification).
 *
 * @param {ResolutionProfile} profile - The resolution profile
 * @returns {number[]} Array of dB values where zones change
 */
export function getZoneBoundaries(profile) {
  const boundaries = new Set();
  for (const zone of profile) {
    boundaries.add(zone.from);
    boundaries.add(zone.to);
  }
  return Array.from(boundaries).sort((a, b) => a - b);
}

/**
 * Calculate the total number of visual sub-cells for a meter range.
 * This is informational - the actual rendering calculates positions dynamically.
 *
 * @param {number} rangeMin - Minimum dB value
 * @param {number} rangeMax - Maximum dB value
 * @param {number} baseStep - Base step size in dB (typically 0.5)
 * @param {ResolutionProfile} profile - Resolution profile to use
 * @returns {number} Total visual sub-cells
 */
export function calculateTotalSubCells(rangeMin, rangeMax, baseStep, profile) {
  let total = 0;
  for (let db = rangeMin; db < rangeMax; db += baseStep) {
    const mult = getResolutionMultiplier(db, profile);
    total += mult;
  }
  return total;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRECOMPUTED SUB-CELL LAYOUTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SubCellInfo
 * @property {number} db - The base dB value (at 0.5 dB resolution)
 * @property {number} subIndex - Sub-cell index within this base cell (0 to multiplier-1)
 * @property {number} subDb - Precise dB value for this sub-cell
 * @property {number} multiplier - The zone's multiplier
 */

/**
 * Generate a precomputed layout of all sub-cells for a meter range.
 * This allows efficient rendering without repeated profile lookups.
 *
 * @param {number} rangeMin - Minimum dB value
 * @param {number} rangeMax - Maximum dB value
 * @param {number} baseStep - Base step size in dB (typically 0.5)
 * @param {ResolutionProfile} profile - Resolution profile to use
 * @returns {SubCellInfo[]} Array of all sub-cells in order
 */
export function generateSubCellLayout(rangeMin, rangeMax, baseStep, profile) {
  const layout = [];

  for (let db = rangeMin; db < rangeMax; db += baseStep) {
    const mult = getResolutionMultiplier(db, profile);
    const subStep = baseStep / mult;

    for (let sub = 0; sub < mult; sub++) {
      layout.push({
        db,
        subIndex: sub,
        subDb: db + sub * subStep,
        multiplier: mult
      });
    }
  }

  return layout;
}

/**
 * Calculate position ratio (0-1) for a dB value within a range.
 * Used to convert dB to pixel position.
 *
 * @param {number} db - The dB value
 * @param {number} rangeMin - Minimum dB value
 * @param {number} rangeMax - Maximum dB value
 * @returns {number} Position ratio (0 at rangeMin, 1 at rangeMax)
 */
export function dbToPositionRatio(db, rangeMin, rangeMax) {
  const clamped = Math.max(rangeMin, Math.min(rangeMax, db));
  return (clamped - rangeMin) / (rangeMax - rangeMin);
}
