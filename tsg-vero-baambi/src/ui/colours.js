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
 * METER COLOUR SCHEMES
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * ───────
 * Colour definitions and functions for broadcast meter displays.
 * Based on RTW, DK-Audio, and TC Electronic meter conventions.
 *
 * COLOUR ZONES
 * ────────────
 *   OK (Green)     - Signal within target range
 *   Cyan (Blue)    - Signal below target (too quiet)
 *   Warn (Amber)   - Signal above target (bit loud)
 *   Hot (Red)      - Signal exceeding limits (danger)
 *   Muted (Grey)   - No signal / inactive
 *
 * @module ui/colours
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT COLOUR PALETTE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default colour palette for meters.
 * Matches CSS variables in the legacy stylesheet.
 * @type {Object<string, string>}
 */
export const DEFAULT_COLOURS = {
  ok: '#00d4aa',        // Green - on target
  cyan: '#4488cc',      // Blue/Cyan - too quiet
  warn: '#ffaa00',      // Amber - bit loud
  caution: '#ff8800',   // Orange - approaching limit
  hot: '#ff4444',       // Red - over limit
  muted: '#666666',     // Grey - inactive/silent

  // Background colours
  bgPrimary: '#1a1a2e',
  bgSecondary: '#16213e',
  bgTertiary: '#0d1b2a',

  // Text colours
  textPrimary: '#e0e0e0',
  textSecondary: '#88a3bf',
  textMuted: '#4b5563',

  // Accent
  accent: '#00d4aa',

  // Meter specific
  meterBg: '#0f1214',
  meterGrid: '#3a4855',
  meterGlow: 'rgba(0, 212, 170, 0.3)'
};

// ─────────────────────────────────────────────────────────────────────────────
// LOUDNESS COLOURS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get colour for loudness value relative to target.
 * Based on EBU R128 guidance and TC/RTW conventions.
 *
 * @param {number} lufs - Measured loudness
 * @param {number} [target=-23] - Target loudness
 * @param {Object} [colours=DEFAULT_COLOURS] - Colour palette
 * @returns {string} CSS colour
 */
export function getLoudnessColour(lufs, target = -23, colours = DEFAULT_COLOURS) {
  if (!isFinite(lufs)) return colours.muted;

  const offset = lufs - target;

  if (offset >= -1 && offset <= 1) return colours.ok;    // ±1 LU: on target
  if (offset < -1) return colours.cyan;                   // Below -1 LU: too quiet
  if (offset <= 3) return colours.warn;                   // +1 to +3 LU: bit loud
  return colours.hot;                                      // Above +3 LU: too loud
}

/**
 * Get colour for radar segment based on LUFS.
 *
 * @param {number} lufs - Loudness value
 * @param {number} [target=-23] - Target loudness
 * @param {Object} [colours=DEFAULT_COLOURS] - Colour palette
 * @returns {string} CSS colour
 */
export function getRadarColour(lufs, target = -23, colours = DEFAULT_COLOURS) {
  if (!isFinite(lufs)) return colours.muted;

  const lu = lufs - target;

  // EBU R128 defines < -12 LU as "low level"
  if (lu < -12) return colours.cyan;        // Low level (blue)
  if (lu < -1) return colours.ok;           // Normal low (green)
  if (lu <= 1) return colours.ok;           // On target (green)
  if (lu <= 3) return colours.warn;         // Bit loud (amber)
  return colours.hot;                         // Too loud (red)
}

// ─────────────────────────────────────────────────────────────────────────────
// TRUE PEAK COLOURS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get colour for True Peak value.
 *
 * @param {number} dbTP - True Peak in dBTP
 * @param {number} [limit=-1] - TP limit (EBU R128 default: -1 dBTP)
 * @param {Object} [colours=DEFAULT_COLOURS] - Colour palette
 * @returns {string} CSS colour
 */
export function getTruePeakColour(dbTP, limit = -1, colours = DEFAULT_COLOURS) {
  if (!isFinite(dbTP) || dbTP < -60) return colours.muted;

  if (dbTP >= limit) return colours.hot;           // Over limit
  if (dbTP >= limit - 3) return colours.caution;   // Approaching limit
  if (dbTP >= limit - 6) return colours.warn;      // Warning zone
  return colours.ok;                                 // Safe
}

/**
 * Get colour for True Peak bar segment.
 *
 * @param {number} dbTP - Level of this segment
 * @param {number} [limit=-1] - TP limit
 * @param {Object} [colours=DEFAULT_COLOURS] - Colour palette
 * @returns {string} CSS colour
 */
export function getTruePeakBarColour(dbTP, limit = -1, colours = DEFAULT_COLOURS) {
  if (dbTP >= 0) return colours.hot;              // Clipping
  if (dbTP >= limit) return colours.caution;      // Over limit
  if (dbTP >= -6) return colours.warn;            // -6 to limit
  if (dbTP >= -18) return colours.ok;             // Normal range
  return colours.cyan;                             // Low level
}

// ─────────────────────────────────────────────────────────────────────────────
// PPM COLOURS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get colour for PPM bar segment based on Nordic/DIN scale.
 *
 * @param {number} ppm - PPM level (0 = reference)
 * @param {Object} [colours=DEFAULT_COLOURS] - Colour palette
 * @returns {string} CSS colour
 */
export function getPPMBarColour(ppm, colours = DEFAULT_COLOURS) {
  if (ppm >= 6) return colours.hot;       // +6 and above (TEST and above)
  if (ppm >= 0) return colours.warn;      // 0 to +6 (above reference)
  if (ppm >= -9) return colours.ok;       // -9 to 0 (normal range)
  return colours.cyan;                     // Below -9 (low level)
}

// ─────────────────────────────────────────────────────────────────────────────
// CORRELATION COLOURS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get colour for phase correlation value.
 *
 * @param {number} correlation - Correlation coefficient (-1 to +1)
 * @param {Object} [colours=DEFAULT_COLOURS] - Colour palette
 * @returns {string} CSS colour
 */
export function getCorrelationColour(correlation, colours = DEFAULT_COLOURS) {
  if (!isFinite(correlation)) return colours.muted;

  if (correlation >= 0.3) return colours.ok;      // Good correlation
  if (correlation >= -0.3) return colours.warn;   // Moderate (wide stereo)
  return colours.hot;                               // Anti-phase (problem)
}

// ─────────────────────────────────────────────────────────────────────────────
// BALANCE COLOURS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get colour for L/R balance deviation.
 *
 * @param {number} balanceDb - Balance deviation in dB
 * @param {Object} [colours=DEFAULT_COLOURS] - Colour palette
 * @returns {string} CSS colour
 */
export function getBalanceColour(balanceDb, colours = DEFAULT_COLOURS) {
  const abs = Math.abs(balanceDb);

  if (abs < 1.5) return colours.ok;       // Good balance
  if (abs < 3) return colours.cyan;       // Slight deviation
  if (abs < 6) return colours.warn;       // Noticeable
  return colours.hot;                       // Severe imbalance
}

// ─────────────────────────────────────────────────────────────────────────────
// GRADIENT HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a meter gradient for Canvas.
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} x - Start X
 * @param {number} y - Start Y
 * @param {number} width - Gradient width
 * @param {number} height - Gradient height
 * @param {'horizontal'|'vertical'} [direction='horizontal'] - Gradient direction
 * @param {Object} [colours=DEFAULT_COLOURS] - Colour palette
 * @returns {CanvasGradient} Meter gradient
 */
export function createMeterGradient(ctx, x, y, width, height, direction = 'horizontal', colours = DEFAULT_COLOURS) {
  let gradient;
  if (direction === 'horizontal') {
    gradient = ctx.createLinearGradient(x, y, x + width, y);
  } else {
    gradient = ctx.createLinearGradient(x, y + height, x, y);
  }

  // Standard meter gradient: cyan → green → amber → red
  gradient.addColorStop(0, colours.cyan);
  gradient.addColorStop(0.4, colours.ok);
  gradient.addColorStop(0.7, colours.warn);
  gradient.addColorStop(0.9, colours.caution);
  gradient.addColorStop(1, colours.hot);

  return gradient;
}

/**
 * Create a TP meter gradient (more green, red only at top).
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} x - Start X
 * @param {number} y - Start Y
 * @param {number} width - Gradient width
 * @param {number} height - Gradient height
 * @param {'horizontal'|'vertical'} [direction='horizontal'] - Gradient direction
 * @param {Object} [colours=DEFAULT_COLOURS] - Colour palette
 * @returns {CanvasGradient} TP meter gradient
 */
export function createTPGradient(ctx, x, y, width, height, direction = 'horizontal', colours = DEFAULT_COLOURS) {
  let gradient;
  if (direction === 'horizontal') {
    gradient = ctx.createLinearGradient(x, y, x + width, y);
  } else {
    gradient = ctx.createLinearGradient(x, y + height, x, y);
  }

  // TP gradient: more headroom indication
  gradient.addColorStop(0, colours.cyan);
  gradient.addColorStop(0.3, colours.ok);
  gradient.addColorStop(0.8, colours.ok);
  gradient.addColorStop(0.9, colours.warn);
  gradient.addColorStop(0.95, colours.caution);
  gradient.addColorStop(1, colours.hot);

  return gradient;
}

// ─────────────────────────────────────────────────────────────────────────────
// THEME SUPPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get colours from CSS variables.
 *
 * @returns {Object<string, string>} Colours from CSS
 */
export function getColoursFromCSS() {
  const style = getComputedStyle(document.documentElement);
  const get = (name) => style.getPropertyValue(`--${name}`).trim();

  return {
    ok: get('ok') || DEFAULT_COLOURS.ok,
    cyan: get('cyan') || DEFAULT_COLOURS.cyan,
    warn: get('warn') || DEFAULT_COLOURS.warn,
    caution: get('caution') || DEFAULT_COLOURS.caution,
    hot: get('hot') || DEFAULT_COLOURS.hot,
    muted: get('muted') || DEFAULT_COLOURS.muted,
    bgPrimary: get('bg-primary') || DEFAULT_COLOURS.bgPrimary,
    bgSecondary: get('bg-secondary') || DEFAULT_COLOURS.bgSecondary,
    textPrimary: get('text-primary') || DEFAULT_COLOURS.textPrimary,
    accent: get('accent') || DEFAULT_COLOURS.accent
  };
}

