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
 * coefficient table, block-boundary continuity, the two feed semantics of
 * TruePeakMeter and the sample-rate dependent over-sampling ratio.
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
  TruePeakDetector,
  TruePeakMeter,
  amplitudeToDbTP,
  calculateTruePeak,
  calculateTruePeakStereo,
  oversamplingFactor
} from '../src/metering/true-peak.js';

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

/**
 * EBU Tech 3341 Table 1 tolerance for the true-peak cases.
 *
 * @param {number} readingDb - Meter reading in dBTP
 * @param {number} expectedDb - Expected maximum true-peak level in dBTP
 * @returns {boolean} True when the reading lies within +0.2/−0.4 dB
 */
function withinEbuTolerance(readingDb, expectedDb) {
  return readingDb <= expectedDb + 0.2 && readingDb >= expectedDb - 0.4;
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
// SIGNAL SYNTHESIS (EBU Tech 3341 Table 1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stereo sine wave as Tech 3341 describes it for cases 15 to 19: amplitude in
 * FFS, phase in degrees, and a 10 ms linear fade-in and fade-out. The duration
 * does not matter for the measurement; one second is used.
 *
 * @param {Object} spec - Signal specification
 * @param {number} spec.sampleRate - Sample rate in Hz
 * @param {number} spec.frequency - Frequency in Hz
 * @param {number} spec.amplitude - Amplitude in FFS (1.0 = full scale)
 * @param {number} spec.phaseDegrees - Initial phase in degrees
 * @returns {{ left: Float32Array, right: Float32Array }} Stereo signal
 */
function stereoSine({ sampleRate, frequency, amplitude, phaseDegrees }) {
  const length = sampleRate;
  const fade = Math.round(sampleRate * 0.010);
  const phase = (phaseDegrees * Math.PI) / 180;
  const left = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    let gain = 1;
    if (i < fade) gain = i / fade;
    else if (i >= length - fade) gain = (length - 1 - i) / fade;
    left[i] = amplitude * gain * Math.sin((2 * Math.PI * frequency * i) / sampleRate + phase);
  }

  return { left, right: Float32Array.from(left) };
}

/**
 * Blackman-windowed sinc low-pass kernel with unity DC gain.
 *
 * @param {number} taps - Kernel length (odd)
 * @param {number} cutoffNormalised - Cut-off as a fraction of the sample rate
 * @returns {Float64Array} Kernel
 */
function lowPassKernel(taps, cutoffNormalised) {
  const kernel = new Float64Array(taps);
  const centre = (taps - 1) / 2;
  let sum = 0;

  for (let i = 0; i < taps; i++) {
    const x = i - centre;
    const sinc = x === 0
      ? 2 * cutoffNormalised
      : Math.sin(2 * Math.PI * cutoffNormalised * x) / (Math.PI * x);
    const window = 0.42
      - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1))
      + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
    kernel[i] = sinc * window;
    sum += kernel[i];
  }

  for (let i = 0; i < taps; i++) kernel[i] /= sum;
  return kernel;
}

/**
 * Cases 20 to 23: a stereo sine at fs/6, 0.50 FFS, containing a single period
 * of a sine at fs/4 with amplitude 1.00, phase-continuous on both sides. The
 * signal is synthesised at 4·fs, low-pass (anti-alias) filtered at fs/2 and
 * downsampled to fs with an offset of 0 to 3 samples at the 4·fs rate, with a
 * short fade-in and fade-out.
 *
 * At 4·fs the carrier spans 24 samples per period and the fs/4 period 16. The
 * burst begins at a positive-going zero crossing of the carrier, and the
 * carrier resumes from phase zero when the burst has completed its period, so
 * the waveform is continuous in value and phase at both junctions.
 *
 * @param {number} sampleRate - Target sample rate fs in Hz
 * @param {number} offset - Downsampling offset at the 4·fs rate (0 to 3)
 * @returns {{ left: Float32Array, right: Float32Array, referencePeakDb: number }}
 *   Stereo signal and the true peak of the band-limited 4·fs signal in dBTP
 */
function tech3341Case20(sampleRate, offset) {
  const rate4 = 4 * sampleRate;
  const length = Math.round(rate4 * 0.2);
  const carrierPeriod = 24;
  const burstPeriod = 16;
  const burstStart = Math.floor(length / 2 / carrierPeriod) * carrierPeriod;
  const source = new Float64Array(length);

  for (let i = 0; i < length; i++) {
    if (i < burstStart) {
      source[i] = 0.5 * Math.sin((2 * Math.PI * i) / carrierPeriod);
    } else if (i < burstStart + burstPeriod) {
      source[i] = Math.sin((2 * Math.PI * (i - burstStart)) / burstPeriod);
    } else {
      source[i] = 0.5 * Math.sin((2 * Math.PI * (i - burstStart - burstPeriod)) / carrierPeriod);
    }
  }

  const fade = Math.round(rate4 * 0.010);
  for (let i = 0; i < fade; i++) {
    source[i] *= i / fade;
    source[length - 1 - i] *= i / fade;
  }

  // Anti-alias at fs/2 before decimation, as the table prescribes.
  const kernel = lowPassKernel(511, 0.5 / 4);
  const centre = (kernel.length - 1) / 2;
  const filtered = new Float64Array(length);
  let referencePeak = 0;

  for (let i = 0; i < length; i++) {
    let acc = 0;
    const lo = Math.max(0, i + centre - (length - 1));
    const hi = Math.min(kernel.length - 1, i + centre);
    for (let k = lo; k <= hi; k++) acc += kernel[k] * source[i + centre - k];
    filtered[i] = acc;
    const abs = Math.abs(acc);
    if (abs > referencePeak) referencePeak = abs;
  }

  const decimatedLength = Math.floor((length - offset) / 4);
  const left = new Float32Array(decimatedLength);
  for (let n = 0; n < decimatedLength; n++) left[n] = filtered[4 * n + offset];

  return { left, right: Float32Array.from(left), referencePeakDb: amplitudeToDbTP(referencePeak) };
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

const SINE_CASES = [
  { id: 15, frequency: SAMPLE_RATE / 4, amplitude: 0.50, phaseDegrees: 0.0, expectedDb: -6.0 },
  { id: 16, frequency: SAMPLE_RATE / 4, amplitude: 0.50, phaseDegrees: 45.0, expectedDb: -6.0 },
  { id: 17, frequency: SAMPLE_RATE / 6, amplitude: 0.50, phaseDegrees: 60.0, expectedDb: -6.0 },
  { id: 18, frequency: SAMPLE_RATE / 8, amplitude: 0.50, phaseDegrees: 67.5, expectedDb: -6.0 },
  { id: 19, frequency: SAMPLE_RATE / 4, amplitude: 1.41, phaseDegrees: 45.0, expectedDb: 3.0 }
];

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

  const contiguous = new TruePeakMeter({ sampleRate: SAMPLE_RATE, contiguous: true, smoothing: 1 });
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

  const windowed = new TruePeakMeter({ sampleRate: SAMPLE_RATE, smoothing: 1 });
  for (let start = 0; start + 4096 <= sine.length; start += 800) {
    const window = sine.subarray(start, start + 4096);
    windowed.update(window, window);
  }
  assertClose('Rolling 4096-sample windows of a full-scale 1 kHz sine', windowed.getState().dbtpMax, 0.0, 0.1, ' dBTP');

  check('Default feed is rolling-window (contiguous: false)', windowed.contiguous === false, String(windowed.contiguous));
}

// ─────────────────────────────────────────────────────────────────────────────
// SAMPLE-RATE HANDLING
// ─────────────────────────────────────────────────────────────────────────────

function testSampleRates() {
  console.log('\n--- Over-sampling ratio per sample rate ---');

  const expectedFactors = [[44100, 4], [48000, 4], [88200, 2], [96000, 2], [176400, 1], [192000, 1]];
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

  // 192 kHz needs no over-sampling: the sample grid is already the Annex 2
  // grid, and the worst-case under-read of a 12 kHz tone is 0.17 dB.
  const rate = 192000;
  const { left, right } = stereoSine({ sampleRate: rate, frequency: 12000, amplitude: 0.5, phaseDegrees: 11.25 });
  assertEbu('12 kHz at 11.25°, 0.50 FFS, 192 kHz (sample peak)', calculateTruePeakStereo(left, right, rate).max, -6.0);
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
testSampleRates();

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`Results: ${GREEN}${passed} passed${RESET}, ${RED}${failed} failed${RESET}`);
console.log('═══════════════════════════════════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
}
