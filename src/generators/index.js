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
 * SIGNAL GENERATORS INDEX
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Central export point for all signal generator modules.
 * Import from this file to access all generator functionality.
 *
 * @module generators
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// Noise generators
export {
  getWhiteNoiseBuffer,
  createNoiseBuffer,
  createNoiseSource,
  clearNoiseBufferCache
} from './noise.js';

// Oscillator generators
export {
  createSineOscillator,
  createSweepOscillator,
  createGlitsOscillator
} from './oscillators.js';

// Lissajous generators
export {
  createLissajousWithPhase,
  createLissajousDualFreq,
  parseFrequencyRatio
} from './lissajous.js';

// Preset configuration
export {
  getPresetConfig,
  formatPresetDisplay,
  dbToLinear
} from './presets.js';

// THÅST Vector Text (already exists)
export { ThastVectorTextGenerator, buildTextPath, DEFAULT_CONFIG as VECTOR_TEXT_CONFIG } from './thast-vector-text.js';
