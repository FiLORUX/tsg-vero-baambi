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
 * STEREO SAMPLER - DUAL-MODE L/R BUFFER SYNCHRONISATION
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Provides sample-accurate L/R buffer capture with automatic fallback:
 *
 *   Primary:  AudioWorklet (100% accurate, atomic sampling in audio thread)
 *   Fallback: ScriptProcessorNode (atomic sampling, deprecated but functional)
 *
 * AudioWorklet is attempted first regardless of protocol. If it fails (e.g.
 * insecure context without --allow-file-access-from-files), ScriptProcessorNode
 * is used as fallback.
 *
 * Both modes provide guaranteed L/R synchronisation from the same audio block.
 *
 * Both modes also measure every sample: the ITU-R BS.1770-4 true peak
 * (consumeTruePeaks), the IEC 60268-10 quasi-peak readings of the Nordic
 * Type I and BBC Type IIa detectors (consumePpm) and the sample peak
 * (consumeSamplePeaks). The display buffers are
 * rolling windows that overlap from one frame to the next; a detector that
 * advances sample by sample must not be fed from them.
 *
 * @see docs/STEREO-SAMPLING-ARCHITECTURE.md
 * @module audio/stereo-sampler
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { TruePeakDetector, interpolationBranches } from '../metering/true-peak.js';
import { QuasiPeakDetector, NORDIC_PPM_BALLISTICS, BBC_PPM_BALLISTICS } from '../metering/ppm.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default buffer size in samples.
 *
 * Trade-offs at 48kHz sample rate:
 *   4096 samples = 85ms trace history, 42ms update interval (default)
 *   2048 samples = 42ms trace history, 21ms update interval (lower latency)
 *   1024 samples = 21ms trace history, 10ms update interval (minimum recommended)
 *
 * Smaller buffers reduce latency but show less goniometer trace history.
 * @type {number}
 */
const DEFAULT_BUFFER_SIZE = 4096;

// ─────────────────────────────────────────────────────────────────────────────
// SAMPLER STATE
// ─────────────────────────────────────────────────────────────────────────────

/** @type {number} Largest true peak (linear) per channel since the last consumeTruePeaks() */
let pendingPeakL = 0;
let pendingPeakR = 0;

/** @type {number} Samples measured since the last consumeTruePeaks() */
let pendingPeakSamples = 0;

/** @type {number} Samples measured since initialisation (coverage diagnostics) */
let totalPeakSamples = 0;

/** @type {number} Reset generation; worklet reports from an earlier generation are dropped */
let peakGeneration = 0;

/** @type {Float64Array} Largest readings since the last consumePpm(): Type I L, R, Type IIa L, R (dBFS) */
const pendingPpm = new Float64Array(4).fill(-Infinity);

/** @type {number} Samples measured since the last consumePpm() */
let pendingPpmSamples = 0;

/** @type {number} Samples run through the PPM detectors since initialisation */
let totalPpmSamples = 0;

/** @type {number} PPM reset generation; worklet reports from an earlier generation are dropped */
let ppmGeneration = 0;

/** @type {number} Largest sample magnitude (linear) per channel since the last consumeSamplePeaks() */
let pendingSampleL = 0;
let pendingSampleR = 0;

/** @type {number} Samples measured since the last consumeSamplePeaks() */
let pendingSampleSamples = 0;

/** @type {number} Samples measured for sample peak since initialisation */
let totalSampleSamples = 0;

/** @type {QuasiPeakDetector[]|null} Main-thread PPM detectors in ScriptProcessor mode */
let ppmDetectors = null;

/** @type {'worklet'|'scriptprocessor'|null} Current sampling mode */
let samplingMode = null;

/** @type {AudioWorkletNode|null} AudioWorklet sampler node */
let workletNode = null;

/** @type {ScriptProcessorNode|null} ScriptProcessor sampler node (fallback) */
let scriptProcessorNode = null;

/** @type {number} Current buffer size */
let currentBufferSize = DEFAULT_BUFFER_SIZE;

/** @type {Float32Array} Buffer for left channel */
let syncedBufL = new Float32Array(DEFAULT_BUFFER_SIZE);

/** @type {Float32Array} Buffer for right channel */
let syncedBufR = new Float32Array(DEFAULT_BUFFER_SIZE);

/** @type {number} Timestamp of last update */
let lastTimestamp = 0;

/** @type {boolean} Whether fresh data is available */
let dataReady = false;

// ─────────────────────────────────────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialise stereo sampling with automatic fallback.
 *
 * Attempts AudioWorklet first (preferred), falls back to ScriptProcessorNode
 * if AudioWorklet is unavailable (e.g. insecure context).
 *
 * @param {AudioContext} audioContext - Web Audio context
 * @param {AudioNode} sourceL - Left channel source node
 * @param {AudioNode} sourceR - Right channel source node
 * @param {Object} [options] - Configuration options
 * @param {number} [options.bufferSize=4096] - Buffer size in samples (power of 2, 128-8192)
 * @returns {Promise<'worklet'|'scriptprocessor'>} The selected sampling mode
 */
export async function initStereoSampler(audioContext, sourceL, sourceR, options = {}) {
  // Configure buffer size
  const bufferSize = options.bufferSize ?? DEFAULT_BUFFER_SIZE;
  currentBufferSize = bufferSize;

  // Reallocate buffers if size changed
  if (syncedBufL.length !== bufferSize) {
    syncedBufL = new Float32Array(bufferSize);
    syncedBufR = new Float32Array(bufferSize);
  }

  // Try AudioWorklet first (runs in audio thread, lower latency)
  try {
    await initAudioWorkletSampler(audioContext, sourceL, sourceR, bufferSize);
    samplingMode = 'worklet';
    console.log(`[StereoSampler] Using AudioWorklet mode (buffer: ${bufferSize} samples)`);
    return 'worklet';
  } catch (e) {
    console.warn('[StereoSampler] AudioWorklet failed, using fallback:', e.message);
  }

  // Fallback to ScriptProcessorNode (deprecated but functional)
  try {
    initScriptProcessorSampler(audioContext, sourceL, sourceR, bufferSize);
    samplingMode = 'scriptprocessor';
    console.log(`[StereoSampler] Using ScriptProcessorNode mode (buffer: ${bufferSize} samples)`);
    return 'scriptprocessor';
  } catch (e) {
    console.error('[StereoSampler] ScriptProcessorNode failed:', e.message);
    throw e;
  }
}

/**
 * Initialise AudioWorklet-based sampler.
 *
 * @param {AudioContext} audioContext - Web Audio context
 * @param {AudioNode} sourceL - Left channel source node
 * @param {AudioNode} sourceR - Right channel source node
 * @param {number} bufferSize - Buffer size in samples
 * @private
 */
async function initAudioWorkletSampler(audioContext, sourceL, sourceR, bufferSize) {
  // Load worklet module relative to this file, independent of the page URL
  await audioContext.audioWorklet.addModule(new URL('./stereo-sampler-worklet.js', import.meta.url));

  // Create merger to combine L/R into stereo for worklet
  const merger = audioContext.createChannelMerger(2);
  sourceL.connect(merger, 0, 0);
  sourceR.connect(merger, 0, 1);

  // Create worklet node with configurable buffer size
  workletNode = new AudioWorkletNode(audioContext, 'stereo-sampler', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 2,
    channelCountMode: 'explicit',
    processorOptions: {
      bufferSize,
      // Annex 2 branches for this context's rate; the worklet measures every sample
      truePeakBranches: interpolationBranches(audioContext.sampleRate),
      // IEC 60268-10 ballistics for the worklet's Type I and Type IIa detectors
      ppmBallistics: { nordic: NORDIC_PPM_BALLISTICS, bbc: BBC_PPM_BALLISTICS }
    }
  });

  // Connect merged stereo to worklet
  merger.connect(workletNode);

  // Handle messages from worklet
  workletNode.port.onmessage = (event) => {
    const data = event.data;
    if (data.type === 'truePeak') {
      // Reports measured before the latest reset were already in flight
      if (data.generation === peakGeneration) {
        accumulateTruePeak(data.left, data.right, data.samples);
      }
    } else if (data.type === 'samplePeak') {
      accumulateSamplePeak(data.left, data.right, data.samples);
    } else if (data.type === 'ppm') {
      if (data.generation === ppmGeneration) {
        accumulatePpm(data.nordicLeft, data.nordicRight, data.bbcLeft, data.bbcRight, data.samples);
      }
    } else if (data.type === 'snapshot') {
      syncedBufL = data.bufL;
      syncedBufR = data.bufR;
      lastTimestamp = data.timestamp;
      dataReady = true;
    }
  };
}

/**
 * Initialise ScriptProcessorNode-based sampler.
 * Used as fallback when AudioWorklet is unavailable.
 *
 * ScriptProcessorNode is deprecated but provides atomic L/R buffer access
 * via inputBuffer.getChannelData() - both channels are guaranteed to be
 * from the same audio processing block.
 *
 * @param {AudioContext} audioContext - Web Audio context
 * @param {AudioNode} sourceL - Left channel source node
 * @param {AudioNode} sourceR - Right channel source node
 * @param {number} bufferSize - Buffer size in samples (must be power of 2: 256-16384)
 * @private
 */
function initScriptProcessorSampler(audioContext, sourceL, sourceR, bufferSize) {
  // Clamp buffer size to ScriptProcessor valid range (256-16384, power of 2)
  const validSize = Math.max(256, Math.min(16384, bufferSize));
  // 2 input channels, 2 output channels (must have outputs to be connectable)
  scriptProcessorNode = audioContext.createScriptProcessor(validSize, 2, 2);

  // Create merger to combine L/R into stereo
  const merger = audioContext.createChannelMerger(2);
  sourceL.connect(merger, 0, 0);
  sourceR.connect(merger, 0, 1);

  // Connect merged stereo to script processor
  merger.connect(scriptProcessorNode);

  // Connect to destination to keep the node alive (required for browsers)
  // Using a silent gain node to avoid audio output
  const silentGain = audioContext.createGain();
  silentGain.gain.value = 0;
  scriptProcessorNode.connect(silentGain);
  silentGain.connect(audioContext.destination);

  // True peak of every sample. onaudioprocess delivers consecutive blocks
  // while the main thread keeps up; a block it misses is detected from
  // playbackTime and the filter history is cleared, so two unrelated blocks
  // are never joined and read as a peak. Samples in a missed block are not
  // measured, which is why the AudioWorklet is preferred.
  const detectorL = new TruePeakDetector(audioContext.sampleRate);
  const detectorR = new TruePeakDetector(audioContext.sampleRate);
  const halfSample = 0.5 / audioContext.sampleRate;
  let expectedPlaybackTime = null;

  // Quasi-peak readings of every delivered sample. A missed block is not
  // measured: the detectors carry on from their state, which a max-based
  // window and an RC envelope do without a false reading.
  const sampleRate = audioContext.sampleRate;
  ppmDetectors = [
    new QuasiPeakDetector({ sampleRate, ballistics: NORDIC_PPM_BALLISTICS }),
    new QuasiPeakDetector({ sampleRate, ballistics: NORDIC_PPM_BALLISTICS }),
    new QuasiPeakDetector({ sampleRate, ballistics: BBC_PPM_BALLISTICS }),
    new QuasiPeakDetector({ sampleRate, ballistics: BBC_PPM_BALLISTICS })
  ];

  // Process audio - L/R are GUARANTEED from same audio block
  scriptProcessorNode.onaudioprocess = (event) => {
    const inputL = event.inputBuffer.getChannelData(0);
    const inputR = event.inputBuffer.getChannelData(1);

    if (expectedPlaybackTime !== null && Math.abs(event.playbackTime - expectedPlaybackTime) > halfSample) {
      detectorL.reset();
      detectorR.reset();
    }
    expectedPlaybackTime = event.playbackTime + inputL.length / audioContext.sampleRate;
    accumulateTruePeak(detectorL.process(inputL), detectorR.process(inputR), inputL.length);
    accumulatePpm(
      ppmDetectors[0].process(inputL),
      ppmDetectors[1].process(inputR),
      ppmDetectors[2].process(inputL),
      ppmDetectors[3].process(inputR),
      inputL.length
    );
    accumulateSamplePeak(blockPeak(inputL), blockPeak(inputR), inputL.length);

    // Copy to our buffers (they're the same size: 4096)
    syncedBufL.set(inputL);
    syncedBufR.set(inputR);
    lastTimestamp = performance.now();
    dataReady = true;
  };
}

/**
 * Fold one true-peak report into the pending maxima.
 *
 * @param {number} left - Left channel peak, linear
 * @param {number} right - Right channel peak, linear
 * @param {number} samples - Samples covered by the report
 * @private
 */
function accumulateTruePeak(left, right, samples) {
  if (left > pendingPeakL) pendingPeakL = left;
  if (right > pendingPeakR) pendingPeakR = right;
  pendingPeakSamples += samples;
  totalPeakSamples += samples;
}

/**
 * Largest absolute sample value of a block.
 *
 * @param {Float32Array} block - Channel samples
 * @returns {number} Linear peak; NaN samples are ignored
 * @private
 */
function blockPeak(block) {
  let peak = 0;
  for (let i = 0; i < block.length; i++) {
    const abs = Math.abs(block[i]);
    if (abs > peak) peak = abs;
  }
  return peak;
}

/**
 * Fold one sample-peak report into the pending maxima.
 *
 * @param {number} left - Left channel peak, linear
 * @param {number} right - Right channel peak, linear
 * @param {number} samples - Samples covered by the report
 * @private
 */
function accumulateSamplePeak(left, right, samples) {
  if (left > pendingSampleL) pendingSampleL = left;
  if (right > pendingSampleR) pendingSampleR = right;
  pendingSampleSamples += samples;
  totalSampleSamples += samples;
}

/**
 * Fold one PPM report into the pending readings.
 *
 * @param {number} nordicLeft - Largest left Type I reading, dBFS
 * @param {number} nordicRight - Largest right Type I reading, dBFS
 * @param {number} bbcLeft - Largest left Type IIa reading, dBFS
 * @param {number} bbcRight - Largest right Type IIa reading, dBFS
 * @param {number} samples - Samples covered by the report
 * @private
 */
function accumulatePpm(nordicLeft, nordicRight, bbcLeft, bbcRight, samples) {
  if (nordicLeft > pendingPpm[0]) pendingPpm[0] = nordicLeft;
  if (nordicRight > pendingPpm[1]) pendingPpm[1] = nordicRight;
  if (bbcLeft > pendingPpm[2]) pendingPpm[2] = bbcLeft;
  if (bbcRight > pendingPpm[3]) pendingPpm[3] = bbcRight;
  pendingPpmSamples += samples;
  totalPpmSamples += samples;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether the sampler measures true peak on every sample.
 *
 * True in AudioWorklet and ScriptProcessor mode. When false, a caller must
 * fall back to measuring analyser windows.
 *
 * @returns {boolean}
 */
export function hasTruePeakFeed() {
  return samplingMode === 'worklet' || samplingMode === 'scriptprocessor';
}

/**
 * Discard the true-peak maxima measured so far, including reports already on
 * their way from the AudioWorklet, so a new measurement starts at this call.
 */
export function resetTruePeaks() {
  peakGeneration++;
  pendingPeakL = 0;
  pendingPeakR = 0;
  pendingPeakSamples = 0;
  workletNode?.port.postMessage({ type: 'resetTruePeak', generation: peakGeneration });
}

/**
 * Take the true-peak maxima of all samples measured since the previous call.
 *
 * Reports accumulate between calls, so a consumer that runs late (dropped
 * frames, a throttled background tab) still receives the peak of every
 * sample. Zero peaks with zero samples mean nothing new has been measured.
 *
 * @returns {{left: number, right: number, samples: number}} Linear peaks and sample count
 */
export function consumeTruePeaks() {
  const result = { left: pendingPeakL, right: pendingPeakR, samples: pendingPeakSamples };
  pendingPeakL = 0;
  pendingPeakR = 0;
  pendingPeakSamples = 0;
  return result;
}

/**
 * Whether the sampler measures the sample peak of every sample.
 *
 * True in AudioWorklet and ScriptProcessor mode. When false, a caller must
 * fall back to the analyser windows, which leave gaps when they are read
 * less often than they are long.
 *
 * @returns {boolean}
 */
export function hasSamplePeakFeed() {
  return samplingMode === 'worklet' || samplingMode === 'scriptprocessor';
}

/**
 * Take the largest sample magnitudes of all samples measured since the
 * previous call.
 *
 * Reports accumulate between calls, so a consumer on any schedule (a render
 * frame, a 10 Hz network transmission, a throttled tab) receives the peak of
 * every sample once. Zero peaks with zero samples mean nothing new has been
 * measured.
 *
 * @returns {{left: number, right: number, samples: number}} Linear peaks and sample count
 */
export function consumeSamplePeaks() {
  const result = { left: pendingSampleL, right: pendingSampleR, samples: pendingSampleSamples };
  pendingSampleL = 0;
  pendingSampleR = 0;
  pendingSampleSamples = 0;
  return result;
}

/**
 * Whether the sampler runs the PPM detectors on every sample.
 *
 * True in AudioWorklet and ScriptProcessor mode. When false, a caller must
 * feed its own detectors, and only with samples they have not seen yet.
 *
 * @returns {boolean}
 */
export function hasPpmFeed() {
  return samplingMode === 'worklet' || samplingMode === 'scriptprocessor';
}

/**
 * Return the PPM detectors to their initial state and discard the readings
 * gathered so far, including reports already on their way from the
 * AudioWorklet.
 */
export function resetPpm() {
  ppmGeneration++;
  pendingPpm.fill(-Infinity);
  pendingPpmSamples = 0;
  ppmDetectors?.forEach((detector) => detector.reset());
  workletNode?.port.postMessage({ type: 'resetPpm', generation: ppmGeneration });
}

/**
 * Take the largest PPM readings of all samples measured since the previous
 * call.
 *
 * The readings are those of IEC 60268-10 detectors that see every sample
 * once, so their ballistics follow the signal whatever the frame rate. The
 * largest reading of the interval is returned, so a peak that rose and fell
 * between two calls is not lost; with zero samples the readings are −∞ and
 * nothing new has been measured.
 *
 * @returns {{nordicLeft: number, nordicRight: number, bbcLeft: number, bbcRight: number, samples: number}}
 *   Type I and Type IIa readings in dBFS, and the samples they cover
 */
export function consumePpm() {
  const result = {
    nordicLeft: pendingPpm[0],
    nordicRight: pendingPpm[1],
    bbcLeft: pendingPpm[2],
    bbcRight: pendingPpm[3],
    samples: pendingPpmSamples
  };
  pendingPpm.fill(-Infinity);
  pendingPpmSamples = 0;
  return result;
}

/**
 * Get current sampling mode.
 *
 * @returns {'worklet'|'scriptprocessor'|null} Current mode or null if not initialised
 */
export function getSamplingMode() {
  return samplingMode;
}

/**
 * Check if synchronized buffer mode is active (either AudioWorklet or ScriptProcessor).
 * When true, getWorkletBuffers() returns L/R data guaranteed from the same audio block.
 *
 * @returns {boolean} True if using synchronized sampling (worklet or scriptprocessor)
 */
export function isWorkletMode() {
  // Both worklet and scriptprocessor provide synchronized L/R buffers
  return samplingMode === 'worklet' || samplingMode === 'scriptprocessor';
}

/**
 * Get synchronized L/R buffers.
 * Valid when isWorkletMode() returns true (either AudioWorklet or ScriptProcessor).
 *
 * @returns {{bufL: Float32Array, bufR: Float32Array, ready: boolean}} Synchronized buffers
 */
export function getWorkletBuffers() {
  const ready = dataReady;
  dataReady = false; // Mark as consumed
  return {
    bufL: syncedBufL,
    bufR: syncedBufR,
    ready
  };
}

/**
 * Get sampling statistics for debugging.
 *
 * @returns {Object} Sampling statistics
 */
export function getSamplerStats() {
  return {
    mode: samplingMode,
    bufferSize: currentBufferSize,
    workletActive: workletNode !== null,
    scriptProcessorActive: scriptProcessorNode !== null,
    lastTimestamp,
    truePeakSamples: totalPeakSamples,
    ppmSamples: totalPpmSamples,
    samplePeakSamples: totalSampleSamples
  };
}

/**
 * Get current buffer size.
 *
 * @returns {number} Buffer size in samples
 */
export function getBufferSize() {
  return currentBufferSize;
}

/**
 * Dispose of sampler resources.
 */
export function disposeStereoSampler() {
  if (workletNode) {
    workletNode.port.onmessage = null;
    workletNode.disconnect();
    workletNode = null;
  }
  if (scriptProcessorNode) {
    scriptProcessorNode.onaudioprocess = null;
    scriptProcessorNode.disconnect();
    scriptProcessorNode = null;
  }
  samplingMode = null;
  dataReady = false;
  pendingPeakL = 0;
  pendingPeakR = 0;
  pendingPeakSamples = 0;
  totalPeakSamples = 0;
  pendingPpm.fill(-Infinity);
  pendingPpmSamples = 0;
  totalPpmSamples = 0;
  ppmDetectors = null;
  pendingSampleL = 0;
  pendingSampleR = 0;
  pendingSampleSamples = 0;
  totalSampleSamples = 0;
}
