/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * VERO-BAAMBI Level Window Test
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Run: node tests/level-window-test.js
 *
 * In Tauri mode the sample-peak and dBFS meters do not measure the display
 * buffers, which are spliced from overlapping or gapped snapshots. They
 * measure a LevelWindow rebuilt from the engine's per-packet summaries of
 * consecutive, non-overlapping blocks. These tests check that the window
 * reads exactly what the local meters read from the samples themselves:
 *
 *   1. Peak and RMS over irregular blocks equal a direct measurement of the
 *      covered samples, and the window covers the span the local meters do.
 *   2. The RMS is exact over unequal blocks, not a mean of block RMS values.
 *   3. A single-sample transient stays in the window until it has passed.
 *   4. The dBFS summaries of the protocol, rounded to f32, lose < 0.001 dB.
 *   5. Invalid input cannot poison the window; capacity and reset hold.
 *   6. SamplePeakMeter.updateFromPeaks() fed from the window matches
 *      SamplePeakMeter.update() fed with the same samples, step for step.
 *
 * @module tests/level-window-test
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { LevelWindow } from '../src/metering/level-window.js';
import { SamplePeakMeter } from '../src/metering/sample-peak.js';

let passed = 0;
let failed = 0;

function test(name, condition, detail = '') {
  if (condition) {
    console.log(`\x1b[32m[PASS]\x1b[0m ${name}`);
    passed++;
  } else {
    console.log(`\x1b[31m[FAIL]\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNALS AND BLOCKS
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_RATE = 48000;
const WINDOW_FRAMES = 4096;

/** Deterministic pseudo-random sequence (mulberry32). */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One second of programme-like stereo: sine plus noise, with a burst. */
function programme() {
  const next = random(1770);
  const left = new Float32Array(SAMPLE_RATE);
  const right = new Float32Array(SAMPLE_RATE);
  for (let i = 0; i < SAMPLE_RATE; i++) {
    const burst = i >= 20000 && i < 20480 ? 0.6 : 0.1;
    left[i] = burst * Math.sin(2 * Math.PI * 997 * i / SAMPLE_RATE) + 0.05 * (next() - 0.5);
    right[i] = 0.2 * Math.sin(2 * Math.PI * 60 * i / SAMPLE_RATE) + 0.05 * (next() - 0.5);
  }
  return { left, right };
}

/** Summary of samples [start, end) as the engine reports a block. */
function summarise(left, right, start, end) {
  let peakLeft = 0, peakRight = 0, energyLeft = 0, energyRight = 0;
  for (let i = start; i < end; i++) {
    peakLeft = Math.max(peakLeft, Math.abs(left[i]));
    peakRight = Math.max(peakRight, Math.abs(right[i]));
    energyLeft += left[i] * left[i];
    energyRight += right[i] * right[i];
  }
  const frames = end - start;
  return { peakLeft, peakRight, meanSquareLeft: energyLeft / frames, meanSquareRight: energyRight / frames, frames };
}

/** Packet sizes of an engine whose UI thread wakes irregularly, a stall included. */
const BLOCK_SIZES = [384, 401, 377, 512, 1, 768, 2600, 128, 9000, 64, 385];

function closeTo(actual, expected, relative) {
  return Math.abs(actual - expected) <= relative * Math.abs(expected);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. EQUIVALENCE WITH A DIRECT MEASUREMENT
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- 1. Irregular blocks against a direct measurement of the covered samples ---');
{
  const { left, right } = programme();
  const window = new LevelWindow({ windowFrames: WINDOW_FRAMES });
  const blockEnds = [];
  let position = 0;
  let block = 0;
  const worst = { peak: 0, rms: 0, coverage: true };

  while (position < left.length) {
    const size = BLOCK_SIZES[block++ % BLOCK_SIZES.length];
    const end = Math.min(position + size, left.length);
    const s = summarise(left, right, position, end);
    window.push(s.peakLeft, s.peakRight, s.meanSquareLeft, s.meanSquareRight, s.frames);
    blockEnds.push({ start: position, end });
    position = end;

    // The window must hold the newest blocks covering at least WINDOW_FRAMES
    let covered = 0;
    let first = blockEnds.length;
    while (first > 0 && covered < WINDOW_FRAMES) covered += blockEnds[--first].end - blockEnds[first].start;
    const expected = summarise(left, right, blockEnds[first].start, end);
    const state = window.getState();

    if (state.frames !== expected.frames) worst.coverage = false;
    worst.peak = Math.max(worst.peak,
      Math.abs(state.peakLeft - expected.peakLeft), Math.abs(state.peakRight - expected.peakRight));
    worst.rms = Math.max(worst.rms,
      Math.abs(state.rmsLeft / Math.sqrt(expected.meanSquareLeft) - 1),
      Math.abs(state.rmsRight / Math.sqrt(expected.meanSquareRight) - 1));
  }

  test('Window covers the newest whole blocks spanning at least 4096 frames', worst.coverage);
  test('Peak equals the direct measurement of the covered samples', worst.peak === 0, `max deviation ${worst.peak}`);
  test('RMS equals the direct measurement within 1e-12', worst.rms < 1e-12, `max relative deviation ${worst.rms}`);

  // Blocks that divide the window cover it exactly, as the analyser buffer does
  const exact = new LevelWindow({ windowFrames: WINDOW_FRAMES });
  for (let start = 0; start < left.length; start += 512) {
    const s = summarise(left, right, start, start + 512);
    exact.push(s.peakLeft, s.peakRight, s.meanSquareLeft, s.meanSquareRight, s.frames);
  }
  const direct = summarise(left, right, left.length - WINDOW_FRAMES, left.length);
  const state = exact.getState();
  test('512-frame blocks cover exactly the latest 4096 samples', state.frames === WINDOW_FRAMES);
  test('…and read the same peak as those samples', state.peakLeft === direct.peakLeft && state.peakRight === direct.peakRight);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. RMS OVER UNEQUAL BLOCKS
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- 2. RMS is exact over unequal blocks ---');
{
  const window = new LevelWindow({ windowFrames: 400 });
  window.push(1, 1, 1, 1, 100);        // 100 frames at RMS 1
  window.push(0.5, 0.5, 0.25, 0.25, 300); // 300 frames at RMS 0.5
  const { rmsLeft, frames } = window.getState();
  const exact = Math.sqrt((100 * 1 + 300 * 0.25) / 400);
  const meanOfRms = (100 * 1 + 300 * 0.5) / 400;
  test('Covers both blocks', frames === 400);
  test(`RMS = √(Σ ms·n / Σ n) = ${exact.toFixed(4)}`, closeTo(rmsLeft, exact, 1e-15), `got ${rmsLeft}`);
  test(`…not the frame-weighted mean of block RMS values (${meanOfRms.toFixed(4)})`, Math.abs(rmsLeft - meanOfRms) > 0.03);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. TRANSIENT
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- 3. A single-sample transient stays until it has left the window ---');
{
  const window = new LevelWindow({ windowFrames: WINDOW_FRAMES });
  const block = 384;
  window.push(0, 0, 0, 0, block);
  window.push(1, 0, 1 / block, 0, block); // one full-scale sample among 384
  let blocksWithPeak = 1;
  for (;;) {
    window.push(0, 0, 0, 0, block);
    if (window.getState().peakLeft !== 1) break;
    blocksWithPeak++;
  }
  // The spike's block stays while the newer blocks alone cover fewer than
  // 4096 frames: ⌈4096 / 384⌉ = 11 blocks in all
  test('Full-scale sample read for 11 consecutive packets', blocksWithPeak === 11, `got ${blocksWithPeak}`);
  test('Then the window reads silence', window.getState().peakLeft === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. PROTOCOL PRECISION
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- 4. dBFS summaries rounded to f32, as the protocol carries them ---');
{
  const { left, right } = programme();
  const linear = new LevelWindow({ windowFrames: WINDOW_FRAMES });
  const protocol = new LevelWindow({ windowFrames: WINDOW_FRAMES });
  let worstDb = 0;
  for (let start = 0, i = 0; start < left.length; i++) {
    const end = Math.min(start + BLOCK_SIZES[i % BLOCK_SIZES.length], left.length);
    const s = summarise(left, right, start, end);
    linear.push(s.peakLeft, s.peakRight, s.meanSquareLeft, s.meanSquareRight, s.frames);
    protocol.pushDb(
      Math.fround(20 * Math.log10(s.peakLeft)),
      Math.fround(20 * Math.log10(s.peakRight)),
      Math.fround(10 * Math.log10(s.meanSquareLeft)),
      Math.fround(10 * Math.log10(s.meanSquareRight)),
      s.frames
    );
    const a = linear.getState();
    const b = protocol.getState();
    for (const key of ['peakLeft', 'peakRight', 'rmsLeft', 'rmsRight']) {
      worstDb = Math.max(worstDb, Math.abs(20 * Math.log10(b[key] / a[key])));
    }
    start = end;
  }
  test('Peak and RMS within 0.001 dB of the linear summaries', worstDb < 0.001, `worst ${worstDb.toExponential(2)} dB`);

  const silence = new LevelWindow({ windowFrames: WINDOW_FRAMES });
  silence.pushDb(-200, -200, -200, -200, 480);
  const quiet = silence.getState();
  test('−200 dBFS reads as silence (below −190 dBFS)', 20 * Math.log10(quiet.peakLeft) < -190 && 20 * Math.log10(quiet.rmsRight) < -190);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. ROBUSTNESS, CAPACITY AND RESET
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- 5. Invalid input, capacity and reset ---');
{
  const window = new LevelWindow({ windowFrames: 1000 });
  window.push(0.5, 0.5, 0.25, 0.25, 0);
  window.push(0.5, 0.5, 0.25, 0.25, NaN);
  window.push(0.5, 0.5, 0.25, 0.25, undefined);
  test('Blocks without frames are ignored', window.getState().frames === 0);

  window.push(NaN, Infinity, -1, NaN, 100);
  const broken = window.getState();
  test('Non-finite or negative levels read as silence, frames still count',
    broken.frames === 100 && broken.peakLeft === 0 && broken.peakRight === 0 && broken.rmsLeft === 0 && broken.rmsRight === 0);

  window.pushDb(undefined, undefined, undefined, undefined, undefined);
  test('A summary without fields is ignored', window.getState().frames === 100);

  const small = new LevelWindow({ windowFrames: 1000, capacity: 4 });
  for (let i = 1; i <= 6; i++) small.push(i / 10, 0, 0, 0, 1);
  const capped = small.getState();
  test('At capacity the oldest blocks go first', capped.frames === 4 && capped.peakLeft === 0.6);

  small.reset();
  const empty = small.getState();
  test('reset() empties the window', empty.frames === 0 && empty.peakLeft === 0 && empty.rmsLeft === 0);

  const rejects = (options) => {
    try {
      return !new LevelWindow(options);
    } catch (error) {
      return error instanceof RangeError;
    }
  };
  test('Invalid window or capacity is rejected',
    [{}, { windowFrames: 0 }, { windowFrames: 1.5 }, { windowFrames: 10, capacity: 0 }].every(rejects));
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. SAMPLE PEAK METER: WINDOW FEED AGAINST SAMPLE FEED
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- 6. SamplePeakMeter.updateFromPeaks() against update() ---');
{
  const { left, right } = programme();
  const fromSamples = new SamplePeakMeter();
  const fromWindow = new SamplePeakMeter();
  const window = new LevelWindow({ windowFrames: WINDOW_FRAMES });
  let identical = true;
  let steps = 0;

  // One render frame per 800 samples (60 Hz at 48 kHz), blocks of 400
  for (let end = 800; end <= left.length; end += 800) {
    for (const start of [end - 800, end - 400]) {
      const s = summarise(left, right, start, start + 400);
      window.push(s.peakLeft, s.peakRight, s.meanSquareLeft, s.meanSquareRight, s.frames);
    }
    if (end < WINDOW_FRAMES) continue;

    // The analyser buffer: the latest 4096 samples; the window covers 4400
    // in whole blocks, so compare against those 4400 samples
    const { frames, peakLeft, peakRight } = window.getState();
    fromSamples.update(left.subarray(end - frames, end), right.subarray(end - frames, end));
    fromWindow.updateFromPeaks(peakLeft, peakRight);
    steps++;

    const a = fromSamples.getState();
    const b = fromWindow.getState();
    if (a.dbfsLeft !== b.dbfsLeft || a.dbfsRight !== b.dbfsRight ||
        a.dbfsHoldLeft !== b.dbfsHoldLeft || a.dbfsHoldRight !== b.dbfsHoldRight ||
        a.isClipAny !== b.isClipAny) {
      identical = false;
    }
  }
  test(`Readings, holds and clip identical over ${steps} frames`, identical && steps > 50);

  const idle = new SamplePeakMeter();
  idle.updateFromPeaks();
  test('updateFromPeaks() without arguments reads silence', idle.getState().dbfsLeft < -59);
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(50));
console.log(`Results: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
console.log('═'.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
