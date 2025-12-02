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
 * OSCILLATOR GENERATOR MODULE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Creates sine wave generators including:
 * - Simple sine tones
 * - AES17-compliant continuous logarithmic sine sweep
 * - GLITS (EBU Tech 3304) channel identification pattern
 *
 * All generators use Web Audio API automation for glitch-free, sample-accurate operation.
 *
 * @module generators/oscillators
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * Create a simple sine wave oscillator.
 * @param {AudioContext} ac - The AudioContext
 * @param {number} frequency - Frequency in Hz
 * @returns {{osc: OscillatorNode}}
 */
export function createSineOscillator(ac, frequency) {
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = frequency;
  return { osc };
}

/**
 * Create an AES17-compliant continuous logarithmic sine sweep.
 * Uses Web Audio API automation for glitch-free, sample-accurate frequency change.
 * @param {AudioContext} ac - The AudioContext
 * @param {number} startFreq - Start frequency in Hz
 * @param {number} endFreq - End frequency in Hz
 * @param {number} durationSec - Sweep duration in seconds
 * @returns {{osc: OscillatorNode, startSweep: function, interval: number|null}}
 */
export function createSweepOscillator(ac, startFreq, endFreq, durationSec) {
  const osc = ac.createOscillator();
  osc.type = 'sine';

  let sweepInterval = null;

  // Schedule continuous logarithmic sweep using exponentialRampToValueAtTime
  // This creates a true logarithmic sweep (constant octaves per second)
  function scheduleSweepCycle(startTime) {
    // Set start frequency
    osc.frequency.setValueAtTime(startFreq, startTime);
    // Exponential ramp to end frequency (logarithmic in frequency domain)
    osc.frequency.exponentialRampToValueAtTime(endFreq, startTime + durationSec);
  }

  function startSweep() {
    // Start first sweep
    const now = ac.currentTime;
    scheduleSweepCycle(now);
    osc.start(now);

    // Schedule repeating sweeps (lookahead scheduling)
    let nextSweepTime = now + durationSec;
    sweepInterval = setInterval(() => {
      // Schedule next sweep when we're within 1 second of it
      const currentTime = ac.currentTime;
      if (nextSweepTime - currentTime < 1.0) {
        scheduleSweepCycle(nextSweepTime);
        nextSweepTime += durationSec;
      }
    }, 200);
  }

  return {
    osc,
    startSweep,
    getInterval: () => sweepInterval,
    clearInterval: () => {
      if (sweepInterval) {
        clearInterval(sweepInterval);
        sweepInterval = null;
      }
    }
  };
}

/**
 * Create a GLITS (EBU Tech 3304) generator.
 * 1kHz tone with channel identification pattern.
 * Uses pre-scheduled Web Audio automation for glitch-free operation.
 * @param {AudioContext} ac - The AudioContext
 * @param {GainNode} leftGain - Left channel gain node
 * @param {GainNode} rightGain - Right channel gain node
 * @returns {{osc: OscillatorNode, startGlits: function, interval: number|null}}
 */
export function createGlitsOscillator(ac, leftGain, rightGain) {
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 1000;

  let glitsInterval = null;

  // GLITS pattern timing (4 second cycle):
  // Left:  mute at 0-250ms
  // Right: mute at 500-750ms and 1000-1250ms
  const CYCLE_SEC = 4.0;
  const RAMP_SEC = 0.002; // 2ms ramp to avoid clicks

  function scheduleGlitsCycle(cycleStart) {
    // Left channel: mute 0-250ms
    leftGain.gain.setValueAtTime(1, cycleStart);
    leftGain.gain.linearRampToValueAtTime(0, cycleStart + RAMP_SEC);
    leftGain.gain.setValueAtTime(0, cycleStart + 0.250 - RAMP_SEC);
    leftGain.gain.linearRampToValueAtTime(1, cycleStart + 0.250);

    // Right channel: mute 500-750ms
    rightGain.gain.setValueAtTime(1, cycleStart + 0.500);
    rightGain.gain.linearRampToValueAtTime(0, cycleStart + 0.500 + RAMP_SEC);
    rightGain.gain.setValueAtTime(0, cycleStart + 0.750 - RAMP_SEC);
    rightGain.gain.linearRampToValueAtTime(1, cycleStart + 0.750);

    // Right channel: mute 1000-1250ms
    rightGain.gain.setValueAtTime(1, cycleStart + 1.000);
    rightGain.gain.linearRampToValueAtTime(0, cycleStart + 1.000 + RAMP_SEC);
    rightGain.gain.setValueAtTime(0, cycleStart + 1.250 - RAMP_SEC);
    rightGain.gain.linearRampToValueAtTime(1, cycleStart + 1.250);
  }

  function startGlits() {
    // Initialize gains
    leftGain.gain.setValueAtTime(1, ac.currentTime);
    rightGain.gain.setValueAtTime(1, ac.currentTime);

    // Start oscillator and first cycle
    const now = ac.currentTime;
    osc.start(now);
    scheduleGlitsCycle(now);

    // Lookahead scheduling for seamless cycles
    let nextCycleTime = now + CYCLE_SEC;
    glitsInterval = setInterval(() => {
      const currentTime = ac.currentTime;
      // Schedule next cycle when within 1 second
      if (nextCycleTime - currentTime < 1.0) {
        scheduleGlitsCycle(nextCycleTime);
        nextCycleTime += CYCLE_SEC;
      }
    }, 200);
  }

  return {
    osc,
    startGlits,
    getInterval: () => glitsInterval,
    clearInterval: () => {
      if (glitsInterval) {
        clearInterval(glitsInterval);
        glitsInterval = null;
      }
    }
  };
}
