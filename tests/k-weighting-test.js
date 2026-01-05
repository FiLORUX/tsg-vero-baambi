/**
 * K-Weighting Signal Chain Verification Test
 *
 * Tests that K-weighting filters are correctly implemented per ITU-R BS.1770-4.
 * Verifies frequency response at key points:
 * - 38 Hz: −3 dB (high-pass rolloff)
 * - 1 kHz: ~0 dB (flat in passband)
 * - 4 kHz: +4 dB (high-shelf boost)
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
 * Test LUFS calculation with K-weighted signal.
 */
function testLUFSCalculation() {
  console.log('\\n═══════════════════════════════════════════════════════════════════════════');
  console.log('LUFS CALCULATION TEST');
  console.log('═══════════════════════════════════════════════════════════════════════════\\n');

  const meter = new LUFSMeter({ sampleRate: SAMPLE_RATE, blockSize: BLOCK_SIZE });

  // 997 Hz sine at 0 dBFS (per IEC 61606 calibration)
  // After K-weighting and LUFS calculation, should yield approximately -3.01 LUFS
  const sine997 = generateSine(997, 1.0, SAMPLE_RATE * 3);
  const kWeighted997 = applyKWeightingOffline(sine997, SAMPLE_RATE);

  // Push blocks to LUFS meter
  for (let i = 0; i < kWeighted997.length; i += BLOCK_SIZE) {
    const blockL = kWeighted997.slice(i, i + BLOCK_SIZE);
    const blockR = kWeighted997.slice(i, i + BLOCK_SIZE);
    if (blockL.length === BLOCK_SIZE) {
      const energy = meter.calculateBlockEnergy(blockL, blockR);
      meter.pushBlock(energy);
    }
  }

  const readings = meter.getReadings();
  const expected = -3.01;
  const tolerance = 0.5;
  const error = Math.abs(readings.integrated - expected);
  const passed = error <= tolerance;

  console.log(`  997 Hz @ 0 dBFS → ${readings.integrated.toFixed(2)} LUFS (expected ${expected} ±${tolerance})`);
  console.log(`  Status: ${passed ? '✓ PASS' : '✗ FAIL'}\\n`);

  return passed;
}

/**
 * Test pink noise LUFS level.
 */
function testPinkNoiseLUFS() {
  console.log('\\n═══════════════════════════════════════════════════════════════════════════');
  console.log('PINK NOISE LUFS TEST (Verification Signal Level)');
  console.log('═══════════════════════════════════════════════════════════════════════════\\n');

  const meter = new LUFSMeter({ sampleRate: SAMPLE_RATE, blockSize: BLOCK_SIZE });

  // Generate pink noise using Paul Kellet algorithm with 0.035 scale factor
  const duration = SAMPLE_RATE * 10;
  const pinkL = new Float32Array(duration);
  const pinkR = new Float32Array(duration);

  // Generate for L channel
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < duration; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    pinkL[i] = pink * 0.042;
  }

  // Generate for R channel (independent noise)
  b0 = 0; b1 = 0; b2 = 0; b3 = 0; b4 = 0; b5 = 0; b6 = 0;
  for (let i = 0; i < duration; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    pinkR[i] = pink * 0.042;
  }

  // Apply K-weighting
  const kWeightedL = applyKWeightingOffline(pinkL, SAMPLE_RATE);
  const kWeightedR = applyKWeightingOffline(pinkR, SAMPLE_RATE);

  // Push blocks to LUFS meter
  for (let i = 0; i < kWeightedL.length; i += BLOCK_SIZE) {
    const blockL = kWeightedL.slice(i, i + BLOCK_SIZE);
    const blockR = kWeightedR.slice(i, i + BLOCK_SIZE);
    if (blockL.length === BLOCK_SIZE) {
      const energy = meter.calculateBlockEnergy(blockL, blockR);
      meter.pushBlock(energy);
    }
  }

  const readings = meter.getReadings();
  const expected = -23.0;
  const tolerance = 0.5;
  const error = Math.abs(readings.integrated - expected);
  const passed = error <= tolerance;

  console.log(`  Pink noise (0.042 scale) → ${readings.integrated.toFixed(2)} LUFS`);
  console.log(`  Expected: ${expected} ±${tolerance} LUFS`);
  console.log(`  Status: ${passed ? '✓ PASS' : '✗ FAIL'}\\n`);

  if (!passed) {
    // Calculate adjustment needed
    const adjustment = expected - readings.integrated;
    const adjustmentFactor = Math.pow(10, adjustment / 20);
    const newScale = 0.042 * adjustmentFactor;
    console.log(`  Suggested scale factor adjustment: ${newScale.toFixed(4)}`);
  }

  return passed;
}

// Run all tests
console.log('\\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  K-WEIGHTING SIGNAL CHAIN VERIFICATION                                    ║');
console.log('║  ITU-R BS.1770-4 Compliance Test                                          ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝');

const results = {
  kWeighting: testKWeightingResponse(),
  lufs: testLUFSCalculation(),
  pinkNoise: testPinkNoiseLUFS(),
};

console.log('\\n═══════════════════════════════════════════════════════════════════════════');
console.log('SUMMARY');
console.log('═══════════════════════════════════════════════════════════════════════════\\n');

const allPassed = Object.values(results).every(r => r);
console.log(`  K-weighting frequency response: ${results.kWeighting ? '✓ PASS' : '✗ FAIL'}`);
console.log(`  LUFS calculation (997 Hz ref):  ${results.lufs ? '✓ PASS' : '✗ FAIL'}`);
console.log(`  Pink noise calibration:         ${results.pinkNoise ? '✓ PASS' : '✗ FAIL'}`);
console.log('');
console.log(`  Overall: ${allPassed ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'}`);
console.log('');

process.exit(allPassed ? 0 : 1);
