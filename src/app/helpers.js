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
 * HELPER FUNCTIONS MODULE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Re-exports common utilities from utils/ modules plus app-specific helpers.
 * This module provides a convenient single import for bootstrap.js.
 *
 * CANONICAL SOURCES
 * ─────────────────
 *   - Math utilities: ../utils/math.js
 *   - Format utilities: ../utils/format.js
 *
 * APP-SPECIFIC (defined here)
 * ───────────────────────────
 *   - getCss: Get CSS custom property value
 *   - loudnessColour: Get colour for LUFS value relative to target
 *
 * @module app/helpers
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// RE-EXPORTS FROM UTILS
// ─────────────────────────────────────────────────────────────────────────────

// Math utilities
export { dbToGain, clamp } from '../utils/math.js';

// Format utilities
export { formatDb, formatDbu, formatTime, formatCorr } from '../utils/format.js';

// ─────────────────────────────────────────────────────────────────────────────
// APP-SPECIFIC HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get CSS custom property value from document root.
 * @param {string} prop - CSS custom property name (e.g., '--ok')
 * @returns {string} Property value
 */
export function getCss(prop) {
  return getComputedStyle(document.documentElement).getPropertyValue(prop).trim();
}

/**
 * Get colour for LUFS value relative to target.
 * EXACT from audio-meters-grid.html lines 3691-3698
 *
 * @param {number} lufs - LUFS value
 * @param {number} targetLufs - Target LUFS value
 * @returns {string} CSS colour value
 */
export function loudnessColour(lufs, targetLufs) {
  if (!isFinite(lufs)) return 'var(--muted)';
  const offset = lufs - targetLufs;
  if (offset >= -1 && offset <= 1) return getCss('--ok');      // On target: green
  if (offset < -1) return getCss('--cyan');                     // Too quiet: cyan
  if (offset <= 3) return getCss('--warn');                     // Bit loud: amber
  return getCss('--hot');                                        // Too loud: red
}
