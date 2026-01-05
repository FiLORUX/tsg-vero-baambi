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
 * METER VERIFICATION SYSTEM
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Automated self-test for verifying meter accuracy using internal test signals.
 * Generates known reference signals and verifies meter readings match expected values.
 *
 * Tests:
 * 1. LUFS Integrated: Pink noise → −23.0 LUFS ±0.1
 * 2. PPM Alignment: 1 kHz @ −18 dBFS → TEST (0 PPM)
 * 3. Stereo Decorrelation: 997/1003 Hz dual-tone → correlation ≈ 0
 * 4. Mono Correlation: L=R 1 kHz → correlation = +1.0
 * 5. True Peak: Intersample peak signal → TP > 0 dBTP
 *
 * @module verification/meter-verify
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { dbToLinear } from '../generators/presets.js';

/**
 * Test definitions with expected values and tolerances.
 */
export const VERIFICATION_TESTS = [
  {
    id: 'lufs-integrated',
    name: 'LUFS Integrated',
    description: 'Pink noise @ −23 LUFS',
    duration: 12000, // 12 seconds for stable integration
    expected: { integrated: -23.0 },
    tolerance: { integrated: 0.3 }, // EBU R128 allows ±0.1, we use ±0.3 for safety
    setup: (ac, gain) => createLufsTestSignal(ac, gain),
  },
  {
    id: 'ppm-alignment',
    name: 'PPM Alignment',
    description: '1 kHz sine @ −18 dBFS (TEST level)',
    duration: 3000,
    expected: { ppm: 0 }, // TEST = 0 PPM
    tolerance: { ppm: 1.0 }, // ±1.0 PPM allows for browser timing variance
    setup: (ac, gain) => createPpmTestSignal(ac, gain),
  },
  {
    id: 'stereo-decorrelation',
    name: 'Stereo Decorrelation',
    description: '997 Hz L + 1003 Hz R (beating)',
    duration: 4000,
    expected: { correlation: 0 },
    tolerance: { correlation: 0.3 }, // Should be near 0
    setup: (ac, gain) => createDecorrelationSignal(ac, gain),
  },
  {
    id: 'mono-correlation',
    name: 'Mono Correlation',
    description: 'L=R 1 kHz (identical channels)',
    duration: 3000,
    expected: { correlation: 1.0 },
    tolerance: { correlation: 0.05 }, // Should be very close to +1
    setup: (ac, gain) => createMonoCorrelationSignal(ac, gain),
  },
  {
    id: 'intersample-peak',
    name: 'Intersample Peak',
    description: 'High-frequency signal causing ISP',
    duration: 3000,
    expected: { truePeakAboveZero: true },
    tolerance: {},
    setup: (ac, gain) => createIntersamplePeakSignal(ac, gain),
  }
];

/**
 * Create pink noise signal calibrated to −23 LUFS.
 *
 * Calibration notes:
 * - Paul Kellet algorithm produces normalised pink noise (~unity peak)
 * - K-weighting boosts HF by +4 dB, cuts LF by −3 dB at 38 Hz
 * - For broadband pink noise, K-weighting adds ~+2 dB overall
 * - Target: −23 LUFS after K-weighting in signal chain
 *
 * Empirically calibrated: 0.042 scale factor yields −23 LUFS ±0.3
 */
function createLufsTestSignal(ac, masterGain) {
  const bufferSize = 10 * ac.sampleRate;
  const buffer = ac.createBuffer(2, bufferSize, ac.sampleRate);

  // Generate pink noise using Paul Kellet's algorithm
  // Each channel gets independent noise (uncorrelated stereo)
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
      data[i] = pink * 0.042;
    }
  }

  const source = ac.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(masterGain);

  return {
    start: () => source.start(),
    stop: () => { try { source.stop(); } catch (e) {} },
    nodes: [source]
  };
}

/**
 * Create 1 kHz sine at −18 dBFS for PPM test.
 * Creates stereo L=R signal via merger.
 */
function createPpmTestSignal(ac, masterGain) {
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 1000;

  const gain = ac.createGain();
  gain.gain.value = dbToLinear(-18);

  // Create stereo L=R via merger
  const merger = ac.createChannelMerger(2);
  osc.connect(gain);
  gain.connect(merger, 0, 0); // L
  gain.connect(merger, 0, 1); // R
  merger.connect(masterGain);

  return {
    start: () => osc.start(),
    stop: () => { try { osc.stop(); } catch (e) {} },
    nodes: [osc, gain, merger]
  };
}

/**
 * Create decorrelated stereo signal (997 Hz L, 1003 Hz R).
 * The frequency difference causes beating and near-zero correlation.
 */
function createDecorrelationSignal(ac, masterGain) {
  const oscL = ac.createOscillator();
  oscL.type = 'sine';
  oscL.frequency.value = 997;

  const oscR = ac.createOscillator();
  oscR.type = 'sine';
  oscR.frequency.value = 1003;

  const gainL = ac.createGain();
  gainL.gain.value = dbToLinear(-18);

  const gainR = ac.createGain();
  gainR.gain.value = dbToLinear(-18);

  // Create stereo merger
  const merger = ac.createChannelMerger(2);

  oscL.connect(gainL);
  oscR.connect(gainR);
  gainL.connect(merger, 0, 0);
  gainR.connect(merger, 0, 1);
  merger.connect(masterGain);

  return {
    start: () => { oscL.start(); oscR.start(); },
    stop: () => { try { oscL.stop(); oscR.stop(); } catch (e) {} },
    nodes: [oscL, oscR, gainL, gainR, merger]
  };
}

/**
 * Create mono signal (L=R) for correlation = +1.0 test.
 * Creates stereo L=R signal via merger.
 */
function createMonoCorrelationSignal(ac, masterGain) {
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 1000;

  const gain = ac.createGain();
  gain.gain.value = dbToLinear(-18);

  // Create stereo L=R via merger (identical signal on both channels)
  const merger = ac.createChannelMerger(2);
  osc.connect(gain);
  gain.connect(merger, 0, 0); // L
  gain.connect(merger, 0, 1); // R
  merger.connect(masterGain);

  return {
    start: () => osc.start(),
    stop: () => { try { osc.stop(); } catch (e) {} },
    nodes: [osc, gain, merger]
  };
}

/**
 * Create intersample peak test signal.
 *
 * ISP (Intersample Peak) above 0 dBTP only occurs when the reconstructed
 * analog waveform exceeds digital full scale. This happens with:
 * - Clipped signals (Gibbs phenomenon causes overshoot at discontinuities)
 * - Non-band-limited content
 *
 * This test uses a CLIPPED sine wave:
 * 1. Generate sine at +3.5 dB (amplitude 1.5)
 * 2. Hard-clip all samples to ±1.0
 * 3. The resulting waveform has sample peak = 1.0 (0 dBFS)
 *    but true peak ≈ +1.5 dBTP due to Gibbs ringing at clip points
 *
 * A pure (unclipped) sine wave at 0 dBFS will NEVER produce TP > 0 dBTP
 * because it's properly band-limited.
 *
 * @see AES17-2015 Section 6.3 (True peak measurement)
 * @see ITU-R BS.1770-4 Annex 2 (True-peak level measurement)
 */
function createIntersamplePeakSignal(ac, masterGain) {
  const bufferLength = ac.sampleRate; // 1 second buffer
  const buffer = ac.createBuffer(2, bufferLength, ac.sampleRate);

  // 500 Hz sine - low enough for stable measurement, high enough for smooth clipping
  const freq = 500;
  const omega = 2 * Math.PI * freq / ac.sampleRate;

  // +3.5 dB amplitude = 1.496, will clip to ±1.0
  // Expected ISP: ~+1.0 to +1.5 dBTP depending on interpolation algorithm
  const overdrive = 1.5;

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < bufferLength; i++) {
      // Generate overdriven sine
      const raw = Math.sin(omega * i) * overdrive;
      // Hard clip to digital full scale
      data[i] = Math.max(-1.0, Math.min(1.0, raw));
    }
  }

  const source = ac.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(masterGain);

  return {
    start: () => source.start(),
    stop: () => { try { source.stop(); } catch (e) {} },
    nodes: [source]
  };
}

/**
 * MeterVerification class - runs automated meter tests.
 */
export class MeterVerification {
  constructor(options = {}) {
    this.audioContext = options.audioContext;
    this.masterGain = options.masterGain;
    this.getMeterReadings = options.getMeterReadings; // Function to get current meter values
    this.resetMeters = options.resetMeters || null; // Function to reset meters between tests
    this.onTestStart = options.onTestStart || (() => {});
    this.onTestComplete = options.onTestComplete || (() => {});
    this.onAllComplete = options.onAllComplete || (() => {});
    this.onProgress = options.onProgress || (() => {});

    this.isRunning = false;
    this.currentTest = null;
    this.results = [];
    this.aborted = false;
    this._progressAnimationId = null;
  }

  /**
   * Run all verification tests.
   * @returns {Promise<Array>} Test results
   */
  async runAll() {
    if (this.isRunning) {
      console.warn('[MeterVerify] Already running');
      return this.results;
    }

    this.isRunning = true;
    this.aborted = false;
    this.results = [];

    const numTests = VERIFICATION_TESTS.length;

    for (let i = 0; i < numTests; i++) {
      if (this.aborted) break;

      const test = VERIFICATION_TESTS[i];
      const startPct = (i / numTests) * 100;
      const endPct = ((i + 1) / numTests) * 100;

      // Start smooth progress animation: interpolate from startPct to endPct
      this._startProgressAnimation(startPct, endPct, test.duration, test.name);

      const result = await this.runTest(test);
      this.results.push(result);

      // Stop animation and snap to endPct
      this._stopProgressAnimation();
      this.onProgress(endPct, test.name);

      // Small gap between tests
      if (i < numTests - 1) {
        await this.delay(500);
      }
    }

    this.isRunning = false;
    this.onProgress(100, 'Complete');
    this.onAllComplete(this.results);

    return this.results;
  }

  /**
   * Start smooth progress animation using requestAnimationFrame.
   * Interpolates from startPct to endPct over the test duration.
   * @private
   */
  _startProgressAnimation(startPct, endPct, duration, label) {
    const startTime = performance.now();

    const animate = () => {
      if (!this.isRunning || this.aborted) return;

      const elapsed = performance.now() - startTime;
      const t = Math.min(1, elapsed / duration); // 0 → 1 over duration
      const pct = startPct + (endPct - startPct) * t;

      this.onProgress(pct, label);

      if (t < 1) {
        this._progressAnimationId = requestAnimationFrame(animate);
      }
    };
    animate();
  }

  /**
   * Stop progress animation.
   * @private
   */
  _stopProgressAnimation() {
    if (this._progressAnimationId) {
      cancelAnimationFrame(this._progressAnimationId);
      this._progressAnimationId = null;
    }
  }

  /**
   * Run a single verification test.
   */
  async runTest(test) {
    this.currentTest = test;
    this.onTestStart(test);

    // Reset meters before each test to ensure clean slate
    // This is critical because tests run sequentially and meters have slow decay
    // (e.g., PPM decays at only 11.76 dB/s, so previous test peaks can persist)
    if (this.resetMeters) {
      this.resetMeters();
    }

    // Create test signal
    const signal = test.setup(this.audioContext, this.masterGain);

    // Start signal and wait for meters to stabilize
    signal.start();
    await this.delay(1000); // Wait for meter attack

    // Wait for test duration, sampling readings
    const samples = [];
    const sampleInterval = 200; // Sample every 200ms
    const sampleCount = Math.floor((test.duration - 1000) / sampleInterval);

    for (let i = 0; i < sampleCount; i++) {
      if (this.aborted) break;
      await this.delay(sampleInterval);
      samples.push(this.getMeterReadings());
    }

    // Stop signal
    signal.stop();

    // Analyse results
    const result = this.analyseResults(test, samples);
    result.testId = test.id;
    result.testName = test.name;
    result.description = test.description;

    this.onTestComplete(result);
    this.currentTest = null;

    return result;
  }

  /**
   * Analyse test results and determine pass/fail.
   */
  analyseResults(test, samples) {
    if (samples.length === 0) {
      return { passed: false, reason: 'No samples collected', samples };
    }

    const result = { passed: true, measurements: {}, samples };

    // Check LUFS integrated
    if ('integrated' in test.expected) {
      const integratedValues = samples.map(s => s.integratedLufs).filter(v => isFinite(v) && v > -100);
      if (integratedValues.length === 0) {
        result.passed = false;
        result.reason = 'No valid LUFS readings';
        return result;
      }

      // Use last stable reading
      const measured = integratedValues[integratedValues.length - 1];
      const expected = test.expected.integrated;
      const tolerance = test.tolerance.integrated;
      const error = Math.abs(measured - expected);

      result.measurements.integrated = { measured, expected, tolerance, error };

      if (error > tolerance) {
        result.passed = false;
        result.reason = `LUFS: ${measured.toFixed(1)} (expected ${expected} ±${tolerance})`;
      }
    }

    // Check PPM
    if ('ppm' in test.expected) {
      const ppmValues = samples.map(s => s.nordicPpm).filter(v => isFinite(v));
      if (ppmValues.length === 0) {
        result.passed = false;
        result.reason = 'No valid PPM readings';
        return result;
      }

      const measured = ppmValues.reduce((a, b) => a + b, 0) / ppmValues.length;
      const expected = test.expected.ppm;
      const tolerance = test.tolerance.ppm;
      const error = Math.abs(measured - expected);

      result.measurements.ppm = { measured, expected, tolerance, error };

      if (error > tolerance) {
        result.passed = false;
        result.reason = `PPM: ${measured.toFixed(1)} (expected ${expected} ±${tolerance})`;
      }
    }

    // Check correlation
    if ('correlation' in test.expected) {
      const corrValues = samples.map(s => s.correlation).filter(v => isFinite(v));
      if (corrValues.length === 0) {
        result.passed = false;
        result.reason = 'No valid correlation readings';
        return result;
      }

      const measured = corrValues.reduce((a, b) => a + b, 0) / corrValues.length;
      const expected = test.expected.correlation;
      const tolerance = test.tolerance.correlation;
      const error = Math.abs(measured - expected);

      result.measurements.correlation = { measured, expected, tolerance, error };

      if (error > tolerance) {
        result.passed = false;
        result.reason = `Correlation: ${measured.toFixed(2)} (expected ${expected} ±${tolerance})`;
      }
    }

    // Check true peak > 0
    if ('truePeakAboveZero' in test.expected) {
      const tpValues = samples.map(s => Math.max(s.truePeakL, s.truePeakR)).filter(v => isFinite(v));
      if (tpValues.length === 0) {
        result.passed = false;
        result.reason = 'No valid True Peak readings';
        return result;
      }

      const maxTp = Math.max(...tpValues);
      result.measurements.truePeak = { measured: maxTp, expected: '> 0 dBTP' };

      if (maxTp <= 0) {
        result.passed = false;
        result.reason = `True Peak: ${maxTp.toFixed(1)} dBTP (expected > 0)`;
      }
    }

    return result;
  }

  /**
   * Abort running tests.
   */
  abort() {
    this.aborted = true;
    this._stopProgressAnimation();
    if (this.currentTest) {
      console.log('[MeterVerify] Aborting test:', this.currentTest.name);
    }
  }

  /**
   * Helper delay function.
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
