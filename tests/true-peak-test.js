/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * VERO-BAAMBI True-Peak Conformance (EBU Tech 3341 cases 15–23)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Run: node tests/true-peak-test.js
 *
 * Synthesises the true-peak test signals of EBU Tech 3341 Table 1 exactly as
 * the table describes them and asserts that the ITU-R BS.1770-4 Annex 2
 * detector in src/metering/true-peak.js reads within the +0.2/−0.4 dB
 * tolerance the table specifies. The remaining sections verify the
 * coefficient table, block-boundary continuity, the sample-rate dependent
 * over-sampling ratio, and the meter as the application drives it:
 * TruePeakMeter ballistics (TPmax, hold and over from unsmoothed peaks),
 * independent peak readers, and the sample-complete chain from the
 * stereo-sampler AudioWorklet through the main-thread sampler into the meter.
 *
 * Every measurement starts from a cleared detector, as Tech 3341 requires
 * ("the loudness meter shall be reset before each measurement").
 *
 * @module tests/true-peak-test
 * @see EBU Tech 3341 §2.6 and Table 1 (true-peak minimum requirements)
 * @see ITU-R BS.1770-4 Annex 2 (true-peak measurement guidelines)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  BS1770_PHASES,
  BS1770_TAPS_PER_PHASE,
  BS1770_TRUE_PEAK_COEFFICIENTS,
  TP_DISPLAY_FLOOR_DB,
  TruePeakDetector,
  TruePeakMeter,
  amplitudeToDbTP,
  calculateTruePeak,
  calculateTruePeakStereo,
  interpolationBranches,
  oversamplingFactor
} from '../src/metering/true-peak.js';
import {
  stereoSine,
  tech3341Case20,
  tech3341SineCases,
  withinEbuTolerance
} from './fixtures/tech3341-signals.js';

// ─────────────────────────────────────────────────────────────────────────────
// TEST UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';

let passed = 0;
let failed = 0;

function pass(name, detail) {
  console.log(`${GREEN}[PASS]${RESET} ${name}: ${detail}`);
  passed++;
}

function fail(name, detail) {
  console.log(`${RED}[FAIL]${RESET} ${name}: ${detail}`);
  failed++;
}

function check(name, condition, detail) {
  if (condition) pass(name, detail);
  else fail(name, detail);
}

function assertEbu(name, readingDb, expectedDb) {
  const detail = `${readingDb.toFixed(3)} dBTP (expected ${expectedDb.toFixed(1)} +0.2/−0.4 dBTP)`;
  check(name, withinEbuTolerance(readingDb, expectedDb), detail);
}

function assertClose(name, actual, expected, tolerance, unit = '') {
  const detail = `${actual.toFixed(4)}${unit} (expected ${expected.toFixed(4)} ±${tolerance}${unit})`;
  check(name, Math.abs(actual - expected) <= tolerance, detail);
}

/**
 * Largest absolute sample value in dBFS.
 *
 * @param {ArrayLike<number>} buffer - Samples
 * @returns {number} Sample peak in dBFS
 */
function samplePeakDb(buffer) {
  let max = 0;
  for (let i = 0; i < buffer.length; i++) {
    const abs = Math.abs(buffer[i]);
    if (abs > max) max = abs;
  }
  return amplitudeToDbTP(max);
}

// ─────────────────────────────────────────────────────────────────────────────
// COEFFICIENT TABLE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The table must be the Annex 2 table: four branches of twelve taps, every
 * value an integer multiple of 2⁻¹³, mirror-symmetric branch pairs, and the
 * impulse response peak equal to the largest coefficient.
 */
function testCoefficientTable() {
  console.log('\n--- ITU-R BS.1770-4 Annex 2 coefficient table ---');

  check('Four branches of twelve taps',
    BS1770_TRUE_PEAK_COEFFICIENTS.length === BS1770_PHASES
      && BS1770_TRUE_PEAK_COEFFICIENTS.every(branch => branch.length === BS1770_TAPS_PER_PHASE),
    `${BS1770_TRUE_PEAK_COEFFICIENTS.length} × ${BS1770_TRUE_PEAK_COEFFICIENTS[0].length}`);

  const quantised = BS1770_TRUE_PEAK_COEFFICIENTS.every(branch =>
    Array.from(branch).every(c => Math.abs(c * 8192 - Math.round(c * 8192)) < 1e-9));
  check('Every coefficient is an integer multiple of 2⁻¹³', quantised, 'exact in binary floating point');

  const mirrored = (a, b) => Array.from(a).every((c, k) => c === b[b.length - 1 - k]);
  check('Branch 3 mirrors branch 0 and branch 2 mirrors branch 1',
    mirrored(BS1770_TRUE_PEAK_COEFFICIENTS[0], BS1770_TRUE_PEAK_COEFFICIENTS[3])
      && mirrored(BS1770_TRUE_PEAK_COEFFICIENTS[1], BS1770_TRUE_PEAK_COEFFICIENTS[2]),
    'linear-phase prototype');

  const dcGains = BS1770_TRUE_PEAK_COEFFICIENTS.map(branch => Array.from(branch).reduce((s, c) => s + c, 0));
  check('DC gain of every branch within 0.03 of unity',
    dcGains.every(g => Math.abs(g - 1) < 0.03),
    dcGains.map(g => g.toFixed(4)).join(', '));

  // An isolated impulse of 0.5 reconstructs to 0.5 × the largest coefficient:
  // the reconstruction is evaluated one eighth of a sample from the impulse.
  const impulse = new Float32Array(64);
  impulse[32] = 0.5;
  const largest = Math.max(...BS1770_TRUE_PEAK_COEFFICIENTS.map(branch => Math.max(...branch)));
  assertClose('Impulse response peak equals the largest coefficient',
    calculateTruePeak(impulse, 48000), amplitudeToDbTP(0.5 * largest), 0.001, ' dBTP');

  check('Empty buffer reads −Infinity', calculateTruePeak(new Float32Array(0)) === -Infinity, '−Infinity');
  check('Missing buffer reads −Infinity', calculateTruePeak(null) === -Infinity, '−Infinity');
}

// ─────────────────────────────────────────────────────────────────────────────
// EBU TECH 3341 CASES 15 TO 23
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_RATE = 48000;

const SINE_CASES = tech3341SineCases(SAMPLE_RATE);

function testSineCases() {
  console.log('\n--- EBU Tech 3341 cases 15 to 19 (stereo sine, 48 kHz) ---');

  for (const spec of SINE_CASES) {
    const { left, right } = stereoSine({ sampleRate: SAMPLE_RATE, ...spec });
    const reading = calculateTruePeakStereo(left, right, SAMPLE_RATE);
    const label = `Case ${spec.id}: fs/${SAMPLE_RATE / spec.frequency} at ${spec.phaseDegrees}°, ` +
      `${spec.amplitude.toFixed(2)} FFS (sample peak ${samplePeakDb(left).toFixed(2)} dBFS)`;
    assertEbu(label, reading.max, spec.expectedDb);
  }
}

function testBurstCases() {
  console.log('\n--- EBU Tech 3341 cases 20 to 23 (fs/6 carrier with one fs/4 period, 48 kHz) ---');

  for (let offset = 0; offset < 4; offset++) {
    const { left, right, referencePeakDb } = tech3341Case20(SAMPLE_RATE, offset);

    // The synthesis itself must carry a 0 dBTP peak; the anti-alias filter
    // rounds the single period slightly, which the EBU tolerance allows for.
    if (offset === 0) {
      check('Synthesised signal peaks at 0 dBTP in the 4·fs domain',
        withinEbuTolerance(referencePeakDb, 0.0), `${referencePeakDb.toFixed(3)} dBTP after anti-alias filtering`);
    }

    const reading = calculateTruePeakStereo(left, right, SAMPLE_RATE);
    const label = `Case ${20 + offset}: downsampling offset ${offset} (sample peak ${samplePeakDb(left).toFixed(2)} dBFS)`;
    assertEbu(label, reading.max, 0.0);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK-BOUNDARY CONTINUITY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Feeding a stream in blocks of any size must give the single-pass result:
 * the detector carries eleven samples of history across every boundary.
 */
function testBlockContinuity() {
  console.log('\n--- Block-boundary continuity (TruePeakDetector) ---');

  const signals = [
    { name: 'case 16', buffer: stereoSine({ sampleRate: SAMPLE_RATE, ...SINE_CASES[1] }).left },
    { name: 'case 22', buffer: tech3341Case20(SAMPLE_RATE, 2).left }
  ];

  for (const { name, buffer } of signals) {
    const singlePass = calculateTruePeak(buffer, SAMPLE_RATE);

    for (const blockSize of [1, 7, 64, 480, 4096]) {
      const detector = new TruePeakDetector(SAMPLE_RATE);
      let peak = 0;
      for (let start = 0; start < buffer.length; start += blockSize) {
        peak = Math.max(peak, detector.process(buffer.subarray(start, Math.min(start + blockSize, buffer.length))));
      }
      peak = Math.max(peak, detector.flush());
      assertClose(`${name} in blocks of ${blockSize}`, amplitudeToDbTP(peak), singlePass, 1e-9, ' dBTP');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TRUE PEAK METER FEED SEMANTICS
// ─────────────────────────────────────────────────────────────────────────────

function testMeterFeeds() {
  console.log('\n--- TruePeakMeter feed semantics ---');

  // Contiguous blocks: the meter must reproduce the single-pass reading.
  const spec = SINE_CASES[4];
  const { left, right } = stereoSine({ sampleRate: SAMPLE_RATE, ...spec });
  const singlePass = calculateTruePeakStereo(left, right, SAMPLE_RATE).max;

  const contiguous = new TruePeakMeter({ sampleRate: SAMPLE_RATE, contiguous: true });
  for (let start = 0; start < left.length; start += 480) {
    contiguous.update(left.subarray(start, start + 480), right.subarray(start, start + 480));
  }
  const streamed = contiguous.getState().dbtpMax;
  assertEbu('Case 19 through TruePeakMeter({ contiguous: true }) in 10 ms blocks', streamed, spec.expectedDb);
  assertClose('Contiguous meter equals the single-pass reading', streamed, singlePass, 1e-9, ' dBTP');

  // Rolling windows (the src/app feed): overlapping windows of a full-scale
  // 1 kHz sine must read 0 dBTP, with no false peak from the window joins.
  const seconds = 2;
  const sine = new Float32Array(SAMPLE_RATE * seconds);
  for (let i = 0; i < sine.length; i++) sine[i] = Math.sin((2 * Math.PI * 1000 * i) / SAMPLE_RATE);

  const windowed = new TruePeakMeter({ sampleRate: SAMPLE_RATE });
  for (let start = 0; start + 4096 <= sine.length; start += 800) {
    const window = sine.subarray(start, start + 4096);
    windowed.update(window, window);
  }
  assertClose('Rolling 4096-sample windows of a full-scale 1 kHz sine', windowed.getState().dbtpMax, 0.0, 0.1, ' dBTP');

  check('Default feed is rolling-window (contiguous: false)', windowed.contiguous === false, String(windowed.contiguous));
}

// ─────────────────────────────────────────────────────────────────────────────
// METER BALLISTICS (THE APPLICATION'S PATH)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manually advanced clock for deterministic ballistics.
 */
function manualClock() {
  let ms = 0;
  return { now: () => ms, advance: (deltaMs) => { ms += deltaMs; } };
}

/**
 * Feed a mono signal to a default meter as the application's analyser path
 * does: a 4096-sample window of the most recent samples every `hop` samples,
 * with the clock advancing in real time.
 */
function feedRollingWindows(signal, hop) {
  const clock = manualClock();
  const meter = new TruePeakMeter({ sampleRate: SAMPLE_RATE, now: clock.now });
  for (let end = 4096; end <= signal.length; end += hop) {
    const window = signal.subarray(end - 4096, end);
    meter.update(window, window);
    clock.advance((hop / SAMPLE_RATE) * 1000);
  }
  return meter;
}

/**
 * Silence, a 20 ms 1 kHz burst at full scale, silence.
 */
function burstAfterSilence() {
  const signal = new Float32Array(SAMPLE_RATE * 2);
  const start = SAMPLE_RATE;
  for (let i = 0; i < 960; i++) signal[start + i] = Math.sin((2 * Math.PI * 1000 * i) / SAMPLE_RATE);
  return signal;
}

function testMeterBallistics() {
  console.log('\n--- TruePeakMeter ballistics (TPmax, hold and over from unsmoothed peaks) ---');

  // Transients through the default meter at 60 and 30 frames per second
  const burst = burstAfterSilence();
  const burstTruth = calculateTruePeak(burst, SAMPLE_RATE);
  for (const [fps, hop] of [[60, 800], [30, 1600]]) {
    const state = feedRollingWindows(burst, hop).getState();
    assertClose(`20 ms burst after silence, ${fps} fps windows: TPmax`, state.dbtpMax, burstTruth, 0.01, ' dBTP');
    check(`20 ms burst after silence, ${fps} fps windows: over indication at −1 dBTP`, state.isOverAny, String(state.isOverAny));
  }

  for (let offset = 0; offset < 4; offset++) {
    const { left } = tech3341Case20(SAMPLE_RATE, offset);
    for (const [fps, hop] of [[60, 800], [30, 1600]]) {
      assertEbu(`Case ${20 + offset} through the default meter, ${fps} fps windows`, feedRollingWindows(left, hop).getState().dbtpMaxLeft, 0.0);
    }
  }

  // Instant attack, timed release, hold behaviour
  const clock = manualClock();
  const meter = new TruePeakMeter({ sampleRate: SAMPLE_RATE, now: clock.now });
  meter.updateFromPeaks(0.001, 0.001);
  clock.advance(500);
  meter.updateFromPeaks(1.0, 0.5);
  let state = meter.getState();
  assertClose('Instant attack: bar equals the new peak at once', state.dbtpLeft, 0.0, 1e-6, ' dBTP');
  assertClose('Instant attack on the other channel', state.dbtpRight, amplitudeToDbTP(0.5), 1e-6, ' dBTP');

  clock.advance(1700);
  meter.updateFromPeaks(0, 0);
  state = meter.getState();
  assertClose('Release: 20 dB in 1.7 s, independent of update rate', state.dbtpLeft, -20.0, 1e-6, ' dBTP');
  assertClose('Hold keeps the peak within its 3 s', state.dbtpHoldLeft, 0.0, 1e-6, ' dBTP');

  clock.advance(1400);
  meter.updateFromPeaks(0, 0);
  state = meter.getState();
  check('Hold follows the bar after 3 s', Math.abs(state.dbtpHoldLeft - state.dbtpLeft) < 1e-9,
    `hold ${state.dbtpHoldLeft.toFixed(2)}, bar ${state.dbtpLeft.toFixed(2)}`);
  assertClose('TPmax keeps the peak after the hold has fallen', state.dbtpMaxLeft, 0.0, 1e-6, ' dBTP');

  clock.advance(10000);
  meter.updateFromPeaks(0, 0);
  assertClose('Bar stops at the display floor', meter.getState().dbtpLeft, TP_DISPLAY_FLOOR_DB, 1e-9, ' dBTP');

  meter.reset();
  state = meter.getState();
  check('Reset clears TPmax and the over indication',
    state.dbtpMax === -Infinity && !state.isOverAny && meter.isOver === false, `${state.dbtpMax}, ${state.isOverAny}`);

  const guarded = new TruePeakMeter({ now: manualClock().now });
  guarded.updateFromPeaks(Number.NaN, -0.5);
  state = guarded.getState();
  check('NaN peak reads as silence, negative peak by magnitude',
    state.dbtpMaxLeft < -150 && Math.abs(state.dbtpMaxRight - amplitudeToDbTP(0.5)) < 1e-9,
    `${state.dbtpMaxLeft.toFixed(1)}, ${state.dbtpMaxRight.toFixed(2)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PEAK READERS
// ─────────────────────────────────────────────────────────────────────────────

function testPeakReaders() {
  console.log('\n--- TruePeakMeter peak readers (consumers on their own schedule) ---');

  const clock = manualClock();
  const meter = new TruePeakMeter({ now: clock.now });
  const fast = meter.createPeakReader();
  const slow = meter.createPeakReader();

  const idle = fast.take();
  check('No update since creation reads −Infinity', idle.left === -Infinity && idle.right === -Infinity, `${idle.left}`);

  meter.updateFromPeaks(1.0, 0.25);
  clock.advance(90);
  meter.updateFromPeaks(0.1, 0.1);

  // A sender that samples the bar 90 ms after the peak sees the fall...
  const bar = meter.getState().dbtpLeft;
  check('Bar has begun to fall 90 ms after the peak', bar < -0.5, `${bar.toFixed(2)} dBTP`);

  // ...but its reader still carries the peak itself
  const first = fast.take();
  assertClose('Reader reports the peak since its previous take', first.left, amplitudeToDbTP(1.0), 1e-9, ' dBTP');
  assertClose('Reader reports the right channel independently', first.right, amplitudeToDbTP(0.25), 1e-9, ' dBTP');

  meter.updateFromPeaks(0.5, 0.5);
  assertClose('Reader restarts after take()', fast.take().left, amplitudeToDbTP(0.5), 1e-9, ' dBTP');
  assertClose('Readers are independent of each other', slow.take().left, amplitudeToDbTP(1.0), 1e-9, ' dBTP');

  fast.close();
  meter.updateFromPeaks(1.0, 1.0);
  check('A closed reader no longer accumulates', fast.take().left === -Infinity, 'detached');
  slow.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// SAMPLE-COMPLETE CHAIN: WORKLET → SAMPLER → METER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load the stereo-sampler AudioWorklet module in Node with the minimal
 * AudioWorkletGlobalScope it relies on, and return its processor class.
 */
async function loadWorkletProcessor() {
  let processorClass = null;
  globalThis.AudioWorkletProcessor = class {
    constructor() {
      this.port = { postMessage: () => {}, onmessage: null };
    }
  };
  globalThis.registerProcessor = (name, cls) => { processorClass = cls; };
  globalThis.currentTime = 0;
  globalThis.sampleRate = SAMPLE_RATE;
  await import('../src/audio/stereo-sampler-worklet.js');
  return processorClass;
}

/**
 * Run a stereo signal through a worklet processor in 128-sample render quanta.
 */
function renderThroughWorklet(Processor, sampleRate, left, right, onMessage) {
  globalThis.sampleRate = sampleRate;
  const processor = new Processor({
    processorOptions: { bufferSize: 4096, truePeakBranches: interpolationBranches(sampleRate) }
  });
  processor.port.postMessage = onMessage;
  for (let start = 0; start < left.length; start += 128) {
    const end = Math.min(start + 128, left.length);
    processor.process([[left.subarray(start, end), right.subarray(start, end)]]);
  }
  return processor;
}

async function testSampleCompleteChain() {
  console.log('\n--- Sample-complete chain: stereo-sampler worklet → sampler → meter ---');

  const Processor = await loadWorkletProcessor();
  check('Worklet module registers its processor', typeof Processor === 'function', 'stereo-sampler');

  // Worklet kernel against TruePeakDetector, bit for bit, at 4×, 2× and 1×
  for (const rate of [48000, 96000, 192000]) {
    const { left, right } = stereoSine({ sampleRate: rate, frequency: 12000, amplitude: 0.5, phaseDegrees: 45 });
    const reference = new TruePeakDetector(rate);
    let referencePeak = 0;
    for (let start = 0; start < left.length; start += 128) {
      referencePeak = Math.max(referencePeak, reference.process(left.subarray(start, start + 128)));
    }

    let workletPeak = 0;
    let samples = 0;
    let messages = 0;
    const processor = renderThroughWorklet(Processor, rate, left, right, (message) => {
      if (message.type !== 'truePeak') return;
      workletPeak = Math.max(workletPeak, message.left);
      samples += message.samples;
      messages++;
    });
    // The processor also holds the peak of samples not yet reported
    workletPeak = Math.max(workletPeak, processor._truePeakMaxL);
    const pending = processor._truePeakSamples;
    check(`${rate / 1000} kHz: worklet peak identical to TruePeakDetector`, workletPeak === referencePeak,
      `${amplitudeToDbTP(workletPeak).toFixed(4)} dBTP`);
    const secondsPerMessage = samples / messages / rate;
    check(`${rate / 1000} kHz: every sample accounted for, reported about every 10 ms`,
      samples + pending === left.length && secondsPerMessage > 0.009 && secondsPerMessage < 0.012,
      `${samples} reported + ${pending} pending in ${messages} messages, ${(secondsPerMessage * 1000).toFixed(1)} ms each`);
  }

  // The main-thread sampler with stubbed Web Audio nodes, fed by the worklet
  const nodes = [];
  globalThis.AudioWorkletNode = class {
    constructor(context, name, options) {
      this.options = options;
      this.port = { onmessage: null };
      nodes.push(this);
    }
    connect() {}
    disconnect() {}
  };
  const context = {
    sampleRate: SAMPLE_RATE,
    audioWorklet: { addModule: async () => {} },
    createChannelMerger: () => ({ connect() {} })
  };
  const source = { connect() {} };
  const sampler = await import('../src/audio/stereo-sampler.js');
  const mode = await sampler.initStereoSampler(context, source, source);
  const node = nodes[0];
  check('Sampler runs in worklet mode and offers the true-peak feed', mode === 'worklet' && sampler.hasTruePeakFeed(), mode);
  check('Sampler hands the Annex 2 branches to the worklet',
    node.options.processorOptions.truePeakBranches.length === 4
      && node.options.processorOptions.truePeakBranches[0][6] === BS1770_TRUE_PEAK_COEFFICIENTS[0][6],
    `${node.options.processorOptions.truePeakBranches.length} branches`);

  // Case 22 (the worst case for sample peak) with a UI thread that stalls for
  // two seconds, as a background tab does, while the worklet keeps measuring
  const { left } = tech3341Case20(SAMPLE_RATE, 2);
  const padded = new Float32Array(SAMPLE_RATE * 3);
  padded.set(left, SAMPLE_RATE);
  const truth = calculateTruePeak(padded, SAMPLE_RATE);

  const clock = manualClock();
  const meter = new TruePeakMeter({ sampleRate: SAMPLE_RATE, now: clock.now });
  const stallStart = SAMPLE_RATE * 0.5;
  const stallEnd = SAMPLE_RATE * 2.5;
  let delivered = 0;
  let lastFrame = -1;
  renderThroughWorklet(Processor, SAMPLE_RATE, padded, padded, (message) => {
    node.port.onmessage({ data: message });
    delivered += message.samples ?? 0;
    // The UI consumes once per 16.7 ms frame, except during the stall
    const frame = Math.floor(delivered / 800);
    const stalled = delivered >= stallStart && delivered <= stallEnd;
    if (!stalled && frame !== lastFrame) {
      lastFrame = frame;
      const { left: peakL, right: peakR } = sampler.consumeTruePeaks();
      clock.advance(16.7);
      meter.updateFromPeaks(peakL, peakR);
    }
  });
  const { left: peakL, right: peakR, samples: rest } = sampler.consumeTruePeaks();
  meter.updateFromPeaks(peakL, peakR);

  assertClose('Case 22 across a 2 s UI stall: TPmax equals the single-pass reading', meter.getState().dbtpMaxLeft, truth, 1e-6, ' dBTP');
  assertEbu('Case 22 across a 2 s UI stall: within the EBU tolerance', meter.getState().dbtpMaxLeft, 0.0);
  check('Sampler counted every measured sample', sampler.getSamplerStats().truePeakSamples === delivered,
    `${sampler.getSamplerStats().truePeakSamples} of ${delivered} (${rest} in the final read)`);

  sampler.disposeStereoSampler();
  check('Dispose withdraws the true-peak feed', !sampler.hasTruePeakFeed(), 'no feed');
}

// ─────────────────────────────────────────────────────────────────────────────
// SAMPLE-RATE HANDLING
// ─────────────────────────────────────────────────────────────────────────────

function testSampleRates() {
  console.log('\n--- Over-sampling ratio per sample rate ---');

  const expectedFactors = [[44100, 4], [48000, 4], [88200, 2], [96000, 2], [176400, 2], [192000, 2]];
  for (const [rate, factor] of expectedFactors) {
    check(`${rate} Hz over-samples ${factor}×`, oversamplingFactor(rate) === factor, `${oversamplingFactor(rate)}×`);
  }
  check('Meter reports its ratio', new TruePeakMeter({ sampleRate: 96000 }).getOversamplingFactor() === 2, '2× at 96 kHz');

  // 44.1 kHz: cases 16 and 17 scaled to fs.
  for (const spec of [SINE_CASES[1], SINE_CASES[2]]) {
    const rate = 44100;
    const scaled = { ...spec, frequency: rate / (SAMPLE_RATE / spec.frequency) };
    const { left, right } = stereoSine({ sampleRate: rate, ...scaled });
    assertEbu(`Case ${spec.id} geometry at 44.1 kHz (${scaled.frequency.toFixed(0)} Hz)`,
      calculateTruePeakStereo(left, right, rate).max, spec.expectedDb);
  }

  // 96 kHz with 2× over-sampling: a 12 kHz sine keeps the 192 kHz evaluation
  // grid of the 48 kHz case, which Annex 2 names as sufficient.
  for (const phaseDegrees of [0, 45, 60, 67.5]) {
    const rate = 96000;
    const { left, right } = stereoSine({ sampleRate: rate, frequency: 12000, amplitude: 0.5, phaseDegrees });
    assertEbu(`12 kHz at ${phaseDegrees}°, 0.50 FFS, 96 kHz (2×)`, calculateTruePeakStereo(left, right, rate).max, -6.0);
  }

  // Tech 3341 defines its signals relative to fs: at 96 and 192 kHz the same
  // sample sequences recur at 24 and 48 kHz, and all nine cases must still
  // pass with 2× over-sampling
  for (const rate of [96000, 192000]) {
    for (const spec of tech3341SineCases(rate)) {
      const { left, right } = stereoSine({ sampleRate: rate, ...spec });
      assertEbu(`Case ${spec.id} scaled to ${rate / 1000} kHz (2×)`, calculateTruePeakStereo(left, right, rate).max, spec.expectedDb);
    }
    for (let offset = 0; offset < 4; offset++) {
      const { left, right } = tech3341Case20(rate, offset);
      assertEbu(`Case ${20 + offset} scaled to ${rate / 1000} kHz (2×)`, calculateTruePeakStereo(left, right, rate).max, 0.0);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────────

console.log(`${BOLD}VERO-BAAMBI True-Peak Conformance${RESET}`);
console.log('═══════════════════════════════════════════════════════════════');
console.log('ITU-R BS.1770-4 Annex 2 detector against EBU Tech 3341 Table 1, cases 15–23');

testCoefficientTable();
testSineCases();
testBurstCases();
testBlockContinuity();
testMeterFeeds();
testMeterBallistics();
testPeakReaders();
await testSampleCompleteChain();
testSampleRates();

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`Results: ${GREEN}${passed} passed${RESET}, ${RED}${failed} failed${RESET}`);
console.log('═══════════════════════════════════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
}
