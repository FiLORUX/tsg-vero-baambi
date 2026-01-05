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
 * STEREO SAMPLER AUDIOWORKLET
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Sample-accurate L/R buffer capture in the audio thread.
 *
 * Web Audio API's AnalyserNode has no atomic read mechanism for stereo channels.
 * Sequential getFloatTimeDomainData() calls can receive buffers from different
 * audio processing blocks, causing intermittent decorrelation artifacts.
 *
 * This worklet captures L/R samples in the audio thread where they are
 * GUARANTEED to be from the same render quantum, then posts them to the
 * main thread for visualization.
 *
 * Usage:
 *   await ac.audioWorklet.addModule('./src/audio/stereo-sampler-worklet.js');
 *   const sampler = new AudioWorkletNode(ac, 'stereo-sampler');
 *   source.connect(sampler);
 *   sampler.port.onmessage = (e) => { bufL = e.data.bufL; bufR = e.data.bufR; };
 *
 * @see docs/STEREO-SAMPLING-ARCHITECTURE.md
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const BUFFER_SIZE = 4096;
const POST_INTERVAL_SAMPLES = 2048; // Post every ~46ms at 44.1kHz

class StereoSamplerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    /** @type {Float32Array} */
    this._bufferL = new Float32Array(BUFFER_SIZE);

    /** @type {Float32Array} */
    this._bufferR = new Float32Array(BUFFER_SIZE);

    /** @type {number} */
    this._writeIndex = 0;

    /** @type {number} */
    this._samplesSincePost = 0;
  }

  /**
   * Process audio - capture L/R samples atomically.
   *
   * @param {Float32Array[][]} inputs - Input audio
   * @param {Float32Array[][]} outputs - Output audio (unused)
   * @param {Object} parameters - Audio parameters (unused)
   * @returns {boolean} Keep processor alive
   */
  process(inputs, outputs, parameters) {
    const input = inputs[0];

    // Need stereo input
    if (!input || input.length < 2) return true;

    const L = input[0];
    const R = input[1];
    const blockSize = L.length;

    // Copy samples to ring buffer
    // L and R are GUARANTEED from the same audio render quantum
    for (let i = 0; i < blockSize; i++) {
      this._bufferL[this._writeIndex] = L[i];
      this._bufferR[this._writeIndex] = R[i];
      this._writeIndex = (this._writeIndex + 1) % BUFFER_SIZE;
    }

    this._samplesSincePost += blockSize;

    // Post to main thread at regular intervals
    if (this._samplesSincePost >= POST_INTERVAL_SAMPLES) {
      this._samplesSincePost = 0;

      // Create snapshot of current buffer state
      // Rearrange so newest samples are at the end
      const snapshotL = new Float32Array(BUFFER_SIZE);
      const snapshotR = new Float32Array(BUFFER_SIZE);

      for (let i = 0; i < BUFFER_SIZE; i++) {
        const srcIdx = (this._writeIndex + i) % BUFFER_SIZE;
        snapshotL[i] = this._bufferL[srcIdx];
        snapshotR[i] = this._bufferR[srcIdx];
      }

      this.port.postMessage({
        bufL: snapshotL,
        bufR: snapshotR,
        timestamp: currentTime
      }, [snapshotL.buffer, snapshotR.buffer]); // Transfer ownership
    }

    return true;
  }
}

registerProcessor('stereo-sampler', StereoSamplerProcessor);
