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
// DEFAULT COLOR PALETTE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default color palette for meters.
 * Matches CSS variables in the legacy stylesheet.
 * @type {Object<string, string>}
 */
export const DEFAULT_COLORS = {
  ok: '#00d4aa',        // Green - on target
  cyan: '#4488cc',      // Blue/Cyan - too quiet
  warn: '#ffaa00',      // Amber - bit loud
  caution: '#ff8800',   // Orange - approaching limit
  hot: '#ff4444',       // Red - over limit
  muted: '#666666',     // Gray - inactive/silent

  // Background colors
  bgPrimary: '#1a1a2e',
  bgSecondary: '#16213e',
  bgTertiary: '#0d1b2a',

  // Text colors
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
// LOUDNESS COLORS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get color for loudness value relative to target.
 * Based on EBU R128 guidance and TC/RTW conventions.
 *
 * @param {number} lufs - Measured loudness
 * @param {number} [target=-23] - Target loudness
 * @param {Object} [colors=DEFAULT_COLORS] - Color palette
 * @returns {string} CSS color
 */
export function getLoudnessColor(lufs, target = -23, colors = DEFAULT_COLORS) {
  if (!isFinite(lufs)) return colors.muted;

  const offset = lufs - target;

  if (offset >= -1 && offset <= 1) return colors.ok;    // ±1 LU: on target
  if (offset < -1) return colors.cyan;                   // Below -1 LU: too quiet
  if (offset <= 3) return colors.warn;                   // +1 to +3 LU: bit loud
  return colors.hot;                                      // Above +3 LU: too loud
}

/**
 * Get color for radar segment based on LUFS.
 *
 * @param {number} lufs - Loudness value
 * @param {number} [target=-23] - Target loudness
 * @param {Object} [colors=DEFAULT_COLORS] - Color palette
 * @returns {string} CSS color
 */
export function getRadarColor(lufs, target = -23, colors = DEFAULT_COLORS) {
  if (!isFinite(lufs)) return colors.muted;

  const lu = lufs - target;

  // EBU R128 defines < -12 LU as "low level"
  if (lu < -12) return colors.cyan;        // Low level (blue)
  if (lu < -1) return colors.ok;           // Normal low (green)
  if (lu <= 1) return colors.ok;           // On target (green)
  if (lu <= 3) return colors.warn;         // Bit loud (amber)
  return colors.hot;                         // Too loud (red)
}

// ─────────────────────────────────────────────────────────────────────────────
// TRUE PEAK COLORS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get color for True Peak value.
 *
 * @param {number} dbTP - True Peak in dBTP
 * @param {number} [limit=-1] - TP limit (EBU R128 default: -1 dBTP)
 * @param {Object} [colors=DEFAULT_COLORS] - Color palette
 * @returns {string} CSS color
 */
export function getTruePeakColor(dbTP, limit = -1, colors = DEFAULT_COLORS) {
  if (!isFinite(dbTP) || dbTP < -60) return colors.muted;

  if (dbTP >= limit) return colors.hot;           // Over limit
  if (dbTP >= limit - 3) return colors.caution;   // Approaching limit
  if (dbTP >= limit - 6) return colors.warn;      // Warning zone
  return colors.ok;                                 // Safe
}

/**
 * Get color for True Peak bar segment.
 *
 * @param {number} dbTP - Level of this segment
 * @param {number} [limit=-1] - TP limit
 * @param {Object} [colors=DEFAULT_COLORS] - Color palette
 * @returns {string} CSS color
 */
export function getTruePeakBarColor(dbTP, limit = -1, colors = DEFAULT_COLORS) {
  if (dbTP >= 0) return colors.hot;              // Clipping
  if (dbTP >= limit) return colors.caution;      // Over limit
  if (dbTP >= -6) return colors.warn;            // -6 to limit
  if (dbTP >= -18) return colors.ok;             // Normal range
  return colors.cyan;                             // Low level
}

// ─────────────────────────────────────────────────────────────────────────────
// PPM COLORS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get color for PPM bar segment based on Nordic/DIN scale.
 *
 * @param {number} ppm - PPM level (0 = reference)
 * @param {Object} [colors=DEFAULT_COLORS] - Color palette
 * @returns {string} CSS color
 */
export function getPPMBarColor(ppm, colors = DEFAULT_COLORS) {
  if (ppm >= 6) return colors.hot;       // +6 and above (TEST and above)
  if (ppm >= 0) return colors.warn;      // 0 to +6 (above reference)
  if (ppm >= -9) return colors.ok;       // -9 to 0 (normal range)
  return colors.cyan;                     // Below -9 (low level)
}

// ─────────────────────────────────────────────────────────────────────────────
// CORRELATION COLORS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get color for phase correlation value.
 *
 * @param {number} correlation - Correlation coefficient (-1 to +1)
 * @param {Object} [colors=DEFAULT_COLORS] - Color palette
 * @returns {string} CSS color
 */
export function getCorrelationColor(correlation, colors = DEFAULT_COLORS) {
  if (!isFinite(correlation)) return colors.muted;

  if (correlation >= 0.3) return colors.ok;      // Good correlation
  if (correlation >= -0.3) return colors.warn;   // Moderate (wide stereo)
  return colors.hot;                               // Anti-phase (problem)
}

// ─────────────────────────────────────────────────────────────────────────────
// BALANCE COLORS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get color for L/R balance deviation.
 *
 * @param {number} balanceDb - Balance deviation in dB
 * @param {Object} [colors=DEFAULT_COLORS] - Color palette
 * @returns {string} CSS color
 */
export function getBalanceColor(balanceDb, colors = DEFAULT_COLORS) {
  const abs = Math.abs(balanceDb);

  if (abs < 1.5) return colors.ok;       // Good balance
  if (abs < 3) return colors.cyan;       // Slight deviation
  if (abs < 6) return colors.warn;       // Noticeable
  return colors.hot;                       // Severe imbalance
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
 * @param {Object} [colors=DEFAULT_COLORS] - Color palette
 * @returns {CanvasGradient} Meter gradient
 */
export function createMeterGradient(ctx, x, y, width, height, direction = 'horizontal', colors = DEFAULT_COLORS) {
  let gradient;
  if (direction === 'horizontal') {
    gradient = ctx.createLinearGradient(x, y, x + width, y);
  } else {
    gradient = ctx.createLinearGradient(x, y + height, x, y);
  }

  // Standard meter gradient: cyan → green → amber → red
  gradient.addColorStop(0, colors.cyan);
  gradient.addColorStop(0.4, colors.ok);
  gradient.addColorStop(0.7, colors.warn);
  gradient.addColorStop(0.9, colors.caution);
  gradient.addColorStop(1, colors.hot);

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
 * @param {Object} [colors=DEFAULT_COLORS] - Color palette
 * @returns {CanvasGradient} TP meter gradient
 */
export function createTPGradient(ctx, x, y, width, height, direction = 'horizontal', colors = DEFAULT_COLORS) {
  let gradient;
  if (direction === 'horizontal') {
    gradient = ctx.createLinearGradient(x, y, x + width, y);
  } else {
    gradient = ctx.createLinearGradient(x, y + height, x, y);
  }

  // TP gradient: more headroom indication
  gradient.addColorStop(0, colors.cyan);
  gradient.addColorStop(0.3, colors.ok);
  gradient.addColorStop(0.8, colors.ok);
  gradient.addColorStop(0.9, colors.warn);
  gradient.addColorStop(0.95, colors.caution);
  gradient.addColorStop(1, colors.hot);

  return gradient;
}

// ─────────────────────────────────────────────────────────────────────────────
// THEME SUPPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get colors from CSS variables.
 *
 * @returns {Object<string, string>} Colors from CSS
 */
export function getColorsFromCSS() {
  const style = getComputedStyle(document.documentElement);
  const get = (name) => style.getPropertyValue(`--${name}`).trim();

  return {
    ok: get('ok') || DEFAULT_COLORS.ok,
    cyan: get('cyan') || DEFAULT_COLORS.cyan,
    warn: get('warn') || DEFAULT_COLORS.warn,
    caution: get('caution') || DEFAULT_COLORS.caution,
    hot: get('hot') || DEFAULT_COLORS.hot,
    muted: get('muted') || DEFAULT_COLORS.muted,
    bgPrimary: get('bg-primary') || DEFAULT_COLORS.bgPrimary,
    bgSecondary: get('bg-secondary') || DEFAULT_COLORS.bgSecondary,
    textPrimary: get('text-primary') || DEFAULT_COLORS.textPrimary,
    accent: get('accent') || DEFAULT_COLORS.accent
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BRITISH ENGLISH ALIASES
// ─────────────────────────────────────────────────────────────────────────────
// Aliases using British spelling for TCIS compliance.
// Internal implementation retains "color" for CSS property compatibility.

export {
  DEFAULT_COLORS as DEFAULT_COLOURS,
  getLoudnessColor as getLoudnessColour,
  getRadarColor as getRadarColour,
  getTruePeakColor as getTruePeakColour,
  getTruePeakBarColor as getTruePeakBarColour,
  getPPMBarColor as getPPMBarColour,
  getCorrelationColor as getCorrelationColour,
  getBalanceColor as getBalanceColour,
  getColorsFromCSS as getColoursFromCSS
};
