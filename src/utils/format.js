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
 * DISPLAY FORMATTING UTILITIES
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * ───────
 * Fixed-width formatters for broadcast meter displays. All functions produce
 * consistent character widths to prevent UI "jumping" when values change.
 *
 * DESIGN PRINCIPLES
 * ─────────────────
 * - Fixed-width output for monospace-friendly display
 * - Consistent handling of edge cases (NaN, Infinity, out-of-range)
 * - Locale-independent decimal formatting (always uses ".")
 * - Sign handling appropriate for each measurement type
 *
 * PERFORMANCE
 * ───────────
 * Frequently-called formatters use pre-computed lookup tables to eliminate
 * toFixed()/padStart() calls and string allocations on every frame. Tables
 * are lazily initialised on first use.
 *
 * @module utils/format
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// PRE-COMPUTED LOOKUP TABLES
// ─────────────────────────────────────────────────────────────────────────────
// Eliminates toFixed()/padStart() calls on hot paths. Tables are initialised
// lazily on first use to avoid startup cost if not needed.

/** @type {Map<number, string>|null} dB lookup: key = value * 10, value = formatted string */
let dbLookup = null;

/** @type {Map<number, string>|null} dBu lookup with sign: key = value * 10 */
let dbuLookup = null;

/** @type {Map<number, string>|null} Correlation lookup: key = value * 100 */
let corrLookup = null;

/** @type {Map<number, string>|null} LUFS lookup: key = value * 10 */
let lufsLookup = null;

/**
 * Initialise dB lookup table (-99.9 to +30.0 dB, 0.1 resolution).
 * @private
 */
function initDbLookup() {
  if (dbLookup) return;
  dbLookup = new Map();
  // Range: -99.9 to +30.0 in 0.1 steps
  for (let i = -999; i <= 300; i++) {
    const value = i / 10;
    dbLookup.set(i, value.toFixed(1).padStart(5));
  }
  // Special value for out-of-range/NaN
  dbLookup.set(-Infinity, '--.-'.padStart(5));
}

/**
 * Initialise dBu lookup table with explicit sign (-99.9 to +30.0 dB, 0.1 resolution).
 * @private
 */
function initDbuLookup() {
  if (dbuLookup) return;
  dbuLookup = new Map();
  for (let i = -999; i <= 300; i++) {
    const value = i / 10;
    const sign = value >= 0 ? '+' : '';
    dbuLookup.set(i, (sign + value.toFixed(1)).padStart(5));
  }
  dbuLookup.set(-Infinity, '--.-'.padStart(5));
}

/**
 * Initialise correlation lookup table (-1.00 to +1.00, 0.01 resolution).
 * @private
 */
function initCorrLookup() {
  if (corrLookup) return;
  corrLookup = new Map();
  for (let i = -100; i <= 100; i++) {
    const value = i / 100;
    const sign = value >= 0 ? '+' : '';
    corrLookup.set(i, sign + value.toFixed(2));
  }
  corrLookup.set(-Infinity, '+-.--');
}

/**
 * Initialise LUFS lookup table (-99.9 to +10.0, 0.1 resolution).
 * @private
 */
function initLufsLookup() {
  if (lufsLookup) return;
  lufsLookup = new Map();
  for (let i = -999; i <= 100; i++) {
    const value = i / 10;
    lufsLookup.set(i, value.toFixed(1).padStart(5) + ' LUFS');
  }
  lufsLookup.set(-Infinity, '--.- LUFS');
}

// ─────────────────────────────────────────────────────────────────────────────
// dB FORMATTERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format dB value with fixed width.
 * Output like: "-23.4", " -3.4", "  0.0"
 *
 * Uses pre-computed lookup table for default parameters (decimals=1, width=5)
 * to eliminate string allocations on hot render paths.
 *
 * @param {number} value - dB value to format
 * @param {number} [decimals=1] - Decimal places
 * @param {number} [width=5] - Total character width including sign
 * @returns {string} Formatted string, padded to width
 *
 * @example
 * formatDb(-23.4) // "-23.4"
 * formatDb(-3.4)  // " -3.4"
 * formatDb(0)     // "  0.0"
 * formatDb(NaN)   // "--.-"
 */
export function formatDb(value, decimals = 1, width = 5) {
  // Fast path: use lookup table for default parameters
  if (decimals === 1 && width === 5) {
    if (!dbLookup) initDbLookup();
    if (!isFinite(value) || value < -99) {
      return dbLookup.get(-Infinity);
    }
    // Quantise to 0.1 resolution and clamp to table range
    const key = Math.round(value * 10);
    if (key >= -999 && key <= 300) {
      return dbLookup.get(key);
    }
  }

  // Fallback for non-default parameters
  if (!isFinite(value) || value < -99) {
    return '--.-'.padStart(width);
  }
  return value.toFixed(decimals).padStart(width);
}

/**
 * Format dBu value with snap-to-zero for PPM displays.
 * Always includes +/- sign. Values near zero snap to exactly 0.
 *
 * Uses pre-computed lookup table for default parameters to eliminate
 * string allocations on hot render paths.
 *
 * @param {number} value - dBu value to format
 * @param {number} [decimals=1] - Decimal places
 * @param {number} [snapWindow=0.25] - Values within this range snap to 0
 * @param {number} [width=5] - Total character width
 * @returns {string} Formatted string with sign
 *
 * @example
 * formatDbu(3.5)   // "+3.5"
 * formatDbu(-6.2)  // "-6.2"
 * formatDbu(0.1)   // "+0.0" (snapped to zero)
 */
export function formatDbu(value, decimals = 1, snapWindow = 0.25, width = 5) {
  // Fast path: use lookup table for default parameters
  if (decimals === 1 && width === 5) {
    if (!dbuLookup) initDbuLookup();
    if (!isFinite(value) || value < -99) {
      return dbuLookup.get(-Infinity);
    }
    // Apply snap-to-zero, then quantise
    const snapped = (Math.abs(value) < snapWindow) ? 0 : value;
    const key = Math.round(snapped * 10);
    if (key >= -999 && key <= 300) {
      return dbuLookup.get(key);
    }
  }

  // Fallback for non-default parameters
  if (!isFinite(value) || value < -99) {
    return '--.-'.padStart(width);
  }
  const snapped = (Math.abs(value) < snapWindow) ? 0 : value;
  const sign = snapped >= 0 ? '+' : '';
  return (sign + snapped.toFixed(decimals)).padStart(width);
}

/**
 * Format dB value with explicit +/- sign.
 * For offset displays like LU deviation.
 *
 * @param {number} value - dB value to format
 * @param {number} [decimals=1] - Decimal places
 * @param {number} [width=5] - Total character width
 * @returns {string} Formatted string with sign
 *
 * @example
 * formatDbSigned(2.5)  // "+2.5"
 * formatDbSigned(-1.3) // "-1.3"
 * formatDbSigned(0)    // "+0.0"
 */
export function formatDbSigned(value, decimals = 1, width = 5) {
  if (!isFinite(value) || Math.abs(value) > 99) {
    return '--.-'.padStart(width);
  }
  const sign = value >= 0 ? '+' : '';
  return (sign + value.toFixed(decimals)).padStart(width);
}

// ─────────────────────────────────────────────────────────────────────────────
// LOUDNESS FORMATTERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format LUFS value for loudness displays.
 *
 * Uses pre-computed lookup table for default parameters to eliminate
 * string allocations on hot render paths.
 *
 * @param {number} value - LUFS value
 * @param {number} [decimals=1] - Decimal places
 * @returns {string} Formatted string with " LUFS" suffix
 *
 * @example
 * formatLufs(-23.0) // "-23.0 LUFS"
 * formatLufs(-Infinity) // "--.- LUFS"
 */
export function formatLufs(value, decimals = 1) {
  // Fast path: use lookup table for default decimals
  if (decimals === 1) {
    if (!lufsLookup) initLufsLookup();
    if (!isFinite(value) || value < -99) {
      return lufsLookup.get(-Infinity);
    }
    const key = Math.round(value * 10);
    if (key >= -999 && key <= 100) {
      return lufsLookup.get(key);
    }
  }

  // Fallback for non-default parameters
  if (!isFinite(value) || value < -99) {
    return '--.- LUFS';
  }
  return value.toFixed(decimals).padStart(5) + ' LUFS';
}

/**
 * Format Loudness Range (LRA) value.
 *
 * @param {number|null} value - LRA value in LU, or null if insufficient data
 * @param {number} [decimals=1] - Decimal places
 * @returns {string} Formatted string with " LU" suffix
 *
 * @example
 * formatLRA(8.5)   // " 8.5 LU"
 * formatLRA(null)  // "--.- LU"
 */
export function formatLRA(value, decimals = 1) {
  if (value === null || !isFinite(value)) {
    return '--.- LU';
  }
  return value.toFixed(decimals).padStart(4) + ' LU';
}

// ─────────────────────────────────────────────────────────────────────────────
// STEREO FORMATTERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format correlation coefficient (-1.00 to +1.00).
 *
 * Uses pre-computed lookup table to eliminate string allocations
 * on hot render paths.
 *
 * @param {number} value - Correlation value
 * @returns {string} Formatted string with sign
 *
 * @example
 * formatCorr(0.85)  // "+0.85"
 * formatCorr(-0.42) // "-0.42"
 */
export function formatCorr(value) {
  if (!corrLookup) initCorrLookup();

  if (!isFinite(value)) {
    return corrLookup.get(-Infinity);
  }

  // Clamp to valid range and quantise to 0.01 resolution
  const clamped = Math.max(-1, Math.min(1, value));
  const key = Math.round(clamped * 100);
  return corrLookup.get(key);
}

/**
 * Format balance as L/R indication.
 *
 * @param {number} balanceDb - Balance in dB (positive = L louder)
 * @returns {string} Human-readable balance string
 *
 * @example
 * formatBalance(3)   // "L +3"
 * formatBalance(-2)  // "R +2"
 * formatBalance(0.2) // "C" (centre)
 */
export function formatBalance(balanceDb) {
  if (!isFinite(balanceDb)) {
    return 'C';
  }

  const abs = Math.abs(balanceDb);
  if (abs < 0.5) {
    return 'C';  // Centre
  }

  const side = balanceDb > 0 ? 'L' : 'R';
  return `${side} +${Math.round(abs)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// TIME FORMATTERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format elapsed time as HH:MM:SS.
 *
 * @param {number} ms - Milliseconds
 * @returns {string} Fixed-width time string
 *
 * @example
 * formatTime(3661000) // "01:01:01"
 * formatTime(0)       // "00:00:00"
 * formatTime(-1)      // "--:--:--"
 */
export function formatTime(ms) {
  if (!isFinite(ms) || ms < 0) {
    return '--:--:--';
  }
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s]
    .map(n => n.toString().padStart(2, '0'))
    .join(':');
}

/**
 * Format duration in compact form.
 *
 * @param {number} ms - Milliseconds
 * @returns {string} Compact duration string
 *
 * @example
 * formatDuration(3661000) // "1h 1m 1s"
 * formatDuration(65000)   // "1m 5s"
 * formatDuration(5000)    // "5s"
 */
export function formatDuration(ms) {
  if (!isFinite(ms) || ms < 0) {
    return '--';
  }
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);

  return parts.join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// SAMPLE RATE / FREQUENCY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format sample rate for display.
 *
 * @param {number} sampleRate - Sample rate in Hz
 * @returns {string} Formatted string
 *
 * @example
 * formatSampleRate(48000) // "48 kHz"
 * formatSampleRate(44100) // "44.1 kHz"
 */
export function formatSampleRate(sampleRate) {
  if (!isFinite(sampleRate) || sampleRate <= 0) {
    return '-- kHz';
  }
  const kHz = sampleRate / 1000;
  // Show decimal only if not a whole number
  return kHz % 1 === 0 ? `${kHz} kHz` : `${kHz.toFixed(1)} kHz`;
}

/**
 * Format frequency for display.
 *
 * @param {number} freq - Frequency in Hz
 * @returns {string} Formatted string with appropriate unit
 *
 * @example
 * formatFrequency(1000)  // "1.00 kHz"
 * formatFrequency(440)   // "440 Hz"
 * formatFrequency(20000) // "20.0 kHz"
 */
export function formatFrequency(freq) {
  if (!isFinite(freq) || freq <= 0) {
    return '-- Hz';
  }
  if (freq >= 1000) {
    return `${(freq / 1000).toFixed(freq >= 10000 ? 1 : 2)} kHz`;
  }
  return `${Math.round(freq)} Hz`;
}
