/**
 * External Meter Processor - AudioWorklet for external audio input
 *
 * This processor provides a clean, unprocessed audio path for external inputs.
 * It passes audio through without any processing (no AGC, no noise suppression,
 * no echo cancellation) and optionally sends PCM data to the main thread.
 *
 * The actual metering is done by AnalyserNodes in the main thread for
 * compatibility with the existing metering pipeline.
 */
class ExternalMeterProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.sendPCM = options?.processorOptions?.sendPCM ?? false;
    this.blockCount = 0;
    this.pcmInterval = 4; // Send PCM every N blocks to reduce overhead
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];

    // No input connected
    if (!input || input.length === 0) {
      return true;
    }

    // Get L/R channels (or duplicate mono to stereo)
    const left = input[0] || new Float32Array(128);
    const right = input[1] || input[0] || new Float32Array(128);

    // Pass through to output (if connected)
    const output = outputs[0];
    if (output && output.length >= 2) {
      if (output[0]) output[0].set(left);
      if (output[1]) output[1].set(right);
    }

    // Optionally send PCM to main thread (for direct metering if needed)
    if (this.sendPCM) {
      this.blockCount++;
      if (this.blockCount >= this.pcmInterval) {
        this.blockCount = 0;
        this.port.postMessage({
          type: 'pcm',
          left: new Float32Array(left),
          right: new Float32Array(right),
          sampleRate: sampleRate
        });
      }
    }

    // Send periodic heartbeat
    if (this.blockCount === 0) {
      this.port.postMessage({ type: 'heartbeat', time: currentTime });
    }

    return true; // Keep processor alive
  }
}

registerProcessor('external-meter-processor', ExternalMeterProcessor);
