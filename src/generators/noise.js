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
 * NOISE GENERATOR MODULE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Creates white, pink, and brown noise sources using AudioBufferSourceNode.
 * Supports both correlated (mono) and uncorrelated (stereo) noise generation.
 *
 * EBU Tech 3341: Uncorrelated noise requires statistically independent L/R signals.
 *
 * @module generators/noise
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// Cached white noise buffer (reusable for correlated noise)
let whiteNoiseBuffer = null;

/**
 * Get or create a reusable white noise buffer.
 * Uses crossfade for seamless looping.
 * @param {AudioContext} ac - The AudioContext
 * @returns {AudioBuffer}
 */
export function getWhiteNoiseBuffer(ac) {
  if (whiteNoiseBuffer && whiteNoiseBuffer.sampleRate === ac.sampleRate) {
    return whiteNoiseBuffer;
  }
  whiteNoiseBuffer = createNoiseBuffer(ac);
  return whiteNoiseBuffer;
}

/**
 * Create a NEW noise buffer (for uncorrelated stereo - each channel needs unique data).
 * EBU Tech 3341: Uncorrelated noise requires statistically independent L/R signals.
 * @param {AudioContext} ac - The AudioContext
 * @returns {AudioBuffer}
 */
export function createNoiseBuffer(ac) {
  const bufferSize = 10 * ac.sampleRate; // 10 seconds for less frequent looping
  const crossfadeSize = Math.floor(0.05 * ac.sampleRate); // 50ms crossfade
  const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
  const data = buffer.getChannelData(0);

  // Fill with white noise (unique random sequence)
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  // Apply crossfade at loop point for seamless transition
  for (let i = 0; i < crossfadeSize; i++) {
    const fadeIn = i / crossfadeSize;
    const fadeOut = 1 - fadeIn;
    const endIdx = bufferSize - crossfadeSize + i;
    data[endIdx] = data[endIdx] * fadeOut + data[i] * fadeIn;
  }

  return buffer;
}

/**
 * Create noise source with optional filtering.
 * Set uniqueBuffer=true for uncorrelated stereo (EBU requirement).
 * @param {AudioContext} ac - The AudioContext
 * @param {string} type - 'white', 'pink', or 'brown'
 * @param {number} loFreq - Low frequency cutoff
 * @param {number} hiFreq - High frequency cutoff
 * @param {boolean} uniqueBuffer - Create unique buffer for uncorrelated stereo
 * @returns {{source: AudioBufferSourceNode, output: AudioNode, filters: AudioNode[]}}
 */
export function createNoiseSource(ac, type, loFreq, hiFreq, uniqueBuffer = false) {
  const filters = [];
  const noise = ac.createBufferSource();
  noise.buffer = uniqueBuffer ? createNoiseBuffer(ac) : getWhiteNoiseBuffer(ac);
  noise.loop = true;

  // For pink/brown noise, we need filtering
  if (type === 'white') {
    // Bandpass filter for bandwidth limiting
    if (loFreq > 20 || hiFreq < 20000) {
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = Math.sqrt(loFreq * hiFreq);
      bp.Q.value = bp.frequency.value / (hiFreq - loFreq);
      noise.connect(bp);
      filters.push(bp);
      return { source: noise, output: bp, filters };
    }
    return { source: noise, output: noise, filters };
  }

  if (type === 'pink') {
    // Pink noise: -3dB/octave slope using multiple filters
    // Approximate with cascaded lowpass filters
    const lp1 = ac.createBiquadFilter();
    lp1.type = 'lowpass';
    lp1.frequency.value = hiFreq;

    const hp1 = ac.createBiquadFilter();
    hp1.type = 'highpass';
    hp1.frequency.value = loFreq;

    // Pink filter approximation: gentle lowpass rolloff
    const pinkFilter = ac.createBiquadFilter();
    pinkFilter.type = 'lowshelf';
    pinkFilter.frequency.value = 1000;
    pinkFilter.gain.value = -3;

    noise.connect(hp1);
    hp1.connect(lp1);
    lp1.connect(pinkFilter);
    filters.push(hp1, lp1, pinkFilter);
    return { source: noise, output: pinkFilter, filters };
  }

  if (type === 'brown') {
    // Brown noise: -6dB/octave (integrate white noise)
    const lp1 = ac.createBiquadFilter();
    lp1.type = 'lowpass';
    lp1.frequency.value = hiFreq;
    lp1.Q.value = 0.5;

    const hp1 = ac.createBiquadFilter();
    hp1.type = 'highpass';
    hp1.frequency.value = loFreq;

    // Strong lowpass for brown characteristic
    const brownFilter = ac.createBiquadFilter();
    brownFilter.type = 'lowpass';
    brownFilter.frequency.value = 200;
    brownFilter.Q.value = 0.7;

    noise.connect(brownFilter);
    brownFilter.connect(hp1);
    hp1.connect(lp1);
    filters.push(brownFilter, hp1, lp1);
    return { source: noise, output: lp1, filters };
  }

  return { source: noise, output: noise, filters };
}

/**
 * Clear the cached noise buffer (for cleanup/testing).
 */
export function clearNoiseBufferCache() {
  whiteNoiseBuffer = null;
}
