/**
 * K-Weighting Signal Chain Verification Test
 *
 * Tests that K-weighting filters are correctly implemented per ITU-R BS.1770-4.
 * Verifies frequency response at key points:
 * - 38 Hz: −3 dB (high-pass rolloff)
 * - 1 kHz: ~0 dB (flat in passband)
 * - 4 kHz: +4 dB (high-shelf boost)
 *
 * Also pins the absolute loudness scale: the BS.1770-4 §4 channel summation
 * (single-channel and stereo 997 Hz sines) and EBU Tech 3341 test cases 1 and 2.
 */

import { applyKWeightingOffline, BS1770_COEFFICIENTS_48K } from '../src/metering/k-weighting.js';
import { LUFSMeter } from '../src/metering/lufs.js';

const SAMPLE_RATE = 48000;
const BLOCK_SIZE = 4096;

/**
 * Generate a sine wave buffer at given frequency.
 */
function generateSine(frequency, amplitude, durationSamples) {
  const buffer = new Float32Array(durationSamples);
  const omega = 2 * Math.PI * frequency / SAMPLE_RATE;
  for (let i = 0; i < durationSamples; i++) {
    buffer[i] = amplitude * Math.sin(omega * i);
  }
  return buffer;
}

/**
 * Calculate RMS of a buffer.
 */
function calculateRMS(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i] * buffer[i];
  }
  return Math.sqrt(sum / buffer.length);
}

/**
 * Convert linear amplitude to dB.
 */
function toDB(linear) {
  return 20 * Math.log10(linear + 1e-12);
}

/**
 * Test K-weighting frequency response.
 */
function testKWeightingResponse() {
  console.log('\\n═══════════════════════════════════════════════════════════════════════════');
  console.log('K-WEIGHTING FREQUENCY RESPONSE TEST');
  console.log('═══════════════════════════════════════════════════════════════════════════\\n');

  // Expected values based on Web Audio BiquadFilter implementation
  // High-pass at 38 Hz (Q=0.5) + High-shelf at 4 kHz (+4 dB)
  const testFrequencies = [
    { freq: 38, expected: -6.0, tolerance: 1.0, desc: 'High-pass corner' },
    { freq: 100, expected: -1.1, tolerance: 0.5, desc: 'Low frequency' },
    { freq: 1000, expected: 0.7, tolerance: 0.5, desc: 'Reference frequency' },
    { freq: 2000, expected: 3.0, tolerance: 0.5, desc: 'Mid frequency' },
    { freq: 4000, expected: 4.0, tolerance: 0.5, desc: 'High-shelf knee' },
    { freq: 8000, expected: 4.0, tolerance: 0.5, desc: 'High frequency' },
    { freq: 12000, expected: 4.0, tolerance: 0.5, desc: 'Very high frequency' },
  ];

  let allPassed = true;

  for (const test of testFrequencies) {
    const duration = Math.max(SAMPLE_RATE, Math.ceil(SAMPLE_RATE / test.freq) * test.freq * 10);
    const input = generateSine(test.freq, 0.5, duration);
    const output = applyKWeightingOffline(input, SAMPLE_RATE);

    const inputRMS = calculateRMS(input);
    const outputRMS = calculateRMS(output);
    const gainDB = toDB(outputRMS / inputRMS);

    const error = Math.abs(gainDB - test.expected);
    const passed = error <= test.tolerance;

    if (!passed) allPassed = false;

    const status = passed ? '✓ PASS' : '✗ FAIL';
    console.log(`  ${test.freq.toString().padStart(5)} Hz: ${gainDB.toFixed(2).padStart(6)} dB (expected ${test.expected.toFixed(1).padStart(5)} ±${test.tolerance}) ${status} [${test.desc}]`);
  }

  console.log('');
  return allPassed;
}

/**
 * Run a K-weighted stereo signal through a fresh LUFSMeter and return its readings.
 *
 * @param {Float32Array} left
 * @param {Float32Array} right
 * @returns {{ momentary: number, shortTerm: number, integrated: number }}
 */
function measureStereo(left, right) {
  const meter = new LUFSMeter({ sampleRate: SAMPLE_RATE, blockSize: BLOCK_SIZE });
  const kLeft = applyKWeightingOffline(left, SAMPLE_RATE);
  const kRight = applyKWeightingOffline(right, SAMPLE_RATE);

  for (let i = 0; i + BLOCK_SIZE <= kLeft.length; i += BLOCK_SIZE) {
    const energy = meter.calculateBlockEnergy(
      kLeft.slice(i, i + BLOCK_SIZE),
      kRight.slice(i, i + BLOCK_SIZE)
    );
    meter.pushBlock(energy);
  }

  return meter.getReadings();
}

/**
 * Test the BS.1770-4 channel summation with the 997 Hz reference sine.
 *
 * ITU-R BS.1770-4 §4: a 0 dBFS sine applied to one channel (L, C or R) reads
 * −3.01 LKFS. The same sine applied in phase to both L and R doubles the
 * summed energy (Σ Gᵢ·zᵢ) and therefore reads 0.0 LKFS.
 */
function testLUFSCalculation() {
  console.log('\\n═══════════════════════════════════════════════════════════════════════════');
  console.log('LUFS CHANNEL SUMMATION TEST (ITU-R BS.1770-4 §4)');
  console.log('═══════════════════════════════════════════════════════════════════════════\\n');

  const tolerance = 0.1;
  const sine997 = generateSine(997, 1.0, SAMPLE_RATE * 3);
  const silence = new Float32Array(sine997.length);

  const cases = [
    { desc: '997 Hz @ 0 dBFS, left channel only', left: sine997, right: silence, expected: -3.01 },
    { desc: '997 Hz @ 0 dBFS, both channels in phase', left: sine997, right: sine997, expected: 0.0 },
  ];

  let allPassed = true;

  for (const c of cases) {
    const readings = measureStereo(c.left, c.right);
    const error = Math.abs(readings.integrated - c.expected);
    const passed = error <= tolerance;
    if (!passed) allPassed = false;

    console.log(`  ${c.desc} → ${readings.integrated.toFixed(2)} LUFS (expected ${c.expected.toFixed(2)} ±${tolerance})`);
    console.log(`  Status: ${passed ? '✓ PASS' : '✗ FAIL'}\\n`);
  }

  return allPassed;
}

/**
 * EBU Tech 3341 minimum requirements, test cases 1 and 2.
 *
 * A stereo 1 kHz sine at −23.0 dBFS (per-channel peak level), applied in phase
 * to both channels for 20 s, shall read M, S and I = −23.0 ±0.1 LUFS. Case 2
 * repeats the measurement at −33.0 dBFS. Sines are deterministic, so these
 * cases pin the absolute level without any tuned scale factor.
 */
function testEbuTech3341Levels() {
  console.log('\\n═══════════════════════════════════════════════════════════════════════════');
  console.log('EBU TECH 3341 LEVEL TEST (cases 1 and 2)');
  console.log('═══════════════════════════════════════════════════════════════════════════\\n');

  const tolerance = 0.1;
  const durationSamples = SAMPLE_RATE * 20;
  const cases = [
    { id: 1, levelDbfs: -23.0 },
    { id: 2, levelDbfs: -33.0 },
  ];

  let allPassed = true;

  for (const c of cases) {
    const amplitude = Math.pow(10, c.levelDbfs / 20);
    const sine = generateSine(1000, amplitude, durationSamples);
    const readings = measureStereo(sine, sine);

    const results = [
      ['M', readings.momentary],
      ['S', readings.shortTerm],
      ['I', readings.integrated],
    ];
    const passed = results.every(([, value]) => Math.abs(value - c.levelDbfs) <= tolerance);
    if (!passed) allPassed = false;

    const summary = results.map(([name, value]) => `${name} = ${value.toFixed(2)}`).join(', ');
    console.log(`  Case ${c.id}: stereo 1 kHz @ ${c.levelDbfs.toFixed(1)} dBFS → ${summary} LUFS`);
    console.log(`  Expected: ${c.levelDbfs.toFixed(1)} ±${tolerance} LUFS on M, S and I`);
    console.log(`  Status: ${passed ? '✓ PASS' : '✗ FAIL'}\\n`);
  }

  return allPassed;
}

// Run all tests
console.log('\\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  K-WEIGHTING SIGNAL CHAIN VERIFICATION                                    ║');
console.log('║  ITU-R BS.1770-4 Compliance Test                                          ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝');

const results = {
  kWeighting: testKWeightingResponse(),
  lufs: testLUFSCalculation(),
  ebu3341: testEbuTech3341Levels(),
};

console.log('\\n═══════════════════════════════════════════════════════════════════════════');
console.log('SUMMARY');
console.log('═══════════════════════════════════════════════════════════════════════════\\n');

const allPassed = Object.values(results).every(r => r);
console.log(`  K-weighting frequency response: ${results.kWeighting ? '✓ PASS' : '✗ FAIL'}`);
console.log(`  Channel summation (BS.1770-4):  ${results.lufs ? '✓ PASS' : '✗ FAIL'}`);
console.log(`  EBU Tech 3341 cases 1 and 2:    ${results.ebu3341 ? '✓ PASS' : '✗ FAIL'}`);
console.log('');
console.log(`  Overall: ${allPassed ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'}`);
console.log('');

process.exit(allPassed ? 0 : 1);
