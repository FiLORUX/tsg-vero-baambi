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
 * Pure utility functions with no external dependencies.
 * Used throughout the application for common operations.
 *
 * @module app/helpers
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// MATH HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert decibels to linear gain.
 * @param {number} dB - Decibel value
 * @returns {number} Linear gain value
 */
export const dbToGain = dB => Math.pow(10, dB / 20);

/**
 * Clamp a value between min and max.
 * @param {number} v - Value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 */
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// ─────────────────────────────────────────────────────────────────────────────
// FORMAT HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format dB value with fixed precision.
 * @param {number} value - dB value
 * @param {number} [decimals=1] - Decimal places
 * @param {number} [width=5] - Minimum string width
 * @returns {string} Formatted string
 */
export function formatDb(value, decimals = 1, width = 5) {
  if (!isFinite(value) || value < -99) return '--.-'.padStart(width);
  return value.toFixed(decimals).padStart(width);
}

/**
 * Format dBu value for PPM display with snap-to-zero.
 * EXACT from audio-meters-grid.html lines 2080-2086
 *
 * @param {number} value - dBu value
 * @param {number} [decimals=1] - Decimal places
 * @param {number} [snapWindow=0.25] - Range around zero to snap to zero
 * @param {number} [width=5] - Minimum string width
 * @returns {string} Formatted string with +/- sign
 */
export function formatDbu(value, decimals = 1, snapWindow = 0.25, width = 5) {
  if (!isFinite(value) || value < -99) return '--.-'.padStart(width);
  const snapped = (Math.abs(value) < snapWindow) ? 0 : value;
  const sign = snapped >= 0 ? '+' : '';
  return (sign + snapped.toFixed(decimals)).padStart(width);
}

/**
 * Format milliseconds as HH:MM:SS.
 * @param {number} ms - Milliseconds
 * @returns {string} Formatted time string
 */
export function formatTime(ms) {
  if (!isFinite(ms) || ms < 0) return '--:--:--';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS HELPERS
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
 * Format correlation value for display.
 * @param {number} v - Correlation value (-1 to +1)
 * @returns {string} Formatted string with sign
 */
export function formatCorr(v) {
  const sign = v >= 0 ? '+' : '';
  return sign + v.toFixed(2);
}

// ─────────────────────────────────────────────────────────────────────────────
// LOUDNESS COLOUR
// ─────────────────────────────────────────────────────────────────────────────

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
