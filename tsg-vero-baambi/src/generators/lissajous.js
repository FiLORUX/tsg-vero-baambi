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
 * LISSAJOUS PATTERN GENERATOR MODULE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Creates Lissajous patterns for goniometer testing.
 * Uses DelayNode for sample-accurate, drift-free phase offset.
 *
 * For same-frequency patterns (phase offset), a single oscillator with delay
 * ensures zero drift between channels.
 *
 * For different frequencies (complex Lissajous figures), two oscillators are
 * started synchronized for consistent patterns.
 *
 * @module generators/lissajous
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * Create a Lissajous pattern generator with phase offset.
 * Uses single oscillator + delay for drift-free phase relationship.
 * @param {AudioContext} ac - The AudioContext
 * @param {number} frequency - Base frequency in Hz
 * @param {number} phaseDegrees - Phase offset in degrees (0-360)
 * @param {number} amplitude - Output amplitude (0-1)
 * @returns {{osc: OscillatorNode, gainL: GainNode, gainR: GainNode, delayNode: DelayNode, nodes: AudioNode[]}}
 */
export function createLissajousWithPhase(ac, frequency, phaseDegrees, amplitude) {
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = frequency;

  const gainL = ac.createGain();
  const gainR = ac.createGain();
  gainL.gain.value = amplitude;
  gainR.gain.value = amplitude;

  // DelayNode for precise phase offset (phase in degrees -> delay in seconds)
  const phaseDelaySec = (phaseDegrees / 360) * (1 / frequency);
  const delayNode = ac.createDelay(1.0); // Max 1 second delay
  delayNode.delayTime.value = phaseDelaySec;

  // Left: direct from oscillator
  osc.connect(gainL);

  // Right: through delay for phase offset
  osc.connect(delayNode);
  delayNode.connect(gainR);

  return {
    osc,
    gainL,
    gainR,
    delayNode,
    nodes: [gainL, gainR, delayNode]
  };
}

/**
 * Create a complex Lissajous pattern with different frequencies.
 * Uses two oscillators started synchronized for consistent pattern.
 * @param {AudioContext} ac - The AudioContext
 * @param {number} freqL - Left channel frequency in Hz
 * @param {number} freqR - Right channel frequency in Hz
 * @param {number} amplitude - Output amplitude (0-1)
 * @returns {{oscL: OscillatorNode, oscR: OscillatorNode, gainL: GainNode, gainR: GainNode, nodes: AudioNode[], startTime: number}}
 */
export function createLissajousDualFreq(ac, freqL, freqR, amplitude) {
  const oscL = ac.createOscillator();
  const oscR = ac.createOscillator();
  oscL.type = 'sine';
  oscR.type = 'sine';
  oscL.frequency.value = freqL;
  oscR.frequency.value = freqR;

  const gainL = ac.createGain();
  const gainR = ac.createGain();
  gainL.gain.value = amplitude;
  gainR.gain.value = amplitude;

  oscL.connect(gainL);
  oscR.connect(gainR);

  // Start time for synchronized start
  const startTime = ac.currentTime + 0.01;

  return {
    oscL,
    oscR,
    gainL,
    gainR,
    nodes: [gainL, gainR],
    startTime
  };
}

/**
 * Parse frequency ratio string (e.g., "2:3") and calculate frequencies.
 * @param {number} baseFreq - Base frequency in Hz
 * @param {string} ratio - Ratio string like "1:1", "2:3", "3:4"
 * @returns {{freqL: number, freqR: number}}
 */
export function parseFrequencyRatio(baseFreq, ratio) {
  if (!ratio || ratio === '1:1') {
    return { freqL: baseFreq, freqR: baseFreq };
  }
  const [ratioL, ratioR] = ratio.split(':').map(Number);
  return {
    freqL: baseFreq,
    freqR: baseFreq * (ratioR / ratioL)
  };
}
