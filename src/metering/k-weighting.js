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
 * K-WEIGHTING FILTER (ITU-R BS.1770-4)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * ───────
 * K-weighting is a two-stage perceptual filter approximating human loudness
 * perception for programme loudness measurement per ITU-R BS.1770-4 / EBU R128.
 *
 * FILTER CHAIN
 * ────────────
 *   Stage 1: High-pass filter (fc=38Hz, Q=0.5)
 *            Removes sub-bass content below human hearing threshold
 *
 *   Stage 2: High-shelf filter (+4dB @ 4kHz)
 *            Models acoustic coupling of head/ear canal (based on
 *            diffuse-field HRTF data from ITU-R BS.1770)
 *
 * ACCURACY
 * ────────
 * This implementation uses native Web Audio BiquadFilters for efficiency.
 * The full BS.1770 spec defines precise coefficients for 48kHz that yield
 * <0.1dB deviation from the reference implementation.
 *
 * For critical applications requiring exact BS.1770 compliance, consider
 * implementing the spec's explicit biquad coefficients.
 *
 * SIGNAL FLOW
 * ───────────
 *   Input → High-pass (38Hz) → High-shelf (+4dB @ 4kHz) → K-weighted Output
 *
 * @module metering/k-weighting
 * @see ITU-R BS.1770-4 Section 2.1 (Pre-filter)
 * @see EBU Tech 3341 Section 2 (Loudness metering)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// FILTER PARAMETERS (ITU-R BS.1770-4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * High-pass filter cutoff frequency in Hz.
 * Removes sub-bass below ~38Hz (below audible threshold).
 * @type {number}
 */
export const K_HIGHPASS_FREQUENCY = 38;

/**
 * High-pass filter Q factor.
 * Q=0.5 provides gentle rolloff matching BS.1770 response.
 * @type {number}
 */
export const K_HIGHPASS_Q = 0.5;

/**
 * High-shelf filter frequency in Hz.
 * Boost begins around 4kHz, modeling head/ear canal coupling.
 * @type {number}
 */
export const K_HIGHSHELF_FREQUENCY = 4000;

/**
 * High-shelf filter gain in dB.
 * +4dB boost above 4kHz per BS.1770 specification.
 * @type {number}
 */
export const K_HIGHSHELF_GAIN = 4;

// ─────────────────────────────────────────────────────────────────────────────
// FILTER CHAIN FACTORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a K-weighting filter chain for a single channel.
 *
 * @param {AudioContext} audioContext - Web Audio context
 * @returns {KWeightingChain} Filter chain with input, output, and cleanup
 *
 * @example
 * const kWeightL = createKWeightingFilter(audioContext);
 * sourceNode.connect(kWeightL.input);
 * kWeightL.output.connect(analyserNode);
 *
 * // Cleanup when done
 * kWeightL.dispose();
 */
export function createKWeightingFilter(audioContext) {
  // Stage 1: High-pass filter (removes sub-bass)
  const highpass = audioContext.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = K_HIGHPASS_FREQUENCY;
  highpass.Q.value = K_HIGHPASS_Q;

  // Stage 2: High-shelf filter (boosts high frequencies)
  const highshelf = audioContext.createBiquadFilter();
  highshelf.type = 'highshelf';
  highshelf.frequency.value = K_HIGHSHELF_FREQUENCY;
  highshelf.gain.value = K_HIGHSHELF_GAIN;

  // Connect: highpass → highshelf
  highpass.connect(highshelf);

  return {
    /** Input node - connect source here */
    input: highpass,

    /** Output node - connect to analyser or destination */
    output: highshelf,

    /** Disconnect and release filter nodes */
    dispose() {
      highpass.disconnect();
      highshelf.disconnect();
    }
  };
}

/**
 * @typedef {Object} KWeightingChain
 * @property {BiquadFilterNode} input - Input node (high-pass filter)
 * @property {BiquadFilterNode} output - Output node (high-shelf filter)
 * @property {Function} dispose - Cleanup function to disconnect filters
 */

/**
 * Create K-weighting filter chains for stereo (L/R) channels.
 *
 * @param {AudioContext} audioContext - Web Audio context
 * @returns {StereoKWeightingChain} Stereo filter chains
 *
 * @example
 * const kWeight = createStereoKWeightingFilters(audioContext);
 * splitter.connect(kWeight.left.input, 0);
 * splitter.connect(kWeight.right.input, 1);
 * kWeight.left.output.connect(analyserL);
 * kWeight.right.output.connect(analyserR);
 */
export function createStereoKWeightingFilters(audioContext) {
  const left = createKWeightingFilter(audioContext);
  const right = createKWeightingFilter(audioContext);

  return {
    left,
    right,

    /** Dispose both channels */
    dispose() {
      left.dispose();
      right.dispose();
    }
  };
}

/**
 * @typedef {Object} StereoKWeightingChain
 * @property {KWeightingChain} left - Left channel filter chain
 * @property {KWeightingChain} right - Right channel filter chain
 * @property {Function} dispose - Cleanup function for both channels
 */

// ─────────────────────────────────────────────────────────────────────────────
// EXACT BS.1770 COEFFICIENTS (Optional precision implementation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Exact biquad coefficients from ITU-R BS.1770-4 for 48kHz sample rate.
 * Use these for strict compliance testing; the native BiquadFilter
 * approximation is sufficient for most broadcast applications.
 *
 * @type {Object}
 */
export const BS1770_COEFFICIENTS_48K = {
  /** Stage 1: High-pass at 38Hz */
  highpass: {
    b0: 1.0,
    b1: -2.0,
    b2: 1.0,
    a1: -1.99004745483398,
    a2: 0.99007225036621
  },

  /** Stage 2: High-shelf at 4kHz, +4dB */
  highshelf: {
    b0: 1.53512485958697,
    b1: -2.69169618940638,
    b2: 1.19839281085285,
    a1: -1.69065929318241,
    a2: 0.73248077421585
  }
};

/**
 * Apply K-weighting to a buffer using exact BS.1770 coefficients.
 * This is a pure JavaScript implementation for offline processing or
 * strict compliance verification.
 *
 * @param {Float32Array} input - Input samples
 * @param {number} sampleRate - Sample rate (48000 recommended)
 * @returns {Float32Array} K-weighted output samples
 */
export function applyKWeightingOffline(input, sampleRate = 48000) {
  // For non-48kHz, would need to recalculate coefficients
  // This simplified version assumes 48kHz
  if (sampleRate !== 48000) {
    console.warn('[K-weighting] Exact coefficients are for 48kHz; results may vary at', sampleRate);
  }

  const output = new Float32Array(input.length);

  // High-pass stage state
  let hp_z1 = 0, hp_z2 = 0;
  const hp = BS1770_COEFFICIENTS_48K.highpass;

  // High-shelf stage state
  let hs_z1 = 0, hs_z2 = 0;
  const hs = BS1770_COEFFICIENTS_48K.highshelf;

  for (let i = 0; i < input.length; i++) {
    // High-pass (Direct Form II Transposed)
    const hp_in = input[i];
    const hp_out = hp.b0 * hp_in + hp_z1;
    hp_z1 = hp.b1 * hp_in - hp.a1 * hp_out + hp_z2;
    hp_z2 = hp.b2 * hp_in - hp.a2 * hp_out;

    // High-shelf
    const hs_in = hp_out;
    const hs_out = hs.b0 * hs_in + hs_z1;
    hs_z1 = hs.b1 * hs_in - hs.a1 * hs_out + hs_z2;
    hs_z2 = hs.b2 * hs_in - hs.a2 * hs_out;

    output[i] = hs_out;
  }

  return output;
}
