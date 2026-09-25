/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * VERO-BAAMBI Sample Peak Test
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Run: node tests/sample-peak-test.js
 *
 * Sample peak is the largest absolute sample value (IEC 60268-18, AES17). A
 * peak one sample long must reach the meter however the samples are
 * delivered, so the stereo sampler measures every sample and hands over the
 * maxima since the previous read. These tests check that feed:
 *
 *   1. The stereo-sampler AudioWorklet reports the largest sample of every
 *      interval, every sample once, about every 10 ms, silent quanta included.
 *   2. The main-thread sampler accumulates reports until they are consumed,
 *      across a UI that stalls, and measures each ScriptProcessor block.
 *   3. SamplePeakMeter: instant attack, 20 dB in 1.7 s return on its own
 *      clock, 3 s hold, and hold, maximum and clip from the unsmoothed peak,
 *      so the same signal reads the same at 30, 60 and 180 updates per
 *      second.
 *
 * @module tests/sample-peak-test
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { SamplePeakMeter, SP_RELEASE_DB_PER_SECOND } from '../src/metering/sample-peak.js';

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

/** Noise at −30 dBFS with isolated single-sample spikes. */
function noiseWithSpikes(sampleRate, seconds, seed, spikes) {
  const next = random(seed);
  const signal = new Float32Array(Math.round(sampleRate * seconds));
  for (let i = 0; i < signal.length; i++) signal[i] = 0.0316 * (next() * 2 - 1);
  for (const [position, value] of spikes) signal[position] = value;
  return signal;
}

function info(text) {
  console.log(`\x1b[2m       ${text}\x1b[0m`);
}

function peakOf(block) {
  let peak = 0;
  for (let i = 0; i < block.length; i++) peak = Math.max(peak, Math.abs(block[i]));
  return peak;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. AUDIOWORKLET PROCESSOR
// ─────────────────────────────────────────────────────────────────────────────

let WorkletProcessor = null;

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

function render(processor, left, right = left) {
  for (let start = 0; start < left.length; start += 128) {
    processor.process([[left.subarray(start, start + 128), right.subarray(start, start + 128)]]);
  }
}

console.log('\n--- 1. Stereo-sampler worklet ---');
{
  const Processor = await loadWorkletProcessor();

  for (const sampleRate of [48000, 96000]) {
    globalThis.sampleRate = sampleRate;
    const spikes = [[1234, 0.9], [sampleRate + 17, -1], [2 * sampleRate - 1, 0.5]];
    const left = noiseWithSpikes(sampleRate, 2, 11, spikes);
    const right = noiseWithSpikes(sampleRate, 2, 12, [[777, -0.7]]);
    const processor = new Processor({ processorOptions: { bufferSize: 4096 } });
    const reports = [];
    processor.port.postMessage = (message) => { if (message.type === 'samplePeak') reports.push(message); };
    render(processor, left, right);

    let reported = 0;
    let identical = true;
    for (const report of reports) {
      if (report.left !== peakOf(left.subarray(reported, reported + report.samples))
        || report.right !== peakOf(right.subarray(reported, reported + report.samples))) {
        identical = false;
      }
      reported += report.samples;
    }
    const pending = processor._samplePeakSamples;
    const secondsPerReport = reported / reports.length / sampleRate;
    check(`${sampleRate / 1000} kHz: every report carries the largest sample of its interval`, identical,
      `${reports.length} reports, spikes of one sample included`);
    check(`${sampleRate / 1000} kHz: every sample reported once, about every 10 ms`,
      reported + pending === left.length && secondsPerReport > 0.009 && secondsPerReport < 0.012,
      `${reported} + ${pending} pending, ${(secondsPerReport * 1000).toFixed(1)} ms per report`);
  }

  globalThis.sampleRate = 48000;
  const idle = new Processor({ processorOptions: { bufferSize: 4096 } });
  const idleReports = [];
  idle.port.postMessage = (message) => { if (message.type === 'samplePeak') idleReports.push(message); };
  for (let quantum = 0; quantum < 40; quantum++) idle.process([[]]);
  check('Quanta without input channels are measured as silence',
    idleReports.length > 0 && idleReports.every((report) => report.left === 0 && report.right === 0)
      && idleReports.reduce((sum, report) => sum + report.samples, 0) + idle._samplePeakSamples === 40 * 128);

  const broken = new Processor({ processorOptions: { bufferSize: 4096 } });
  let brokenPeak = null;
  broken.port.postMessage = (message) => { if (message.type === 'samplePeak') brokenPeak ??= message.left; };
  const withNaN = new Float32Array(512).fill(0.25);
  withNaN[100] = NaN;
  render(broken, withNaN);
  check('A NaN sample is ignored', brokenPeak === 0.25, `${brokenPeak}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. MAIN-THREAD SAMPLER
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

console.log('\n--- 2. Main-thread sampler ---');
{
  const Processor = await loadWorkletProcessor();
  const sampler = await import('../src/audio/stereo-sampler.js');
  const source = { connect() {} };

  const { context, nodes } = stubContext({ workletAvailable: true });
  const mode = await sampler.initStereoSampler(context, source, source);
  const node = nodes[0];
  check('Worklet mode offers the sample-peak feed', mode === 'worklet' && sampler.hasSamplePeakFeed(), mode);

  globalThis.sampleRate = 48000;
  const processor = new Processor({ processorOptions: node.options.processorOptions });
  processor.port.postMessage = (message) => node.port.onmessage({ data: message });

  // A 10 Hz consumer (the probe's transmission rate) that stalls for 1 s
  // while a single full-scale sample passes
  const signal = noiseWithSpikes(48000, 3, 21, [[60000, -1]]);
  let largest = 0;
  let consumed = 0;
  for (let start = 0; start < signal.length; start += 128) {
    processor.process([[signal.subarray(start, start + 128), signal.subarray(start, start + 128)]]);
    const stalled = start > 48000 && start < 96000;
    if (!stalled && start % 4800 === 0) {
      const feed = sampler.consumeSamplePeaks();
      largest = Math.max(largest, feed.left);
      consumed += feed.samples;
    }
  }
  const rest = sampler.consumeSamplePeaks();
  consumed += rest.samples + processor._samplePeakSamples;
  largest = Math.max(largest, rest.left);
  check('A single full-scale sample during a 1 s stall reaches the consumer', largest === 1, `${largest}`);
  check('Every sample is consumed exactly once', consumed === signal.length
    && sampler.getSamplerStats().samplePeakSamples === signal.length - processor._samplePeakSamples,
  `${consumed} of ${signal.length}`);
  const empty = sampler.consumeSamplePeaks();
  check('Nothing new reads zero with zero samples', empty.samples === 0 && empty.left === 0);
  sampler.disposeStereoSampler();
  check('Dispose withdraws the sample-peak feed', !sampler.hasSamplePeakFeed());

  const fallback = stubContext({ workletAvailable: false });
  const fallbackMode = await sampler.initStereoSampler(fallback.context, source, source, { bufferSize: 1024 });
  const scriptNode = fallback.nodes.find((candidate) => 'onaudioprocess' in candidate);
  check('ScriptProcessor mode offers the sample-peak feed', fallbackMode === 'scriptprocessor' && sampler.hasSamplePeakFeed(), fallbackMode);
  let blocksMatch = true;
  for (let index = 0; index * 1024 < signal.length; index++) {
    const data = signal.subarray(index * 1024, (index + 1) * 1024);
    scriptNode.onaudioprocess({ playbackTime: (index * 1024) / 48000, inputBuffer: { getChannelData: () => data } });
    const feed = sampler.consumeSamplePeaks();
    if (feed.left !== peakOf(data) || feed.samples !== data.length) blocksMatch = false;
  }
  check('ScriptProcessor blocks measured sample by sample', blocksMatch);
  sampler.disposeStereoSampler();
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. METER BALLISTICS
// ─────────────────────────────────────────────────────────────────────────────

/** Manual millisecond clock for a meter. */
function manualClock() {
  let ms = 0;
  return { now: () => ms, advance: (delta) => { ms += delta; } };
}

console.log('\n--- 3. SamplePeakMeter ballistics ---');
{
  // A single full-scale sample, then silence at 60 updates per second
  const clock = manualClock();
  const meter = new SamplePeakMeter({ now: clock.now });
  meter.updateFromPeaks(1, 0);
  let state = meter.getState();
  const fullScale = (db) => Math.abs(db) < 1e-9;
  check('A single full-scale sample reads 0 dBFS at once',
    fullScale(state.dbfsLeft) && fullScale(state.dbfsHoldLeft) && fullScale(state.dbfsMax),
    `bar ${state.dbfsLeft.toFixed(3)}, hold ${state.dbfsHoldLeft.toFixed(3)}, max ${state.dbfsMax.toFixed(3)} dBFS`);
  check('…and trips the clip indicator of its channel only', state.isClipLeft && !state.isClipRight);

  let fallTime = null;
  let holdAtTwoSeconds = null;
  let barAtExpiry = null;
  let holdAfterExpiry = null;
  for (let frame = 1; frame <= 60 * 4; frame++) {
    clock.advance(1000 / 60);
    meter.updateFromPeaks(0, 0);
    state = meter.getState();
    const seconds = frame / 60;
    if (fallTime === null && state.dbfsLeft <= -20) fallTime = seconds;
    if (frame === 120) holdAtTwoSeconds = state.dbfsHoldLeft;
    if (barAtExpiry === null && state.dbfsHoldLeft < -1) barAtExpiry = state.dbfsLeft;
    if (frame === 60 * 3.5) holdAfterExpiry = { hold: state.dbfsHoldLeft, bar: state.dbfsLeft };
  }
  check('The bar falls 20 dB in 1.7 s', Math.abs(fallTime - 1.7) <= 2 / 60, `${fallTime.toFixed(3)} s`);
  check('The hold keeps 0 dBFS for 3 s', fullScale(holdAtTwoSeconds), `${holdAtTwoSeconds.toFixed(3)} dBFS at 2 s`);
  check('After the hold time the hold drops to the bar and holds that reading',
    holdAfterExpiry.hold === barAtExpiry && holdAfterExpiry.bar < holdAfterExpiry.hold,
    `hold ${holdAfterExpiry.hold.toFixed(2)}, bar ${holdAfterExpiry.bar.toFixed(2)} dBFS at 3.5 s`);
  check('The clip indicator stays latched', meter.getState().isClipLeft);

  meter.reset();
  state = meter.getState();
  check('reset() clears clip and maximum; the hold starts from the bar',
    !state.isClipAny && state.dbfsMax === -Infinity && state.dbfsHoldLeft === state.dbfsLeft);
}

{
  // The same programme through consumers at 30, 60 and 180 updates per
  // second, each given the largest samples since its previous update
  const sampleRate = 48000;
  const signal = noiseWithSpikes(sampleRate, 6, 31, [[30000, 1], [100000, -0.5], [180000, 0.25]]);
  for (let i = 150000; i < 152400; i++) signal[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);

  const readings = new Map();
  for (const rate of [30, 60, 180]) {
    const clock = manualClock();
    const meter = new SamplePeakMeter({ now: clock.now });
    const atCommonFrames = [];
    let previous = 0;
    for (let frame = 1; frame <= 6 * rate; frame++) {
      const end = Math.round((frame * sampleRate) / rate);
      clock.advance(1000 / rate);
      meter.updateFromPeaks(peakOf(signal.subarray(previous, end)), 0);
      previous = end;
      if (frame % (rate / 30) === 0) atCommonFrames.push(meter.getState());
    }
    readings.set(rate, atCommonFrames);
  }

  const reference = readings.get(180);
  let largestBarDifference = 0;
  let sameMaxAndClip = true;
  for (const rate of [30, 60]) {
    for (const [index, state] of readings.get(rate).entries()) {
      largestBarDifference = Math.max(largestBarDifference, Math.abs(state.dbfsLeft - reference[index].dbfsLeft));
      if (state.dbfsMax !== reference[index].dbfsMax || state.isClipLeft !== reference[index].isClipLeft) sameMaxAndClip = false;
    }
  }
  const bound = SP_RELEASE_DB_PER_SECOND / 30;
  check('Bar at 30 and 60 updates/s within one 30 fps frame of release of 180 updates/s',
    largestBarDifference <= bound + 1e-9, `largest difference ${largestBarDifference.toFixed(3)} dB (bound ${bound.toFixed(3)} dB)`);
  check('Maximum and clip identical at 30, 60 and 180 updates/s', sameMaxAndClip);

  // For comparison: the former meter smoothed each reading by a quarter of
  // the distance per update, over analyser windows of the latest 4096 samples
  const formerReading = (rate) => {
    let smooth = -60;
    let largest = -Infinity;
    for (let frame = 1; frame <= 6 * rate; frame++) {
      const end = Math.round((frame * sampleRate) / rate);
      const raw = 20 * Math.log10(peakOf(signal.subarray(Math.max(0, end - 4096), end)) + 1e-12);
      smooth += 0.25 * (raw - smooth);
      if (end > 30000 && end < 60000) largest = Math.max(largest, smooth);
    }
    return largest;
  };
  info(`the former smoothing read the full-scale sample as ${formerReading(30).toFixed(1)} dBFS at 30 fps and ${formerReading(180).toFixed(1)} dBFS at 180 fps`);
}

{
  const clock = manualClock();
  const meter = new SamplePeakMeter({ now: clock.now });
  meter.updateFromPeaks(Infinity, NaN);
  const state = meter.getState();
  check('An infinite peak reads as a +60 dBFS over and trips the clip indicator',
    state.dbfsLeft === 20 * Math.log10(1000 + 1e-12) && state.isClipLeft);
  check('A NaN peak reads as silence', state.dbfsRight === -60 && !state.isClipRight);
  clock.advance(100);
  meter.update(new Float32Array(0), new Float32Array(0));
  check('Empty buffers read as silence: the bar only falls',
    meter.getState().dbfsLeft < state.dbfsLeft && meter.getState().dbfsRight === -60);
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(50));
console.log(`Results: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
console.log('═'.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
