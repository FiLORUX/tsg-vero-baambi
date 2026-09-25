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
 *
 * @module tests/sample-peak-test
 * ═══════════════════════════════════════════════════════════════════════════════
 */

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
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(50));
console.log(`Results: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
console.log('═'.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
