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
 * It also measures the true-peak level of EVERY sample (ITU-R BS.1770-4
 * Annex 2 polyphase FIR) and posts the per-channel maximum at a fixed cadence
 * of about 10 ms. Measurement in the audio thread is independent of the UI
 * frame rate, of dropped frames and of background-tab throttling, so TPmax
 * derived from these messages is sample-complete. The filter branches arrive
 * through processorOptions from src/metering/true-peak.js, the single source
 * of the coefficient table; the kernel below is the same arithmetic as
 * TruePeakDetector.process() and is verified against it in
 * tests/true-peak-test.js.
 *
 * Messages to the main thread:
 *   { type: 'snapshot', bufL, bufR, timestamp }   rolling display buffers
 *   { type: 'truePeak', left, right, samples, generation }
 *                                                 linear true-peak maxima of
 *                                                 the `samples` samples since
 *                                                 the previous truePeak message
 *
 * Message from the main thread:
 *   { type: 'resetTruePeak', generation }         discard the maxima gathered
 *                                                 so far; later reports carry
 *                                                 the new generation, so the
 *                                                 main thread can drop reports
 *                                                 that were already in flight
 *
 * A quantum without input channels (no active source upstream) is measured
 * as silence: the stream continues, the previous signal's tail is completed
 * with zeros, and no stale history reaches the next signal.
 *
 * Usage:
 *   await ac.audioWorklet.addModule(new URL('./stereo-sampler-worklet.js', import.meta.url));
 *   const sampler = new AudioWorkletNode(ac, 'stereo-sampler', {
 *     processorOptions: { bufferSize: 4096, truePeakBranches: interpolationBranches(ac.sampleRate) }
 *   });
 *
 * @see docs/STEREO-SAMPLING-ARCHITECTURE.md
 * @see ITU-R BS.1770-4 Annex 2
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURABLE BUFFER PARAMETERS
// ─────────────────────────────────────────────────────────────────────────────
// Default: 4096 samples (85ms @ 48kHz) provides good goniometer trace history.
// Can be configured via processorOptions.bufferSize at node creation.
//
// Latency trade-offs at 48kHz:
//   4096 samples = 85ms trace history, 42ms update interval (default)
//   2048 samples = 42ms trace history, 21ms update interval (lower latency)
//   1024 samples = 21ms trace history, 10ms update interval (minimum recommended)
//
// Note: Buffer size must be power of 2. Minimum 128 for usable display.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_BUFFER_SIZE = 4096;
const MIN_BUFFER_SIZE = 128;
const MAX_BUFFER_SIZE = 8192;

// ─────────────────────────────────────────────────────────────────────────────
// TRUE-PEAK MEASUREMENT
// ─────────────────────────────────────────────────────────────────────────────

/** Taps per polyphase branch of the ITU-R BS.1770-4 Annex 2 interpolator. */
const TRUE_PEAK_TAPS = 12;

/** Input samples carried between render quanta (taps − 1). */
const TRUE_PEAK_HISTORY = TRUE_PEAK_TAPS - 1;

/** Target interval between true-peak messages in seconds. */
const TRUE_PEAK_POST_SECONDS = 0.01;

/**
 * Single-channel true-peak kernel with carried history.
 *
 * Same arithmetic as TruePeakDetector.process() in src/metering/true-peak.js:
 * branch h yields Σₖ h[k] · x[n − k], with h[0] applied to the newest sample,
 * and the maximum absolute output over all branches is the true peak. Without
 * branches (processorOptions omitted) the sample peak is returned, so the
 * processor never reports nothing.
 */
class TruePeakKernel {
  /**
   * @param {Float64Array[]} branches - Polyphase branches from interpolationBranches()
   * @param {number} maxBlock - Largest block length process() will receive
   */
  constructor(branches, maxBlock) {
    this.branches = branches;
    this.history = new Float64Array(TRUE_PEAK_HISTORY);
    this.extended = new Float64Array(TRUE_PEAK_HISTORY + maxBlock);
  }

  /**
   * @param {Float32Array} block - Next samples of the channel
   * @returns {number} Largest over-sampled absolute value in the block, linear
   */
  process(block) {
    const n = block.length;
    let max = 0;

    if (this.branches.length === 0) {
      for (let i = 0; i < n; i++) {
        const abs = block[i] < 0 ? -block[i] : block[i];
        if (abs > max) max = abs;
      }
      return max;
    }

    if (this.extended.length < TRUE_PEAK_HISTORY + n) {
      this.extended = new Float64Array(TRUE_PEAK_HISTORY + n);
    }
    const x = this.extended;
    x.set(this.history, 0);
    x.set(block, TRUE_PEAK_HISTORY);

    for (const h of this.branches) {
      for (let i = TRUE_PEAK_HISTORY; i < TRUE_PEAK_HISTORY + n; i++) {
        let acc = 0;
        for (let k = 0; k < TRUE_PEAK_TAPS; k++) {
          acc += h[k] * x[i - k];
        }
        const abs = acc < 0 ? -acc : acc;
        if (abs > max) max = abs;
      }
    }

    this.history.set(x.subarray(n, n + TRUE_PEAK_HISTORY));
    return max;
  }
}

class StereoSamplerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    // Get buffer size from options, default to 4096
    const requestedSize = options?.processorOptions?.bufferSize ?? DEFAULT_BUFFER_SIZE;

    // Validate and clamp buffer size (must be power of 2)
    let bufferSize = Math.max(MIN_BUFFER_SIZE, Math.min(MAX_BUFFER_SIZE, requestedSize));
    // Round to nearest power of 2
    bufferSize = Math.pow(2, Math.round(Math.log2(bufferSize)));

    this._bufferSize = bufferSize;
    // Post interval = half buffer size for 50% overlap
    this._postInterval = Math.max(128, bufferSize / 2);

    /** @type {Float32Array} */
    this._bufferL = new Float32Array(bufferSize);

    /** @type {Float32Array} */
    this._bufferR = new Float32Array(bufferSize);

    /** @type {number} */
    this._writeIndex = 0;

    /** @type {number} */
    this._samplesSincePost = 0;

    // True-peak measurement of every sample. Without branches from the main
    // thread the processor still reports the sample peak, never nothing.
    const branches = (options?.processorOptions?.truePeakBranches ?? [])
      .map(branch => Float64Array.from(branch));
    this._truePeakL = new TruePeakKernel(branches, 128);
    this._truePeakR = new TruePeakKernel(branches, 128);
    this._truePeakMaxL = 0;
    this._truePeakMaxR = 0;
    this._truePeakSamples = 0;
    this._truePeakPostInterval = Math.max(128, Math.round((sampleRate * TRUE_PEAK_POST_SECONDS) / 128) * 128);
    this._truePeakGeneration = 0;
    this._silence = new Float32Array(128);

    this.port.onmessage = (event) => {
      if (event.data?.type === 'resetTruePeak') {
        this._truePeakMaxL = 0;
        this._truePeakMaxR = 0;
        this._truePeakSamples = 0;
        this._truePeakGeneration = event.data.generation;
      }
    };
  }

  /**
   * Measure one quantum per channel and post the maxima when due.
   *
   * @param {Float32Array} L - Left channel samples
   * @param {Float32Array} R - Right channel samples
   */
  _measureTruePeak(L, R) {
    const peakL = this._truePeakL.process(L);
    const peakR = this._truePeakR.process(R);
    if (peakL > this._truePeakMaxL) this._truePeakMaxL = peakL;
    if (peakR > this._truePeakMaxR) this._truePeakMaxR = peakR;
    this._truePeakSamples += L.length;

    if (this._truePeakSamples >= this._truePeakPostInterval) {
      this.port.postMessage({
        type: 'truePeak',
        left: this._truePeakMaxL,
        right: this._truePeakMaxR,
        samples: this._truePeakSamples,
        generation: this._truePeakGeneration
      });
      this._truePeakMaxL = 0;
      this._truePeakMaxR = 0;
      this._truePeakSamples = 0;
    }
  }

  /**
   * Process audio - capture L/R samples atomically and measure true peak.
   *
   * @param {Float32Array[][]} inputs - Input audio
   * @returns {boolean} Keep processor alive
   */
  process(inputs) {
    const input = inputs[0];

    // Without input channels the upstream graph is silent: measure silence so
    // the true-peak stream stays continuous and carries no stale history
    if (!input || input.length < 2) {
      this._measureTruePeak(this._silence, this._silence);
      return true;
    }

    const L = input[0];
    const R = input[1];
    const blockSize = L.length;
    const bufferSize = this._bufferSize;

    // Copy samples to ring buffer
    // L and R are GUARANTEED from the same audio render quantum
    for (let i = 0; i < blockSize; i++) {
      this._bufferL[this._writeIndex] = L[i];
      this._bufferR[this._writeIndex] = R[i];
      this._writeIndex = (this._writeIndex + 1) % bufferSize;
    }

    // True peak of every sample, accumulated until the next truePeak message
    this._measureTruePeak(L, R);

    this._samplesSincePost += blockSize;

    // Post to main thread at regular intervals
    if (this._samplesSincePost >= this._postInterval) {
      this._samplesSincePost = 0;

      // Create snapshot of current buffer state
      // Rearrange so newest samples are at the end
      const snapshotL = new Float32Array(bufferSize);
      const snapshotR = new Float32Array(bufferSize);

      for (let i = 0; i < bufferSize; i++) {
        const srcIdx = (this._writeIndex + i) % bufferSize;
        snapshotL[i] = this._bufferL[srcIdx];
        snapshotR[i] = this._bufferR[srcIdx];
      }

      this.port.postMessage({
        type: 'snapshot',
        bufL: snapshotL,
        bufR: snapshotR,
        timestamp: currentTime
      }, [snapshotL.buffer, snapshotR.buffer]); // Transfer ownership
    }

    return true;
  }
}

registerProcessor('stereo-sampler', StereoSamplerProcessor);
