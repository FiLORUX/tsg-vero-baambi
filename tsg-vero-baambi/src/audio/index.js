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
 * AUDIO MODULE INDEX
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * @module audio
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export {
  DEFAULT_FFT_SIZE,
  DEFAULT_SMOOTHING,
  PREFERRED_SAMPLE_RATE,
  AudioEngine,
  getAudioInputDevices,
  getAudioOutputDevices,
  requestMicrophonePermission
} from './engine.js';
