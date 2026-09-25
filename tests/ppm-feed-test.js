/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * VERO-BAAMBI PPM Feed Test
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Run: node tests/ppm-feed-test.js
 *
 * The IEC 60268-10 quasi-peak detectors advance one sample per input sample,
 * so their integration and return times hold only if each sample reaches them
 * exactly once. The application once fed them the rolling analyser window on
 * every frame, which replays samples; it now takes their readings from
 * detectors that see every sample. These tests check that chain:
 *
 *   1. QuasiPeakDetector reads exactly as calculateQuasiPeakRC() (Type I)
 *      and calculateBBCQuasiPeakRC() (Type IIa), whatever the block sizes.
 *   2. Its return times: 20 dB in 1.7 s (Type I), 24 dB in 2.8 s (Type IIa).
 *   3. The stereo-sampler AudioWorklet reads exactly as QuasiPeakDetector,
 *      reports every sample about every 10 ms, measures silent quanta and
 *      resets on request.
 *   4. The main-thread sampler: ballistics handed to the worklet, largest
 *      readings accumulated until consumed, stale reports after a reset
 *      dropped, and the ScriptProcessor fallback on the same arithmetic.
 *   5. PPMMeter.updateFromReadings() clamps and holds as update() does.
 *   6. The defect: a rolling window fed every frame runs the return fast.
 *   7. The return reaches a lower steady level however small the drop, so a
 *      reading a transient pushed up falls back to the signal.
 *
 * @module tests/ppm-feed-test
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  QuasiPeakDetector,
  PPMMeter,
  quasiPeakCoefficients,
  calculateQuasiPeakRC,
  calculateBBCQuasiPeakRC,
  NORDIC_PPM_BALLISTICS,
  BBC_PPM_BALLISTICS
} from '../src/metering/ppm.js';

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`\x1b[32m[PASS]\x1b[0m ${name}${detail ? `: ${detail}` : ''}`);
    passed++;
  } else {
    console.log(`\x1b[31m[FAIL]\x1b[0m ${name}${detail ? `: ${detail}` : ''}`);
    failed++;
  }
}

function info(text) {
  console.log(`\x1b[2m       ${text}\x1b[0m`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNALS
// ─────────────────────────────────────────────────────────────────────────────

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

/**
 * Programme-like test signal: tone, short bursts, noise and silence, so the
 * detectors attack, hold, return and attack again.
 */
function programme(sampleRate, seconds, seed) {
  const next = random(seed);
  const signal = new Float32Array(Math.round(sampleRate * seconds));
  for (let i = 0; i < signal.length; i++) {
    const t = i / sampleRate;
    const phase = t % 1.5;
    let x = 0;
    if (phase < 0.4) x = 0.5 * Math.sin(2 * Math.PI * 1000 * t);
    else if (phase < 0.41) x = 0.9 * Math.sin(2 * Math.PI * 5000 * t);
    else if (phase > 0.9 && phase < 1.1) x = 0.2 * (next() * 2 - 1);
    signal[i] = x;
  }
  return signal;
}

/** Tone of `amplitude` for `toneSeconds`, then silence. */
function toneThenSilence(sampleRate, toneSeconds, totalSeconds, amplitude = 1) {
  const signal = new Float32Array(Math.round(sampleRate * totalSeconds));
  const toneEnd = Math.round(sampleRate * toneSeconds);
  for (let i = 0; i < toneEnd; i++) signal[i] = amplitude * Math.sin(2 * Math.PI * 1000 * i / sampleRate);
  return signal;
}

/** Irregular contiguous block sizes, as callbacks and frames deliver them. */
const BLOCK_SIZES = [1, 128, 37, 512, 800, 2, 4096, 64, 997, 128];

function* blocks(signal) {
  for (let start = 0, i = 0; start < signal.length; i++) {
    const end = Math.min(start + BLOCK_SIZES[i % BLOCK_SIZES.length], signal.length);
    yield signal.subarray(start, end);
    start = end;
  }
}

/**
 * Time in seconds from the first sample whose reading is at or below
 * `from` dB to the first at or below `to` dB, from per-sample readings.
 */
function fallTime(readings, sampleRate, from, to) {
  const start = readings.findIndex((r) => r <= from);
  const end = readings.findIndex((r, i) => i > start && r <= to);
  return start < 0 || end < 0 ? NaN : (end - start) / sampleRate;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. STREAMING DETECTOR AGAINST THE REFERENCE FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- 1. QuasiPeakDetector against calculateQuasiPeakRC / calculateBBCQuasiPeakRC ---');

const coefficients48 = quasiPeakCoefficients(NORDIC_PPM_BALLISTICS, 48000);
const bbcCoefficients48 = quasiPeakCoefficients(BBC_PPM_BALLISTICS, 48000);
check('Type I window at 48 kHz is 5 ms', coefficients48.windowSamples === 240, `${coefficients48.windowSamples} samples`);
check('Type IIa window at 48 kHz is 10 ms', bbcCoefficients48.windowSamples === 480, `${bbcCoefficients48.windowSamples} samples`);

for (const [label, ballistics, reference] of [
  ['Type I', NORDIC_PPM_BALLISTICS, calculateQuasiPeakRC],
  ['Type IIa', BBC_PPM_BALLISTICS, calculateBBCQuasiPeakRC]
]) {
  for (const sampleRate of [44100, 48000, 96000]) {
    const signal = programme(sampleRate, 3.2, sampleRate);
    const detector = new QuasiPeakDetector({ sampleRate, ballistics });
    const state = { envelope: 0, peakDb: -60 };
    let identical = true;
    let blockCount = 0;
    for (const block of blocks(signal)) {
      detector.process(block);
      const expected = reference(block, sampleRate, state);
      if (detector.reading !== expected) identical = false;
      blockCount++;
    }
    check(`${label} at ${sampleRate / 1000} kHz: readings identical after each of ${blockCount} irregular blocks`, identical);
  }

  // The value process() returns is the largest reading during the block
  const sampleRate = 48000;
  const signal = programme(sampleRate, 1.6, 7);
  const perSample = [];
  const state = { envelope: 0, peakDb: -60 };
  for (let i = 0; i < signal.length; i++) perSample.push(reference(signal.subarray(i, i + 1), sampleRate, state));
  const detector = new QuasiPeakDetector({ sampleRate, ballistics });
  let position = 0;
  let largestMatches = true;
  for (const block of blocks(signal)) {
    const largest = detector.process(block);
    let expected = -Infinity;
    for (let i = position; i < position + block.length; i++) expected = Math.max(expected, perSample[i]);
    if (largest !== expected) largestMatches = false;
    position += block.length;
  }
  check(`${label}: process() returns the largest reading within each block`, largestMatches);
}

{
  const detector = new QuasiPeakDetector({ sampleRate: 48000 });
  detector.process(new Float32Array([0.5, NaN, 0.25]));
  const reference = calculateQuasiPeakRC(new Float32Array([0.5, NaN, 0.25]), 48000, { envelope: 0, peakDb: -60 });
  check('NaN is read as the reference reads it (as silence)', detector.reading === reference, `${detector.reading.toFixed(3)} dBFS`);
  check('An empty block returns the current reading', detector.process(new Float32Array(0)) === detector.reading);
  detector.reset();
  check('reset() returns to −60 dBFS', detector.reading === -60);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. RETURN TIMES
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- 2. Return times on the signal clock ---');

for (const sampleRate of [48000, 96000]) {
  const signal = toneThenSilence(sampleRate, 1, 4.5);
  for (const [label, ballistics, span, expected] of [
    ['Type I', NORDIC_PPM_BALLISTICS, 20, 1.7],
    ['Type IIa', BBC_PPM_BALLISTICS, 24, 2.8]
  ]) {
    const detector = new QuasiPeakDetector({ sampleRate, ballistics });
    const readings = [];
    for (let i = 0; i < signal.length; i += 128) {
      const block = signal.subarray(i, i + 128);
      for (let j = 0; j < block.length; j++) readings.push(detector.process(block.subarray(j, j + 1)));
    }
    const steady = readings[Math.round(sampleRate * 0.9)];
    const time = fallTime(readings.slice(Math.round(sampleRate * 0.95)), sampleRate, steady - 2, steady - 2 - span);
    check(`${label} at ${sampleRate / 1000} kHz falls ${span} dB in ${expected} s ±0.3 s`,
      Math.abs(time - expected) <= 0.3, `${time.toFixed(3)} s from ${steady.toFixed(2)} dBFS`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. AUDIOWORKLET PROCESSOR
// ─────────────────────────────────────────────────────────────────────────────

let WorkletProcessor = null;

/** Load the stereo-sampler AudioWorklet module with a minimal global scope. */
async function loadWorkletProcessor() {
  if (WorkletProcessor) return WorkletProcessor;
  globalThis.AudioWorkletProcessor = class {
    constructor() {
      this.port = { postMessage: () => {}, onmessage: null };
    }
  };
  globalThis.registerProcessor = (name, processorClass) => { WorkletProcessor = processorClass; };
  globalThis.currentTime = 0;
  globalThis.sampleRate = 48000;
  await import('../src/audio/stereo-sampler-worklet.js');
  return WorkletProcessor;
}

const PPM_OPTIONS = { ppmBallistics: { nordic: NORDIC_PPM_BALLISTICS, bbc: BBC_PPM_BALLISTICS } };

function render(processor, left, right = left) {
  for (let start = 0; start < left.length; start += 128) {
    processor.process([[left.subarray(start, start + 128), right.subarray(start, start + 128)]]);
  }
}

console.log('\n--- 3. Stereo-sampler worklet ---');
{
  const Processor = await loadWorkletProcessor();

  for (const sampleRate of [48000, 96000]) {
    globalThis.sampleRate = sampleRate;
    const left = programme(sampleRate, 3.2, 3);
    const right = programme(sampleRate, 3.2, 4).map((x) => x * 0.5);
    const processor = new Processor({ processorOptions: { bufferSize: 4096, ...PPM_OPTIONS } });
    const messages = [];
    processor.port.postMessage = (message) => { if (message.type === 'ppm') messages.push(message); };
    render(processor, left, right);

    // The same samples, in the same report intervals, through QuasiPeakDetector
    const references = [
      [new QuasiPeakDetector({ sampleRate }), left, 'nordicLeft'],
      [new QuasiPeakDetector({ sampleRate }), right, 'nordicRight'],
      [new QuasiPeakDetector({ sampleRate, ballistics: BBC_PPM_BALLISTICS }), left, 'bbcLeft'],
      [new QuasiPeakDetector({ sampleRate, ballistics: BBC_PPM_BALLISTICS }), right, 'bbcRight']
    ];
    let identical = true;
    let reported = 0;
    for (const message of messages) {
      for (const [detector, channel, key] of references) {
        const expected = detector.process(channel.subarray(reported, reported + message.samples));
        if (message[key] !== expected) identical = false;
      }
      reported += message.samples;
    }
    const pending = processor._ppmSamples;
    const secondsPerMessage = reported / messages.length / sampleRate;
    check(`${sampleRate / 1000} kHz: worklet readings identical to QuasiPeakDetector in all ${messages.length} reports`, identical);
    check(`${sampleRate / 1000} kHz: every sample reported once, about every 10 ms`,
      reported + pending === left.length && secondsPerMessage > 0.009 && secondsPerMessage < 0.012,
      `${reported} + ${pending} pending, ${(secondsPerMessage * 1000).toFixed(1)} ms per report`);
  }

  globalThis.sampleRate = 48000;
  const silent = new Processor({ processorOptions: { bufferSize: 4096, ...PPM_OPTIONS } });
  let silentSamples = 0;
  let lastReading = 0;
  silent.port.postMessage = (message) => {
    if (message.type !== 'ppm') return;
    silentSamples += message.samples;
    lastReading = message.nordicLeft;
  };
  render(silent, toneThenSilence(48000, 0.5, 0.5));
  for (let quantum = 0; quantum < 375; quantum++) silent.process([[]]);
  const expectedFall = 11.76 * (375 * 128) / 48000;
  check('Quanta without input channels are measured as silence: the reading returns',
    silentSamples + silent._ppmSamples === 24000 + 375 * 128 && Math.abs(lastReading + expectedFall) < 1,
    `${lastReading.toFixed(2)} dBFS after 1 s of empty quanta`);

  const bare = new Processor({ processorOptions: { bufferSize: 4096 } });
  let bareReports = 0;
  bare.port.postMessage = (message) => { if (message.type === 'ppm') bareReports++; };
  render(bare, programme(48000, 0.5, 1));
  check('Without ballistics the worklet reports no PPM', bareReports === 0);

  const resettable = new Processor({ processorOptions: { bufferSize: 4096, ...PPM_OPTIONS } });
  const afterReset = [];
  resettable.port.postMessage = (message) => { if (message.type === 'ppm') afterReset.push(message); };
  render(resettable, toneThenSilence(48000, 0.5, 0.5));
  resettable.port.onmessage({ data: { type: 'resetPpm', generation: 7 } });
  afterReset.length = 0;
  // One report interval (512 samples at 48 kHz) of silence
  render(resettable, new Float32Array(512));
  check('resetPpm returns the detectors to −60 dBFS and adopts the new generation',
    afterReset.length === 1 && afterReset[0].generation === 7 && afterReset[0].nordicLeft < -60 && afterReset[0].bbcLeft < -60,
    `first report ${afterReset[0]?.nordicLeft.toFixed(2)} dBFS, generation ${afterReset[0]?.generation}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. MAIN-THREAD SAMPLER
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal Web Audio stand-ins for the main-thread sampler. */
function stubContext({ workletAvailable }) {
  const nodes = [];
  globalThis.AudioWorkletNode = class {
    constructor(context, name, options) {
      this.options = options;
      this.port = { onmessage: null, postMessage: () => {} };
      nodes.push(this);
    }
    connect() {}
    disconnect() {}
  };
  const context = {
    sampleRate: 48000,
    destination: {},
    audioWorklet: { addModule: async () => { if (!workletAvailable) throw new Error('unavailable'); } },
    createChannelMerger: () => ({ connect() {} }),
    createGain: () => ({ gain: { value: 1 }, connect() {} }),
    createScriptProcessor: () => {
      const node = { onaudioprocess: null, connect() {}, disconnect() {} };
      nodes.push(node);
      return node;
    }
  };
  return { context, nodes };
}

console.log('\n--- 4. Main-thread sampler ---');
{
  const Processor = await loadWorkletProcessor();
  const sampler = await import('../src/audio/stereo-sampler.js');
  const source = { connect() {} };

  const { context, nodes } = stubContext({ workletAvailable: true });
  const mode = await sampler.initStereoSampler(context, source, source);
  const node = nodes[0];
  check('Worklet mode offers the PPM feed', mode === 'worklet' && sampler.hasPpmFeed(), mode);
  const handed = node.options.processorOptions.ppmBallistics;
  check('The sampler hands the Type I and Type IIa ballistics of ppm.js to the worklet',
    handed.nordic === NORDIC_PPM_BALLISTICS && handed.bbc === BBC_PPM_BALLISTICS);

  globalThis.sampleRate = 48000;
  const processor = new Processor({ processorOptions: node.options.processorOptions });
  processor.port.postMessage = (message) => node.port.onmessage({ data: message });
  node.port.postMessage = (message) => processor.port.onmessage({ data: message });

  // A UI that consumes once per 800 samples (60 fps) sees the largest
  // reading of each frame; one that stalls for a second loses nothing
  const signal = toneThenSilence(48000, 1, 3);
  const reference = new QuasiPeakDetector({ sampleRate: 48000 });
  const truth = reference.process(signal);
  let largestConsumed = -Infinity;
  let consumedSamples = 0;
  for (let start = 0; start < signal.length; start += 128) {
    processor.process([[signal.subarray(start, start + 128), signal.subarray(start, start + 128)]]);
    const stalled = start > 24000 && start < 72000;
    if (!stalled && start % 768 === 0) {
      const feed = sampler.consumePpm();
      consumedSamples += feed.samples;
      largestConsumed = Math.max(largestConsumed, feed.nordicLeft);
    }
  }
  const rest = sampler.consumePpm();
  consumedSamples += rest.samples + processor._ppmSamples;
  check('Across a 1 s UI stall the largest consumed reading equals a single pass', largestConsumed === truth,
    `${largestConsumed.toFixed(3)} dBFS`);
  check('Every sample is consumed exactly once', consumedSamples === signal.length && sampler.getSamplerStats().ppmSamples === signal.length - processor._ppmSamples,
    `${consumedSamples} of ${signal.length}`);

  const empty = sampler.consumePpm();
  check('Nothing new reads −∞ with zero samples', empty.samples === 0 && empty.nordicLeft === -Infinity);

  // Reset: the worklet detectors start again; reports already in flight are dropped
  render(processor, toneThenSilence(48000, 0.2, 0.2));
  sampler.resetPpm();
  node.port.onmessage({ data: { type: 'ppm', nordicLeft: 0, nordicRight: 0, bbcLeft: 0, bbcRight: 0, samples: 480, generation: -1 } });
  const afterStale = sampler.consumePpm();
  check('A report from before the latest reset is discarded', afterStale.samples === 0);
  render(processor, new Float32Array(512));
  const fresh = sampler.consumePpm();
  check('After a reset the worklet reports from its initial state', fresh.samples === 512 && fresh.nordicLeft < -60 && fresh.bbcRight < -60,
    `${fresh.samples} samples, ${fresh.nordicLeft.toFixed(2)} dBFS`);
  sampler.disposeStereoSampler();
  check('Dispose withdraws the PPM feed', !sampler.hasPpmFeed());

  // ScriptProcessor fallback: the same arithmetic on the main thread
  const fallback = stubContext({ workletAvailable: false });
  const fallbackMode = await sampler.initStereoSampler(fallback.context, source, source, { bufferSize: 1024 });
  const scriptNode = fallback.nodes.find((candidate) => 'onaudioprocess' in candidate);
  check('ScriptProcessor mode offers the PPM feed', fallbackMode === 'scriptprocessor' && sampler.hasPpmFeed(), fallbackMode);
  const tone = programme(48000, 1, 9);
  const bbcReference = new QuasiPeakDetector({ sampleRate: 48000, ballistics: BBC_PPM_BALLISTICS });
  let blocksMatch = true;
  for (let index = 0; index * 1024 < tone.length; index++) {
    const data = tone.subarray(index * 1024, (index + 1) * 1024);
    scriptNode.onaudioprocess({ playbackTime: (index * 1024) / 48000, inputBuffer: { getChannelData: () => data } });
    const feed = sampler.consumePpm();
    if (feed.bbcLeft !== bbcReference.process(data)) blocksMatch = false;
  }
  check('ScriptProcessor readings identical to QuasiPeakDetector block by block', blocksMatch);
  sampler.disposeStereoSampler();
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. PPMMeter.updateFromReadings
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- 5. PPMMeter.updateFromReadings() ---');
{
  const meter = new PPMMeter({ sampleRate: 48000 });
  meter.updateFromReadings(2.5, -18);
  let state = meter.getState();
  check('Readings above full scale clamp to 0 dBFS (+18 PPM)', state.dbfsLeft === 0 && state.ppmScaleLeft === 18);
  check('A −18 dBFS reading is 0 PPM', state.dbfsRight === -18 && state.ppmScaleRight === 0);
  check('Peak hold follows the clamped reading', state.dbfsHoldLeft === 0 && state.dbfsHoldRight === -18);

  meter.updateFromReadings(-75, NaN);
  state = meter.getState();
  check('Readings below the scale clamp and read as silent', state.dbfsLeft === -58 && state.isSilentLeft);
  check('A non-finite reading leaves the channel as it was', state.dbfsRight === -18);
  check('The hold keeps the earlier maximum', state.dbfsHoldLeft === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE DEFECT: A ROLLING WINDOW FED EVERY FRAME
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- 6. Rolling analyser windows against the sample-complete feed ---');
{
  // 60 fps at 48 kHz: every 800 samples the meter receives the latest 4096
  const sampleRate = 48000;
  const signal = toneThenSilence(sampleRate, 1, 3.5);
  const windowed = new PPMMeter({ sampleRate });
  const fed = new QuasiPeakDetector({ sampleRate });
  const windowedReadings = [];
  const fedReadings = [];
  for (let end = 4096; end <= signal.length; end += 800) {
    windowed.update(signal.subarray(end - 4096, end), signal.subarray(end - 4096, end));
    windowedReadings.push(windowed.getState().dbfsLeft);
    fedReadings.push(fed.process(signal.subarray(end - 800, end)));
  }
  const framesPerSecond = sampleRate / 800;
  const fromDb = -2;
  const windowedTime = fallTime(windowedReadings.slice(55), framesPerSecond, fromDb, fromDb - 20);
  const fedTime = fallTime(fedReadings.slice(55), framesPerSecond, fromDb, fromDb - 20);
  check('Sample-complete feed at 60 fps: 20 dB in 1.7 s ±0.3 s', Math.abs(fedTime - 1.7) <= 0.3, `${fedTime.toFixed(2)} s`);
  info(`the rolling 4096-sample window, fed every frame, fell 20 dB in ${windowedTime.toFixed(2)} s`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. RETURN TO A LOWER STEADY LEVEL
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- 7. Return to a lower steady level ---');
{
  const sampleRate = 48000;

  /** 1 kHz tone at each level in turn, for the given seconds. */
  const steps = (...segments) => {
    const total = segments.reduce((sum, [, seconds]) => sum + Math.round(sampleRate * seconds), 0);
    const signal = new Float32Array(total);
    let i = 0;
    for (const [db, seconds] of segments) {
      const amplitude = 10 ** (db / 20);
      for (const end = i + Math.round(sampleRate * seconds); i < end; i++) {
        signal[i] = amplitude * Math.sin(2 * Math.PI * 1000 * i / sampleRate);
      }
    }
    return signal;
  };

  /** Readings every millisecond. */
  const readEveryMs = (detector, signal) => {
    const readings = [];
    for (let start = 0; start < signal.length; start += sampleRate / 1000) {
      detector.process(signal.subarray(start, start + sampleRate / 1000));
      readings.push(detector.reading);
    }
    return readings;
  };

  for (const [label, ballistics, rate] of [
    ['Type I', NORDIC_PPM_BALLISTICS, 20 / 1.7],
    ['Type IIa', BBC_PPM_BALLISTICS, 24 / 2.8]
  ]) {
    // A 5 dB drop, inside the 6 dB margin the detectors once held within
    const readings = readEveryMs(new QuasiPeakDetector({ sampleRate, ballistics }), steps([-12, 1], [-17, 2]));
    const atDrop = 1000;
    const after200 = readings[atDrop + 200];
    const expected200 = -12 - rate * 0.195; // the 5 ms window still holds the old crest
    check(`${label}: 200 ms after a 5 dB drop the reading is returning at its rate`,
      Math.abs(after200 - expected200) <= 0.2, `${after200.toFixed(2)} dBFS, expected ${expected200.toFixed(2)}`);
    const settled = readings.at(-1);
    check(`${label}: the reading settles at the new level`, Math.abs(settled + 17) <= 0.05,
      `${settled.toFixed(3)} dBFS after 2 s at −17 dBFS`);
  }

  // The verification tool's case: leftover louder signal, then TEST level
  const transient = readEveryMs(new QuasiPeakDetector({ sampleRate }), steps([-12.7, 0.1], [-18, 1.5]));
  const afterSettle = transient[100 + 1000];
  check('A reading pushed up by a transient is back at TEST level within the 1 s settle',
    Math.abs(afterSettle + 18) <= 0.05, `${afterSettle.toFixed(3)} dBFS`);

  // The floor at the window peak keeps steady tones free of ripple
  const steady = readEveryMs(new QuasiPeakDetector({ sampleRate }), steps([-18, 2])).slice(500);
  check('A steady 1 kHz tone reads its level without ripple',
    Math.min(...steady) >= -18.02 && Math.max(...steady) <= -17.98,
    `${Math.min(...steady).toFixed(3)} to ${Math.max(...steady).toFixed(3)} dBFS`);

  const lowTone = new Float32Array(sampleRate * 2);
  for (let i = 0; i < lowTone.length; i++) lowTone[i] = 10 ** (-18 / 20) * Math.sin(2 * Math.PI * 40 * i / sampleRate);
  const low = readEveryMs(new QuasiPeakDetector({ sampleRate }), lowTone).slice(500);
  check('A 40 Hz tone ripples by less than 0.15 dB between crests',
    Math.max(...low) - Math.min(...low) < 0.15 && Math.abs(Math.max(...low) + 18) <= 0.02,
    `${Math.min(...low).toFixed(3)} to ${Math.max(...low).toFixed(3)} dBFS`);

  // The reference function behaves the same
  const state = {};
  calculateQuasiPeakRC(steps([-12, 1]), sampleRate, state);
  calculateQuasiPeakRC(steps([-17, 1]), sampleRate, state);
  check('calculateQuasiPeakRC() also returns to the lower level', Math.abs(state.peakDb + 17) <= 0.05,
    `${state.peakDb.toFixed(3)} dBFS`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(50));
console.log(`Results: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
console.log('═'.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
