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
 * INPUT SOURCE CONTROLLER
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Manages audio input sources for metering:
 * - Browser tab capture (getDisplayMedia)
 * - External device capture (getUserMedia)
 * - Internal test tone generator (OscillatorNode)
 *
 * @module app/sources
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { appState, InputMode } from './state.js';
import { dbToGain } from '../utils/math.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ITU-R BR.1385 alignment tone frequency.
 * @type {number}
 */
export const ALIGNMENT_TONE_HZ = 400;

/**
 * EBU R68 alignment level: 0 dBu = −18 dBFS (peak).
 * @type {number}
 */
export const ALIGNMENT_LEVEL_DBFS = -18;

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE CONTROLLER CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input source controller.
 *
 * @example
 * const sources = new SourceController(audioContext);
 *
 * // Connect output to metering chain
 * sources.connect(analyserInput);
 *
 * // Start browser tab capture
 * await sources.startBrowserCapture();
 *
 * // Switch to test generator
 * sources.startGenerator({ frequency: 1000 });
 */
export class SourceController {
  /**
   * @param {AudioContext} context - Web Audio context
   */
  constructor(context) {
    /** @type {AudioContext} */
    this.context = context;

    /** @type {GainNode} */
    this.outputGain = context.createGain();
    this.outputGain.gain.value = 1.0;

    /** @type {GainNode} */
    this.monitorGain = context.createGain();
    this.monitorGain.gain.value = 0;

    /** @type {GainNode} */
    this.trimGain = context.createGain();
    this.trimGain.gain.value = 1.0;

    // Connect chain: trim → output, trim → monitor
    this.trimGain.connect(this.outputGain);

    // Active source nodes
    /** @type {MediaStreamAudioSourceNode|null} */
    this._browserSource = null;
    /** @type {MediaStream|null} */
    this._browserStream = null;

    /** @type {MediaStreamAudioSourceNode|null} */
    this._externalSource = null;
    /** @type {MediaStream|null} */
    this._externalStream = null;

    /** @type {OscillatorNode|null} */
    this._oscillator = null;
    /** @type {GainNode|null} */
    this._oscillatorGain = null;

    /** @type {InputMode} */
    this._activeMode = InputMode.GENERATOR;

    // Subscribe to state changes
    appState.subscribe((state, changed) => {
      this._handleStateChange(state, changed);
    });
  }

  /**
   * Connect metering output to destination.
   *
   * @param {AudioNode} destination - Target node for metering
   */
  connect(destination) {
    this.outputGain.connect(destination);
  }

  /**
   * Connect monitor output to speakers.
   *
   * @param {AudioNode} destination - Usually context.destination
   */
  connectMonitor(destination) {
    this.monitorGain.connect(destination);
  }

  /**
   * Disconnect all outputs.
   */
  disconnect() {
    this.outputGain.disconnect();
    this.monitorGain.disconnect();
  }

  /**
   * Get active input mode.
   *
   * @returns {InputMode}
   */
  get activeMode() {
    return this._activeMode;
  }

  /**
   * Check if any source is currently active.
   *
   * @returns {boolean}
   */
  get isActive() {
    return !!(this._browserSource || this._externalSource || this._oscillator);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BROWSER TAB CAPTURE
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Start capturing audio from browser tab.
   * Uses getDisplayMedia with audio:true.
   *
   * @returns {Promise<MediaStreamTrack>} Audio track
   * @throws {Error} If capture denied or unsupported
   */
  async startBrowserCapture() {
    // Stop any existing capture
    this.stopBrowserCapture();

    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('Browser does not support getDisplayMedia');
    }

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,  // Required for getDisplayMedia
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    // Get audio track (may not exist if user didn't share audio)
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) {
      // Stop video track since we only wanted audio
      stream.getTracks().forEach(t => t.stop());
      throw new Error('No audio track in captured stream. Enable "Share audio" when selecting tab.');
    }

    // Stop video track - we only need audio
    stream.getVideoTracks().forEach(t => t.stop());

    this._browserStream = stream;
    this._browserSource = this.context.createMediaStreamSource(stream);
    this._browserSource.connect(this.trimGain);
    this._connectMonitor(this._browserSource);

    this._activeMode = InputMode.BROWSER;

    // Handle track ending (user stopped sharing)
    audioTrack.onended = () => {
      this.stopBrowserCapture();
      appState.set({ isCapturing: false });
    };

    appState.set({
      inputMode: InputMode.BROWSER,
      isCapturing: true,
      sampleRate: this.context.sampleRate,
      channelCount: audioTrack.getSettings?.().channelCount || 2
    });

    return audioTrack;
  }

  /**
   * Stop browser tab capture.
   */
  stopBrowserCapture() {
    if (this._browserSource) {
      this._browserSource.disconnect();
      this._browserSource = null;
    }

    if (this._browserStream) {
      this._browserStream.getTracks().forEach(t => t.stop());
      this._browserStream = null;
    }

    if (this._activeMode === InputMode.BROWSER) {
      appState.set({ isCapturing: false });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EXTERNAL DEVICE CAPTURE
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Start capturing from external audio device.
   *
   * @param {string} [deviceId] - Specific device ID, or default
   * @returns {Promise<MediaStreamTrack>} Audio track
   */
  async startExternalCapture(deviceId) {
    // Stop any existing capture
    this.stopExternalCapture();

    const constraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        sampleRate: { ideal: 48000 },
        channelCount: { ideal: 2 }
      }
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const audioTrack = stream.getAudioTracks()[0];

    this._externalStream = stream;
    this._externalSource = this.context.createMediaStreamSource(stream);
    this._externalSource.connect(this.trimGain);
    this._connectMonitor(this._externalSource);

    this._activeMode = InputMode.EXTERNAL;

    audioTrack.onended = () => {
      this.stopExternalCapture();
      appState.set({ isCapturing: false });
    };

    const settings = audioTrack.getSettings?.() || {};

    appState.set({
      inputMode: InputMode.EXTERNAL,
      isCapturing: true,
      deviceId: settings.deviceId || deviceId,
      sampleRate: settings.sampleRate || this.context.sampleRate,
      channelCount: settings.channelCount || 2
    });

    return audioTrack;
  }

  /**
   * Stop external device capture.
   */
  stopExternalCapture() {
    if (this._externalSource) {
      this._externalSource.disconnect();
      this._externalSource = null;
    }

    if (this._externalStream) {
      this._externalStream.getTracks().forEach(t => t.stop());
      this._externalStream = null;
    }

    if (this._activeMode === InputMode.EXTERNAL) {
      appState.set({ isCapturing: false });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST TONE GENERATOR
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Start internal test tone generator.
   *
   * @param {Object} [options] - Generator options
   * @param {number} [options.frequency=400] - Frequency in Hz
   * @param {string} [options.waveform='sine'] - Waveform type
   * @param {number} [options.levelDbfs=-18] - Output level in dBFS
   */
  startGenerator(options = {}) {
    // Stop existing generator
    this.stopGenerator();

    const frequency = options.frequency ?? appState.get('generatorFrequency');
    const waveform = options.waveform ?? appState.get('generatorWaveform');
    const levelDbfs = options.levelDbfs ?? ALIGNMENT_LEVEL_DBFS;

    this._oscillatorGain = this.context.createGain();
    this._oscillatorGain.gain.value = dbToGain(levelDbfs);

    this._oscillator = this.context.createOscillator();
    this._oscillator.type = waveform;
    this._oscillator.frequency.value = frequency;

    this._oscillator.connect(this._oscillatorGain);
    this._oscillatorGain.connect(this.trimGain);
    this._connectMonitor(this._oscillatorGain);

    this._oscillator.start();

    this._activeMode = InputMode.GENERATOR;

    appState.set({
      inputMode: InputMode.GENERATOR,
      isCapturing: true,
      sampleRate: this.context.sampleRate,
      channelCount: 2
    });
  }

  /**
   * Stop test tone generator.
   */
  stopGenerator() {
    if (this._oscillator) {
      this._oscillator.stop();
      this._oscillator.disconnect();
      this._oscillator = null;
    }

    if (this._oscillatorGain) {
      this._oscillatorGain.disconnect();
      this._oscillatorGain = null;
    }

    if (this._activeMode === InputMode.GENERATOR) {
      appState.set({ isCapturing: false });
    }
  }

  /**
   * Update generator frequency.
   *
   * @param {number} frequency - Frequency in Hz
   */
  setGeneratorFrequency(frequency) {
    if (this._oscillator) {
      this._oscillator.frequency.setValueAtTime(frequency, this.context.currentTime);
    }
    appState.set({ generatorFrequency: frequency });
  }

  /**
   * Update generator waveform.
   *
   * @param {OscillatorType} waveform - Waveform type
   */
  setGeneratorWaveform(waveform) {
    if (this._oscillator) {
      this._oscillator.type = waveform;
    }
    appState.set({ generatorWaveform: waveform });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COMMON CONTROLS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set input trim level.
   *
   * @param {number} dB - Trim in dB
   */
  setTrim(dB) {
    this.trimGain.gain.setValueAtTime(dbToGain(dB), this.context.currentTime);
  }

  /**
   * Set monitor level.
   *
   * @param {number} percent - Level 0-100
   * @param {boolean} muted - Mute state
   */
  setMonitorLevel(percent, muted) {
    const gain = muted ? 0 : (percent / 100);
    this.monitorGain.gain.setValueAtTime(gain, this.context.currentTime);
  }

  /**
   * Stop all sources.
   */
  stopAll() {
    this.stopBrowserCapture();
    this.stopExternalCapture();
    this.stopGenerator();
  }

  /**
   * Dispose and clean up all resources.
   */
  dispose() {
    this.stopAll();
    this.disconnect();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Connect a source to the monitor output.
   * @private
   */
  _connectMonitor(source) {
    // Create a separate gain for monitor routing
    source.connect(this.monitorGain);
  }

  /**
   * Handle state changes.
   * @private
   */
  _handleStateChange(state, changed) {
    // Update trim based on active mode
    if (changed.browserTrim && state.inputMode === InputMode.BROWSER) {
      this.setTrim(state.browserTrim);
    }
    if (changed.externalTrim && state.inputMode === InputMode.EXTERNAL) {
      this.setTrim(state.externalTrim);
    }

    // Update monitor levels
    if (changed.browserMonitorLevel || changed.browserMonitorMuted) {
      if (state.inputMode === InputMode.BROWSER) {
        this.setMonitorLevel(state.browserMonitorLevel, state.browserMonitorMuted);
      }
    }
    if (changed.externalMonitorLevel || changed.externalMonitorMuted) {
      if (state.inputMode === InputMode.EXTERNAL) {
        this.setMonitorLevel(state.externalMonitorLevel, state.externalMonitorMuted);
      }
    }
    if (changed.generatorMonitorLevel || changed.generatorMonitorMuted) {
      if (state.inputMode === InputMode.GENERATOR) {
        this.setMonitorLevel(state.generatorMonitorLevel, state.generatorMonitorMuted);
      }
    }

    // Update generator settings
    if (changed.generatorFrequency && this._oscillator) {
      this.setGeneratorFrequency(state.generatorFrequency);
    }
    if (changed.generatorWaveform && this._oscillator) {
      this.setGeneratorWaveform(state.generatorWaveform);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE ENUMERATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get list of available audio input devices.
 *
 * @returns {Promise<MediaDeviceInfo[]>}
 */
export async function getAudioInputDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(d => d.kind === 'audioinput');
}

/**
 * Request microphone permission to enable device enumeration.
 *
 * @returns {Promise<boolean>} True if permission granted
 */
export async function requestMicrophonePermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    return true;
  } catch {
    return false;
  }
}
