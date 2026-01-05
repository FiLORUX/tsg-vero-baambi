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
    // Initialise gains
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

// ─────────────────────────────────────────────────────────────────────────────
// SCALE CALIBRATION SEQUENCES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * dB to linear amplitude conversion.
 * @param {number} db - Level in dB
 * @returns {number}
 */
function dbToAmplitude(db) {
  return Math.pow(10, db / 20);
}

/**
 * Create Full Scale Sequence generator.
 * Generates 1 kHz tone stepping through: -60, -50, -40, -30, -24, -18, -12, -6, 0 dBFS
 * with 3 seconds at each level, then loops.
 *
 * @param {AudioContext} ac - Audio context
 * @param {GainNode} gainNode - Gain node to control level
 * @returns {Object} Sequence controller
 */
export function createFullScaleSequence(ac, gainNode) {
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 1000;

  const LEVELS_DBFS = [-60, -50, -40, -30, -24, -18, -12, -6, 0];
  const STEP_DURATION = 3.0; // 3 seconds per level
  const RAMP_SEC = 0.010; // 10ms ramp to avoid clicks

  let sequenceInterval = null;
  let stepIndex = 0;

  function scheduleStep(time, db) {
    const amplitude = dbToAmplitude(db);
    gainNode.gain.setValueAtTime(gainNode.gain.value, time);
    gainNode.gain.linearRampToValueAtTime(amplitude, time + RAMP_SEC);
  }

  function startSequence() {
    stepIndex = 0;
    const now = ac.currentTime;

    // Set initial level
    gainNode.gain.setValueAtTime(dbToAmplitude(LEVELS_DBFS[0]), now);
    osc.start(now);

    // Schedule level changes
    let nextStepTime = now + STEP_DURATION;
    sequenceInterval = setInterval(() => {
      const currentTime = ac.currentTime;
      if (nextStepTime - currentTime < 0.5) {
        stepIndex = (stepIndex + 1) % LEVELS_DBFS.length;
        scheduleStep(nextStepTime, LEVELS_DBFS[stepIndex]);
        nextStepTime += STEP_DURATION;
      }
    }, 200);
  }

  return {
    osc,
    startSequence,
    getLevels: () => LEVELS_DBFS,
    getCurrentIndex: () => stepIndex,
    getInterval: () => sequenceInterval,
    clearInterval: () => {
      if (sequenceInterval) {
        clearInterval(sequenceInterval);
        sequenceInterval = null;
      }
    }
  };
}

/**
 * Create PPM Sequence generator (Programme Peak Sequence).
 * Generates 1 kHz tone stepping through all PPM scale levels from -40 to +18 PPM (0 dBFS).
 * Includes all primary marks (-40, -36, -30, -24, -18, -12, -6, 0, +6) and
 * secondary marks (-33, -27, -21, -15, -9, -3, +3), then 1 dB steps from +9 to +18.
 * 1 second at each level, 4 seconds silence at end. 30-second loop.
 *
 * @param {AudioContext} ac - Audio context
 * @param {GainNode} gainNode - Gain node to control level
 * @returns {Object} Sequence controller
 */
export function createPpmSequence(ac, gainNode) {
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 1000;

  // PPM values: all primary + secondary tick levels, then 1 dB steps to +18 (0 dBFS)
  // PPM to dBFS: dBFS = PPM - 18 (EBU R68)
  // 26 tone steps + 4 silence steps = 30 seconds total loop
  const LEVELS_PPM = [
    -40, -36, -33, -30, -27, -24, -21, -18, -15, -12, -9, -6, -3, 0, 3, 6,  // All scale marks
    9, 10, 11, 12, 13, 14, 15, 16, 17, 18,  // 1 dB steps in overload zone
    null, null, null, null  // 4 seconds silence before loop restart
  ];
  const LEVELS_DBFS = LEVELS_PPM.map(ppm => ppm === null ? null : ppm - 18);
  // Result: [..., -1, 0, null, null, null, null]
  const STEP_DURATION = 1.0; // 1 second per level (30 steps = 30 seconds)
  const RAMP_SEC = 0.010; // 10ms ramp to avoid clicks

  let sequenceInterval = null;
  let stepIndex = 0;

  function scheduleStep(time, db) {
    // null = silence
    const amplitude = db === null ? 0 : dbToAmplitude(db);
    gainNode.gain.setValueAtTime(gainNode.gain.value, time);
    gainNode.gain.linearRampToValueAtTime(amplitude, time + RAMP_SEC);
  }

  function startSequence() {
    stepIndex = 0;
    const now = ac.currentTime;

    // Set initial level
    gainNode.gain.setValueAtTime(dbToAmplitude(LEVELS_DBFS[0]), now);
    osc.start(now);

    // Schedule level changes
    let nextStepTime = now + STEP_DURATION;
    sequenceInterval = setInterval(() => {
      const currentTime = ac.currentTime;
      if (nextStepTime - currentTime < 0.5) {
        stepIndex = (stepIndex + 1) % LEVELS_DBFS.length;
        scheduleStep(nextStepTime, LEVELS_DBFS[stepIndex]);
        nextStepTime += STEP_DURATION;
      }
    }, 200);
  }

  return {
    osc,
    startSequence,
    getLevelsPPM: () => LEVELS_PPM,
    getLevelsDBFS: () => LEVELS_DBFS,
    getCurrentIndex: () => stepIndex,
    getInterval: () => sequenceInterval,
    clearInterval: () => {
      if (sequenceInterval) {
        clearInterval(sequenceInterval);
        sequenceInterval = null;
      }
    }
  };
}
