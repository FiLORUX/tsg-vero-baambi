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
 * It runs the IEC 60268-10 quasi-peak detectors (Nordic Type I, BBC
 * Type IIa) on every sample in the same way, so their integration and
 * return times follow the signal's own clock rather than the UI frame rate.
 * The ballistics arrive through processorOptions from src/metering/ppm.js;
 * the detector below is the arithmetic of QuasiPeakDetector there and is
 * verified against it in tests/ppm-feed-test.js.
 *
 * Messages to the main thread:
 *   { type: 'snapshot', bufL, bufR, timestamp }   rolling display buffers
 *   { type: 'truePeak', left, right, samples, generation }
 *                                                 linear true-peak maxima of
 *                                                 the `samples` samples since
 *                                                 the previous truePeak message
 *   { type: 'ppm', nordicLeft, nordicRight, bbcLeft, bbcRight, samples, generation }
 *                                                 largest Type I and Type IIa
 *                                                 readings (dBFS) during the
 *                                                 `samples` samples since the
 *                                                 previous ppm message
 *   { type: 'samplePeak', left, right, samples }  largest sample magnitudes
 *                                                 (linear) of the `samples`
 *                                                 samples since the previous
 *                                                 samplePeak message
 *
 * Messages from the main thread:
 *   { type: 'resetTruePeak', generation }         discard the maxima gathered
 *                                                 so far; later reports carry
 *                                                 the new generation, so the
 *                                                 main thread can drop reports
 *                                                 that were already in flight
 *   { type: 'resetPpm', generation }              return the PPM detectors to
 *                                                 their initial state, likewise
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

// ─────────────────────────────────────────────────────────────────────────────
// QUASI-PEAK MEASUREMENT (IEC 60268-10 TYPE I AND TYPE IIa)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Single-channel quasi-peak detector on the audio thread's clock.
 *
 * Same arithmetic as QuasiPeakDetector in src/metering/ppm.js: the rolling
 * integration window's maximum from a monotonic queue, RC attack towards it,
 * hold while the signal stays within 6 dB, otherwise linear return on the dB
 * scale. The coefficients follow quasiPeakCoefficients() there, expression
 * for expression, from the ballistics handed over in processorOptions.
 */
class QuasiPeakKernel {
  /**
   * @param {{windowMs: number, attackTimeConstantS: number, decayDbPerSecond: number}} ballistics
   */
  constructor(ballistics) {
    const dt = 1 / sampleRate;
    this.windowSamples = Math.ceil(sampleRate * ballistics.windowMs / 1000);
    this.attackCoeff = 1 - Math.exp(-dt / ballistics.attackTimeConstantS);
    this.decayDbPerSample = ballistics.decayDbPerSecond / sampleRate;
    this.capacity = this.windowSamples + 1;
    this.values = new Float64Array(this.capacity);
    this.positions = new Float64Array(this.capacity);
    this.reset();
  }

  reset() {
    this.head = 0;
    this.size = 0;
    this.position = 0;
    this.envelope = 0;
    this.peakDb = -60;
  }

  /**
   * @param {Float32Array} block - Next samples of the channel
   * @returns {number} Largest reading during the block in dBFS
   */
  process(block) {
    const n = block.length;
    const values = this.values;
    const positions = this.positions;
    const capacity = this.capacity;
    const oldestKept = this.windowSamples;
    const attackCoeff = this.attackCoeff;
    const decayDbPerSample = this.decayDbPerSample;
    let head = this.head;
    let size = this.size;
    let position = this.position;
    let envelope = this.envelope;
    let peakDb = this.peakDb;
    let largest = n === 0 ? peakDb : -Infinity;

    for (let i = 0; i < n; i++) {
      let rectified = Math.fround(Math.abs(block[i]));
      if (!(rectified >= 0)) rectified = 0;

      while (size > 0 && values[(head + size - 1) % capacity] <= rectified) size--;
      const tail = (head + size) % capacity;
      values[tail] = rectified;
      positions[tail] = position;
      size++;

      if (positions[head] <= position - oldestKept) {
        head = (head + 1) % capacity;
        size--;
      }
      position++;

      const windowPeak = values[head];
      if (windowPeak > envelope) {
        envelope += attackCoeff * (windowPeak - envelope);
        peakDb = 20 * Math.log10(envelope + 1e-12);
      } else if (windowPeak > envelope * 0.5) {
        // Hold: signal within 6 dB of the envelope
      } else {
        peakDb -= decayDbPerSample;
        envelope = Math.pow(10, peakDb / 20);
        if (envelope < 1e-6) envelope = 1e-6;
      }
      if (peakDb > largest) largest = peakDb;
    }

    this.head = head;
    this.size = size;
    this.position = position;
    this.envelope = envelope;
    this.peakDb = peakDb;
    return largest;
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

    // Quasi-peak detectors on every sample, reported on the true peak's
    // cadence. Without ballistics from the main thread no PPM is reported.
    const ppmBallistics = options?.processorOptions?.ppmBallistics;
    this._ppm = ppmBallistics
      ? [
        new QuasiPeakKernel(ppmBallistics.nordic),
        new QuasiPeakKernel(ppmBallistics.nordic),
        new QuasiPeakKernel(ppmBallistics.bbc),
        new QuasiPeakKernel(ppmBallistics.bbc)
      ]
      : null;
    this._ppmMax = new Float64Array(4).fill(-Infinity);
    this._ppmSamples = 0;
    this._ppmGeneration = 0;

    // Sample peak of every sample, on the same cadence. It carries no state
    // beyond the pending maxima, so it needs no reset generation.
    this._samplePeakL = 0;
    this._samplePeakR = 0;
    this._samplePeakSamples = 0;

    this.port.onmessage = (event) => {
      if (event.data?.type === 'resetTruePeak') {
        this._truePeakMaxL = 0;
        this._truePeakMaxR = 0;
        this._truePeakSamples = 0;
        this._truePeakGeneration = event.data.generation;
      } else if (event.data?.type === 'resetPpm') {
        this._ppm?.forEach((kernel) => kernel.reset());
        this._ppmMax.fill(-Infinity);
        this._ppmSamples = 0;
        this._ppmGeneration = event.data.generation;
      }
    };
  }

  /**
   * Measure the sample peak of one quantum per channel and post the maxima
   * when due.
   *
   * @param {Float32Array} L - Left channel samples
   * @param {Float32Array} R - Right channel samples
   */
  _measureSamplePeak(L, R) {
    let peakL = this._samplePeakL;
    let peakR = this._samplePeakR;
    for (let i = 0; i < L.length; i++) {
      const absL = L[i] < 0 ? -L[i] : L[i];
      const absR = R[i] < 0 ? -R[i] : R[i];
      if (absL > peakL) peakL = absL;
      if (absR > peakR) peakR = absR;
    }
    this._samplePeakL = peakL;
    this._samplePeakR = peakR;
    this._samplePeakSamples += L.length;

    if (this._samplePeakSamples >= this._truePeakPostInterval) {
      this.port.postMessage({
        type: 'samplePeak',
        left: this._samplePeakL,
        right: this._samplePeakR,
        samples: this._samplePeakSamples
      });
      this._samplePeakL = 0;
      this._samplePeakR = 0;
      this._samplePeakSamples = 0;
    }
  }

  /**
   * Run one quantum per channel through the Type I and Type IIa detectors
   * and post the largest readings when due.
   *
   * @param {Float32Array} L - Left channel samples
   * @param {Float32Array} R - Right channel samples
   */
  _measurePpm(L, R) {
    if (!this._ppm) return;
    // Kernels 0 and 2 measure the left channel, 1 and 3 the right; no
    // allocation on the audio thread
    for (let i = 0; i < 4; i++) {
      const reading = this._ppm[i].process(i % 2 === 0 ? L : R);
      if (reading > this._ppmMax[i]) this._ppmMax[i] = reading;
    }
    this._ppmSamples += L.length;

    if (this._ppmSamples >= this._truePeakPostInterval) {
      this.port.postMessage({
        type: 'ppm',
        nordicLeft: this._ppmMax[0],
        nordicRight: this._ppmMax[1],
        bbcLeft: this._ppmMax[2],
        bbcRight: this._ppmMax[3],
        samples: this._ppmSamples,
        generation: this._ppmGeneration
      });
      this._ppmMax.fill(-Infinity);
      this._ppmSamples = 0;
    }
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
      this._measurePpm(this._silence, this._silence);
      this._measureSamplePeak(this._silence, this._silence);
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

    // True peak, quasi-peak readings and sample peak of every sample,
    // accumulated until the next truePeak, ppm and samplePeak messages
    this._measureTruePeak(L, R);
    this._measurePpm(L, R);
    this._measureSamplePeak(L, R);

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
