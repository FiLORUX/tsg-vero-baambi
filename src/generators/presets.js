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
 * GENERATOR PRESETS MODULE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Parses preset configuration from HTML select element data attributes.
 * Each preset option in the DOM contains data-* attributes that define
 * the signal type, frequency, level, routing, etc.
 *
 * @module generators/presets
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * @typedef {Object} PresetConfig
 * @property {string} type - Signal type: 'sine', 'pink', 'white', 'brown', 'sweep', 'glits', 'lissajous', 'vector-text', 'isp-tone', 'isp-max'
 * @property {number} freq - Base frequency in Hz
 * @property {number} db - Level in dBFS (0 is a valid level, not a missing one)
 * @property {number} divisor - Frequency as a fraction of the sample rate, fs/divisor (for isp-tone)
 * @property {number} lo - Low frequency limit (for noise/sweep)
 * @property {number} hi - High frequency limit (for noise/sweep)
 * @property {string} routing - 'stereo', 'stereo-uncorr', 'mono', 'left', 'right', 'anti-phase'
 * @property {number} phase - Phase offset in degrees (for lissajous and isp-tone)
 * @property {string} ratio - Frequency ratio string like '1:1', '2:3' (for lissajous)
 * @property {number} duration - Sweep duration in seconds
 * @property {boolean} pulsed - Whether to use EBU stereo-ID pulsing
 */

/**
 * Parse a numeric data attribute, falling back only when it is absent or not
 * a number. `parseFloat(x) || fallback` would also replace a legitimate 0,
 * turning a 0 dBFS preset into the fallback level.
 *
 * @param {string|undefined} value - Attribute value
 * @param {number} fallback - Value when the attribute is absent or invalid
 * @returns {number}
 */
function numberOr(value, fallback) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Get preset configuration from a select element.
 * Reads data-* attributes from the selected option.
 * @param {HTMLSelectElement} selectElement - The preset select element
 * @returns {PresetConfig|null}
 */
export function getPresetConfig(selectElement) {
  if (!selectElement) return null;
  const opt = selectElement.options[selectElement.selectedIndex];
  if (!opt) return null;

  return {
    type: opt.dataset.type || 'sine',
    freq: parseFloat(opt.dataset.freq) || 1000,
    db: numberOr(opt.dataset.db, -18),
    lo: parseFloat(opt.dataset.lo) || 20,
    hi: parseFloat(opt.dataset.hi) || 20000,
    routing: opt.dataset.routing || 'stereo',
    phase: numberOr(opt.dataset.phase, 0),
    divisor: numberOr(opt.dataset.divisor, 4),
    ratio: opt.dataset.ratio || '1:1',
    duration: parseFloat(opt.dataset.duration) || 20,
    pulsed: opt.dataset.pulsed === 'true'
  };
}

/**
 * Format preset info for display.
 * @param {PresetConfig} config - The preset configuration
 * @returns {string}
 */
export function formatPresetDisplay(config) {
  if (!config) return '';

  const { type, freq, db, lo, hi } = config;

  if (type === 'sine' || type === 'lissajous') {
    return `${freq} Hz ${db} dBFS`;
  }
  if (type === 'pink' || type === 'white' || type === 'brown') {
    return `${type.charAt(0).toUpperCase() + type.slice(1)} ${db} dBFS`;
  }
  if (type === 'sweep') {
    return `Sweep ${db} dBFS`;
  }
  if (type === 'glits') {
    return `GLITS ${db} dBFS`;
  }
  if (type === 'vector-text') {
    return `Vector ${db} dBFS`;
  }
  if (type === 'isp-max') {
    return `ISP Max ${db} dBFS`;
  }
  if (type === 'isp-tone') {
    return `fs/${config.divisor} @ ${config.phase}° ${db} dBFS`;
  }

  return `${type} ${db} dBFS`;
}

/**
 * dB to linear amplitude conversion.
 * @param {number} db - Level in dB
 * @returns {number}
 */
export function dbToLinear(db) {
  return Math.pow(10, db / 20);
}
