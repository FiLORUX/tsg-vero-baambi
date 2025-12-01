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
 * EXTERNAL METER PROCESSOR (AudioWorklet)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * ───────
 * Real-time audio pass-through for professional external sources including:
 *   • USB Audio Class devices (mixers, interfaces, recorders)
 *   • AES67 / SMPTE ST 2110-30 streams via network bridges
 *   • NDI|HX and NDI|HX2 audio extraction
 *   • Dante Virtual Soundcard (DVS) endpoints
 *   • SDI embedded audio via capture cards
 *
 * DESIGN RATIONALE
 * ────────────────
 * External professional sources arrive pre-processed and level-aligned per
 * facility standards (typically EBU R68: 0 dBu = −18 dBFS). Applying browser
 * audio processing would corrupt calibrated levels and introduce artifacts:
 *
 *   ✗ AGC (Automatic Gain Control) – destroys dynamic range, LRA measurements
 *   ✗ Noise suppression – removes room tone, corrupts ambience
 *   ✗ Echo cancellation – phase distortion, comb filtering on music
 *
 * This processor maintains bit-transparent signal integrity by passing audio
 * through the Web Audio rendering thread without modification.
 *
 * SIGNAL FLOW
 * ───────────
 *   MediaStreamSource → AudioWorkletNode → AnalyserNodes → Metering Pipeline
 *         ↓                    ↓
 *   External Device    [This Processor]
 *   (USB/NDI/DVS)       - Stereo pass-through
 *                       - Optional PCM extraction
 *                       - Heartbeat monitoring
 *
 * TIMING CONSTRAINTS
 * ──────────────────
 * AudioWorklet runs on a dedicated real-time thread with strict timing:
 *   • Block size: 128 samples (fixed by Web Audio spec)
 *   • Block period: 2.67ms @ 48kHz, 2.90ms @ 44.1kHz
 *   • Deadline: process() must complete within block period
 *   • No blocking operations (allocations, locks, I/O)
 *
 * The PCM decimation (1:4 ratio) reduces MessagePort overhead while
 * maintaining sufficient temporal resolution for UI-rate updates (~10Hz).
 *
 * STANDARDS CONTEXT
 * ─────────────────
 *   • EBU R68: Reference level alignment (0 dBu = −18 dBFS peak)
 *   • AES67-2018: High-performance audio-over-IP interoperability
 *   • SMPTE ST 2110-30: PCM audio in IP professional environments
 *   • USB Audio Class 2.0: Professional audio device interface
 *
 * @see https://webaudio.github.io/web-audio-api/#audioworklet
 * @see https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor
 * ═══════════════════════════════════════════════════════════════════════════════
 */

class ExternalMeterProcessor extends AudioWorkletProcessor {
  // ─────────────────────────────────────────────────────────────────────────────
  // PROCESSOR INITIALIZATION
  // ─────────────────────────────────────────────────────────────────────────────
  // AudioWorkletProcessor instances are created on the audio rendering thread.
  // Constructor must be lightweight – no async operations or heavy allocations.
  // ─────────────────────────────────────────────────────────────────────────────

  constructor(options) {
    super();

    // PCM extraction mode: when enabled, raw sample data is posted to main thread
    // for direct waveform display or secondary analysis paths
    this.sendPCM = options?.processorOptions?.sendPCM ?? false;

    // Block counter for PCM decimation – reduces MessagePort traffic
    this.blockCount = 0;

    // Decimation ratio: post PCM every N render quanta (128-sample blocks)
    // At 48kHz: 4 blocks = 512 samples = 10.67ms ≈ 94Hz update rate
    // This exceeds typical UI refresh (60Hz) while minimizing IPC overhead
    this.pcmInterval = 4;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // REAL-TIME AUDIO PROCESSING
  // ─────────────────────────────────────────────────────────────────────────────
  // Called synchronously by the audio rendering thread for each 128-sample block.
  // Must return true to keep processor alive; false terminates the node.
  //
  // CRITICAL: This method runs under real-time constraints. Avoid:
  //   • Dynamic memory allocation (use pre-allocated buffers)
  //   • Blocking operations (locks, I/O, network)
  //   • Unbounded loops or recursive algorithms
  //   • Console logging (can block on I/O)
  // ─────────────────────────────────────────────────────────────────────────────

  process(inputs, outputs, parameters) {
    const input = inputs[0];

    // ───────────────────────────────────────────────────────────────────────────
    // INPUT VALIDATION
    // ───────────────────────────────────────────────────────────────────────────
    // inputs[0] is undefined when no source is connected or device is
    // disconnected (USB hot-unplug, network stream loss). Processor remains
    // alive to handle reconnection without requiring node reconstruction.
    // ───────────────────────────────────────────────────────────────────────────

    if (!input || input.length === 0) {
      return true; // Keep alive for reconnection
    }

    // ───────────────────────────────────────────────────────────────────────────
    // STEREO CHANNEL EXTRACTION
    // ───────────────────────────────────────────────────────────────────────────
    // Professional sources are typically stereo (L/R). Mono sources are
    // duplicated to both channels to maintain consistent stereo bus topology.
    // Channel assignment follows standard broadcast convention:
    //   input[0] = Left  (odd channels in multichannel: 1, 3, 5...)
    //   input[1] = Right (even channels: 2, 4, 6...)
    // ───────────────────────────────────────────────────────────────────────────

    const left = input[0] || new Float32Array(128);
    const right = input[1] || input[0] || new Float32Array(128);

    // ───────────────────────────────────────────────────────────────────────────
    // TRANSPARENT PASS-THROUGH
    // ───────────────────────────────────────────────────────────────────────────
    // Copy input to output without modification. This maintains signal integrity
    // for downstream AnalyserNodes which perform FFT and metering analysis.
    // TypedArray.set() is optimized for bulk memory copy (memcpy equivalent).
    // ───────────────────────────────────────────────────────────────────────────

    const output = outputs[0];
    if (output && output.length >= 2) {
      if (output[0]) output[0].set(left);
      if (output[1]) output[1].set(right);
    }

    // ───────────────────────────────────────────────────────────────────────────
    // PCM DATA EXTRACTION (Optional)
    // ───────────────────────────────────────────────────────────────────────────
    // When enabled, posts raw PCM samples to main thread via MessagePort.
    // Use cases:
    //   • Direct waveform visualization (bypassing AnalyserNode)
    //   • Secondary metering paths (custom LUFS implementation)
    //   • Audio recording/capture to main thread
    //
    // Decimation (1:4) balances temporal resolution against IPC overhead.
    // Each message includes sample rate for correct time-domain calculations.
    // ───────────────────────────────────────────────────────────────────────────

    if (this.sendPCM) {
      this.blockCount++;
      if (this.blockCount >= this.pcmInterval) {
        this.blockCount = 0;
        this.port.postMessage({
          type: 'pcm',
          left: new Float32Array(left),   // Copy to avoid detached buffer issues
          right: new Float32Array(right),
          sampleRate: sampleRate          // Global: current audio context rate
        });
      }
    }

    // ───────────────────────────────────────────────────────────────────────────
    // HEARTBEAT MONITORING
    // ───────────────────────────────────────────────────────────────────────────
    // Periodic signal to main thread confirming processor is alive and
    // processing audio. Used for:
    //   • Device health monitoring (detect stalled/crashed worklets)
    //   • Audio clock synchronization (currentTime is render thread time)
    //   • UI connection status indicators
    //
    // Sent at PCM interval rate (~10Hz) to avoid message flooding.
    // currentTime is the global AudioContext time in seconds.
    // ───────────────────────────────────────────────────────────────────────────

    if (this.blockCount === 0) {
      this.port.postMessage({ type: 'heartbeat', time: currentTime });
    }

    return true; // Keep processor alive
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROCESSOR REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════════
// Register processor class with the AudioWorkletGlobalScope. The name string
// must match the name parameter passed to AudioWorkletNode constructor:
//   new AudioWorkletNode(context, 'external-meter-processor', options)
// ═══════════════════════════════════════════════════════════════════════════════

registerProcessor('external-meter-processor', ExternalMeterProcessor);
