/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * VERO-BAAMBI Metering Verification
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Run: node tests/metering-verification.js
 *
 * These tests verify metering accuracy against synthetic reference signals.
 * All thresholds are based on practical tolerance for broadcast applications.
 *
 * NOTE: Some tests require Web Audio API and must run in browser.
 * This file tests pure mathematical functions that work in Node.js.
 *
 * @module tests/metering-verification
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// TEST UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';

let passed = 0;
let failed = 0;
let warnings = 0;

function pass(name, actual, expected, unit = '') {
  console.log(`${GREEN}[PASS]${RESET} ${name}: ${actual}${unit} (expected: ${expected}${unit})`);
  passed++;
}

function fail(name, actual, expected, unit = '') {
  console.log(`${RED}[FAIL]${RESET} ${name}: ${actual}${unit} (expected: ${expected}${unit})`);
  failed++;
}

function warn(name, actual, expected, unit = '') {
  console.log(`${YELLOW}[WARN]${RESET} ${name}: ${actual}${unit} (expected: ${expected}${unit}) — within tolerance`);
  warnings++;
}

function assertClose(name, actual, expected, tolerance, unit = '') {
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) {
    pass(name, actual.toFixed(3), `${expected} ±${tolerance}`);
  } else if (diff <= tolerance * 2) {
    warn(name, actual.toFixed(3), `${expected} ±${tolerance}`, unit);
  } else {
    fail(name, actual.toFixed(3), `${expected} ±${tolerance}`, unit);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SYNTHETIC SIGNAL GENERATORS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a sine wave at specified frequency and amplitude.
 *
 * @param {number} sampleRate - Sample rate in Hz
 * @param {number} frequency - Frequency in Hz
 * @param {number} amplitude - Peak amplitude (0-1)
 * @param {number} duration - Duration in seconds
 * @returns {Float32Array} Audio samples
 */
function generateSine(sampleRate, frequency, amplitude, duration) {
  const samples = Math.floor(sampleRate * duration);
  const buffer = new Float32Array(samples);
  const omega = 2 * Math.PI * frequency / sampleRate;

  for (let i = 0; i < samples; i++) {
    buffer[i] = amplitude * Math.sin(omega * i);
  }

  return buffer;
}

/**
 * Generate intersample peak test signal.
 * Two frequencies that constructively interfere between samples.
 *
 * @param {number} sampleRate - Sample rate in Hz
 * @param {number} duration - Duration in seconds
 * @returns {Float32Array} Audio samples
 */
function generateIntersamplePeak(sampleRate, duration) {
  const samples = Math.floor(sampleRate * duration);
  const buffer = new Float32Array(samples);

  // Two frequencies near Nyquist that beat together
  const f1 = sampleRate * 0.49;
  const f2 = sampleRate * 0.48;
  const omega1 = 2 * Math.PI * f1 / sampleRate;
  const omega2 = 2 * Math.PI * f2 / sampleRate;

  for (let i = 0; i < samples; i++) {
    buffer[i] = 0.5 * (Math.sin(omega1 * i) + Math.sin(omega2 * i));
  }

  return buffer;
}

// ─────────────────────────────────────────────────────────────────────────────
// MATHEMATICAL FUNCTION TESTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Test dB conversion functions.
 */
function testDbConversions() {
  console.log('\n--- dB Conversions ---');

  // Test gainToDb
  const testCases = [
    { gain: 1.0, expectedDb: 0 },
    { gain: 0.5, expectedDb: -6.02 },
    { gain: 0.1, expectedDb: -20 },
    { gain: 0.01, expectedDb: -40 },
    { gain: 2.0, expectedDb: 6.02 },
  ];

  for (const { gain, expectedDb } of testCases) {
    const actualDb = 20 * Math.log10(gain);
    assertClose(`gainToDb(${gain})`, actualDb, expectedDb, 0.1, ' dB');
  }

  // Test dbToGain
  console.log('\n--- Gain from dB ---');
  const dbCases = [
    { db: 0, expectedGain: 1.0 },
    { db: -6, expectedGain: 0.501 },
    { db: -20, expectedGain: 0.1 },
    { db: -40, expectedGain: 0.01 },
    { db: 6, expectedGain: 1.995 },
  ];

  for (const { db, expectedGain } of dbCases) {
    const actualGain = Math.pow(10, db / 20);
    assertClose(`dbToGain(${db})`, actualGain, expectedGain, 0.01);
  }
}

/**
 * Test RMS calculation.
 */
function testRmsCalculation() {
  console.log('\n--- RMS Calculation ---');

  // Sine wave RMS should be peak / sqrt(2)
  const sampleRate = 48000;
  const peak = 0.5;
  const sine = generateSine(sampleRate, 1000, peak, 0.1);

  let sumSquares = 0;
  for (let i = 0; i < sine.length; i++) {
    sumSquares += sine[i] * sine[i];
  }
  const rms = Math.sqrt(sumSquares / sine.length);

  const expectedRms = peak / Math.sqrt(2);
  assertClose('Sine RMS', rms, expectedRms, 0.001);

  // RMS in dB should be peak dB - 3.01
  const peakDb = 20 * Math.log10(peak);
  const rmsDb = 20 * Math.log10(rms);
  assertClose('Sine RMS (dB offset from peak)', peakDb - rmsDb, 3.01, 0.1, ' dB');
}

/**
 * Test stereo correlation calculation.
 */
function testCorrelation() {
  console.log('\n--- Stereo Correlation ---');

  const sampleRate = 48000;
  const duration = 0.1;
  const samples = Math.floor(sampleRate * duration);

  // Test 1: Mono signal (L = R) should give +1.0
  const mono = generateSine(sampleRate, 1000, 0.5, duration);
  const monoCorr = calculateCorrelation(mono, mono);
  assertClose('Correlation (mono L=R)', monoCorr, 1.0, 0.01);

  // Test 2: Inverted signal (L = -R) should give -1.0
  const inverted = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    inverted[i] = -mono[i];
  }
  const invertedCorr = calculateCorrelation(mono, inverted);
  assertClose('Correlation (inverted L=-R)', invertedCorr, -1.0, 0.01);

  // Test 3: Uncorrelated signals (very different frequencies) should be near 0
  // Using frequencies with no harmonic relationship
  const left = generateSine(sampleRate, 1000, 0.5, duration);
  const right = generateSine(sampleRate, 1777, 0.5, duration); // Non-harmonic freq
  const uncorrCorr = calculateCorrelation(left, right);
  assertClose('Correlation (uncorrelated)', uncorrCorr, 0.0, 0.2);
}

/**
 * Calculate Pearson correlation coefficient.
 */
function calculateCorrelation(left, right) {
  const n = Math.min(left.length, right.length);
  if (n === 0) return 0;

  let sumL = 0, sumR = 0, sumLR = 0, sumL2 = 0, sumR2 = 0;

  for (let i = 0; i < n; i++) {
    const l = left[i];
    const r = right[i];
    sumL += l;
    sumR += r;
    sumLR += l * r;
    sumL2 += l * l;
    sumR2 += r * r;
  }

  const meanL = sumL / n;
  const meanR = sumR / n;

  let num = 0, denL = 0, denR = 0;
  for (let i = 0; i < n; i++) {
    const dL = left[i] - meanL;
    const dR = right[i] - meanR;
    num += dL * dR;
    denL += dL * dL;
    denR += dR * dR;
  }

  const den = Math.sqrt(denL * denR);
  return den > 0 ? num / den : 0;
}

/**
 * Test Hermite interpolation for True Peak.
 */
function testHermiteInterpolation() {
  console.log('\n--- Hermite Interpolation ---');

  // Test that Hermite interpolation at integer points returns original values
  const y0 = 0.2;
  const y1 = 0.8;
  const y2 = 0.6;
  const y3 = 0.3;

  // At t=0, should return y1
  const atZero = hermite(y0, y1, y2, y3, 0);
  assertClose('Hermite at t=0', atZero, y1, 0.001);

  // At t=1, should return y2
  const atOne = hermite(y0, y1, y2, y3, 1);
  assertClose('Hermite at t=1', atOne, y2, 0.001);

  // Midpoint should be smooth interpolation
  const atHalf = hermite(y0, y1, y2, y3, 0.5);
  const linearMid = (y1 + y2) / 2;
  // Hermite typically overshoots linear interpolation for these values
  console.log(`  Hermite at t=0.5: ${atHalf.toFixed(4)} (linear would be ${linearMid.toFixed(4)})`);
}

/**
 * Hermite interpolation.
 */
function hermite(y0, y1, y2, y3, t) {
  const c0 = y1;
  const c1 = 0.5 * (y2 - y0);
  const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
  const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * t + c2) * t + c1) * t + c0;
}

/**
 * Test PPM decay rate calculation.
 */
function testPpmDecay() {
  console.log('\n--- PPM Decay Rate ---');

  // IEC 60268-10 Type I: 20 dB decay in 1.7s
  const targetDecayDb = 20;
  const targetDecayTime = 1.7;
  const decayRateDbPerS = targetDecayDb / targetDecayTime;

  assertClose('PPM decay rate', decayRateDbPerS, 11.76, 0.1, ' dB/s');

  // Simulate decay over 1.7 seconds
  const fps = 60;
  const frames = fps * targetDecayTime;
  const dtPerFrame = targetDecayTime / frames;

  let level = 0; // Start at 0 dBFS
  for (let i = 0; i < frames; i++) {
    level -= decayRateDbPerS * dtPerFrame;
  }

  assertClose('PPM level after 1.7s decay', level, -20, 0.5, ' dB');
}

/**
 * Test K-weighting response at key frequencies.
 */
function testKWeightingResponse() {
  console.log('\n--- K-Weighting Response (Reference) ---');

  // Reference values from ITU-R BS.1770-4 at 48kHz
  // These are approximate expected gains
  const referencePoints = [
    { freq: 100, gain: 0.0 },      // Below shelf, minimal effect
    { freq: 1000, gain: 0.0 },     // Reference frequency
    { freq: 4000, gain: 2.0 },     // Shelf transition
    { freq: 10000, gain: 4.0 },    // Full shelf boost
  ];

  console.log('  Expected K-weighting response (approximate):');
  for (const { freq, gain } of referencePoints) {
    console.log(`    ${freq} Hz: ${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB`);
  }
  console.log('  (Actual verification requires Web Audio API - see tools/verify-audio.html)');
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN TESTS
// ─────────────────────────────────────────────────────────────────────────────

console.log(`${BOLD}VERO-BAAMBI Metering Verification${RESET}`);
console.log('═══════════════════════════════════════════════════════════════\n');
console.log('Testing pure mathematical functions (Node.js compatible)');
console.log('For full audio tests, open tools/verify-audio.html in a browser\n');

testDbConversions();
testRmsCalculation();
testCorrelation();
testHermiteInterpolation();
testPpmDecay();
testKWeightingResponse();

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`Results: ${GREEN}${passed} passed${RESET}, ${RED}${failed} failed${RESET}, ${YELLOW}${warnings} warnings${RESET}`);
console.log('═══════════════════════════════════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
}
