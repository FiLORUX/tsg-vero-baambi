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
 * @see docs/STEREO-SAMPLING-ARCHITECTURE.md
 * @module audio/stereo-sampler
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// SAMPLER STATE
// ─────────────────────────────────────────────────────────────────────────────

/** @type {'worklet'|'scriptprocessor'|null} Current sampling mode */
let samplingMode = null;

/** @type {AudioWorkletNode|null} AudioWorklet sampler node */
let workletNode = null;

/** @type {ScriptProcessorNode|null} ScriptProcessor sampler node (fallback) */
let scriptProcessorNode = null;

/** @type {Float32Array} Buffer for left channel */
let syncedBufL = new Float32Array(4096);

/** @type {Float32Array} Buffer for right channel */
let syncedBufR = new Float32Array(4096);

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
 * @returns {Promise<'worklet'|'scriptprocessor'>} The selected sampling mode
 */
export async function initStereoSampler(audioContext, sourceL, sourceR) {
  // Try AudioWorklet first (runs in audio thread, lower latency)
  try {
    await initAudioWorkletSampler(audioContext, sourceL, sourceR);
    samplingMode = 'worklet';
    console.log('[StereoSampler] Using AudioWorklet mode (sample-accurate, audio thread)');
    return 'worklet';
  } catch (e) {
    console.warn('[StereoSampler] AudioWorklet failed, using fallback:', e.message);
  }

  // Fallback to ScriptProcessorNode (deprecated but functional)
  try {
    initScriptProcessorSampler(audioContext, sourceL, sourceR);
    samplingMode = 'scriptprocessor';
    console.log('[StereoSampler] Using ScriptProcessorNode mode (fallback)');
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
 * @private
 */
async function initAudioWorkletSampler(audioContext, sourceL, sourceR) {
  // Load worklet module
  await audioContext.audioWorklet.addModule('./src/audio/stereo-sampler-worklet.js');

  // Create merger to combine L/R into stereo for worklet
  const merger = audioContext.createChannelMerger(2);
  sourceL.connect(merger, 0, 0);
  sourceR.connect(merger, 0, 1);

  // Create worklet node
  workletNode = new AudioWorkletNode(audioContext, 'stereo-sampler', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 2,
    channelCountMode: 'explicit'
  });

  // Connect merged stereo to worklet
  merger.connect(workletNode);

  // Handle messages from worklet
  workletNode.port.onmessage = (event) => {
    syncedBufL = event.data.bufL;
    syncedBufR = event.data.bufR;
    lastTimestamp = event.data.timestamp;
    dataReady = true;
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
 * @private
 */
function initScriptProcessorSampler(audioContext, sourceL, sourceR) {
  // Buffer size 4096 matches our analysis buffer size
  // 2 input channels, 2 output channels (must have outputs to be connectable)
  scriptProcessorNode = audioContext.createScriptProcessor(4096, 2, 2);

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

  // Process audio - L/R are GUARANTEED from same audio block
  scriptProcessorNode.onaudioprocess = (event) => {
    const inputL = event.inputBuffer.getChannelData(0);
    const inputR = event.inputBuffer.getChannelData(1);

    // Copy to our buffers (they're the same size: 4096)
    syncedBufL.set(inputL);
    syncedBufR.set(inputR);
    lastTimestamp = performance.now();
    dataReady = true;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

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
    workletActive: workletNode !== null,
    scriptProcessorActive: scriptProcessorNode !== null,
    lastTimestamp: lastTimestamp
  };
}

/**
 * Dispose of sampler resources.
 */
export function disposeStereoSampler() {
  if (workletNode) {
    workletNode.disconnect();
    workletNode = null;
  }
  if (scriptProcessorNode) {
    scriptProcessorNode.disconnect();
    scriptProcessorNode = null;
  }
  samplingMode = null;
  dataReady = false;
}
