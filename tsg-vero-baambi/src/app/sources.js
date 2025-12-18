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
 * - Advanced signal generator (sine, noise, sweep, GLITS, Lissajous, vector-text)
 *
 * SIGNAL CHAIN:
 * ─────────────
 * Source → TrimGain → ChannelSplitter → outputL (for mixL)
 *                   │                 → outputR (for mixR)
 *                   └→ MonitorGain → ac.destination
 *
 * @module app/sources
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { appState, InputMode } from './state.js';
import { dbToGain } from '../utils/math.js';
import {
  createNoiseSource,
  createSineOscillator,
  createSweepOscillator,
  createGlitsOscillator,
  createLissajousWithPhase,
  createLissajousDualFreq,
  parseFrequencyRatio,
  dbToLinear
} from '../generators/index.js';

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

/**
 * Supported generator signal types.
 * @type {Object}
 */
export const SignalType = Object.freeze({
  SINE: 'sine',
  PINK: 'pink',
  WHITE: 'white',
  BROWN: 'brown',
  SWEEP: 'sweep',
  GLITS: 'glits',
  LISSAJOUS: 'lissajous',
  VECTOR_TEXT: 'vector-text'
});

/**
 * Channel routing modes.
 * @type {Object}
 */
export const RoutingMode = Object.freeze({
  STEREO: 'stereo',
  STEREO_UNCORR: 'stereo-uncorr',
  MONO: 'mono',
  LEFT_ONLY: 'left-only',
  RIGHT_ONLY: 'right-only',
  ANTI_PHASE: 'anti-phase'
});

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE CONTROLLER CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Comprehensive input source controller.
 *
 * ARCHITECTURE:
 * ─────────────
 * Unlike a simple gain-based output, this controller exposes discrete
 * left and right output GainNodes (outputL, outputR) that connect directly
 * to the analysis bus (mixL, mixR). This preserves the dual-mono signal
 * path required for accurate stereo metering.
 *
 * @example
 * const sources = new SourceController(audioContext);
 *
 * // Connect to analysis bus
 * sources.connectOutput(mixL, mixR);
 *
 * // Connect monitor to speakers
 * sources.connectMonitor(audioContext.destination);
 *
 * // Start browser capture
 * await sources.startBrowserCapture();
 *
 * // Or start generator with preset config
 * sources.startGenerator({ type: 'pink', db: -18, routing: 'stereo-uncorr' });
 */
export class SourceController {
  /**
   * @param {AudioContext} context - Web Audio context
   */
  constructor(context) {
    /** @type {AudioContext} */
    this.context = context;

    // ─── Output stage: discrete L/R for analysis bus ───
    /** @type {GainNode} Left channel output for analysis */
    this.outputL = context.createGain();
    this.outputL.gain.value = 1.0;

    /** @type {GainNode} Right channel output for analysis */
    this.outputR = context.createGain();
    this.outputR.gain.value = 1.0;

    // ─── Monitor stage: summed output to speakers ───
    /** @type {GainNode} Monitor output gain (0 = muted) */
    this.monitorGain = context.createGain();
    this.monitorGain.gain.value = 0;

    // ─── Active source state ───
    /** @type {InputMode} Currently active input mode */
    this._activeMode = null;

    // Browser capture state
    /** @type {MediaStreamAudioSourceNode|null} */
    this._browserSource = null;
    /** @type {MediaStream|null} */
    this._browserStream = null;
    /** @type {GainNode|null} */
    this._browserTrimNode = null;
    /** @type {ChannelSplitterNode|null} */
    this._browserSplit = null;
    /** @type {GainNode|null} */
    this._browserMonGain = null;
    /** @type {number} Browser trim in dB */
    this._browserTrimDb = -12;
    /** @type {boolean} Browser monitor muted */
    this._browserMonitorMuted = true;

    // External capture state
    /** @type {MediaStreamAudioSourceNode|null} */
    this._externalSource = null;
    /** @type {MediaStream|null} */
    this._externalStream = null;
    /** @type {GainNode|null} */
    this._externalTrimNode = null;
    /** @type {ChannelSplitterNode|null} */
    this._externalSplit = null;
    /** @type {GainNode|null} */
    this._externalMonGain = null;
    /** @type {number} External trim in dB */
    this._externalTrimDb = 0;
    /** @type {boolean} External monitor muted */
    this._externalMonitorMuted = true;

    // Generator state
    /** @type {OscillatorNode[]} Active oscillator nodes */
    this._genSourceNodes = [];
    /** @type {AudioNode[]} Active filter/gain nodes */
    this._genFilterNodes = [];
    /** @type {GainNode|null} Generator output gain */
    this._genGain = null;
    /** @type {GainNode|null} Left channel routing gain */
    this._genLeftGain = null;
    /** @type {GainNode|null} Right channel routing gain */
    this._genRightGain = null;
    /** @type {ChannelMergerNode|null} Stereo merger */
    this._genMerger = null;
    /** @type {GainNode|null} Generator monitor gain */
    this._genMonGain = null;
    /** @type {ChannelSplitterNode|null} Generator output splitter */
    this._genSplit = null;
    /** @type {boolean} Generator monitor muted */
    this._genMonitorMuted = false;
    /** @type {Object|null} Active sweep generator reference */
    this._activeSweepGenerator = null;
    /** @type {Object|null} Active GLITS generator reference */
    this._activeGlitsGenerator = null;
    /** @type {AudioWorkletNode|null} Vector text worklet node */
    this._vectorWorkletNode = null;
    /** @type {boolean} Whether vector worklet module is loaded */
    this._vectorWorkletLoaded = false;

    // ─── State subscription ───
    this._unsubscribe = appState.subscribe((state, changed) => {
      this._handleStateChange(state, changed);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API: CONNECTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Connect discrete L/R outputs to analysis bus.
   * This is the primary metering connection.
   *
   * @param {GainNode} mixL - Left channel analysis bus
   * @param {GainNode} mixR - Right channel analysis bus
   */
  connectOutput(mixL, mixR) {
    this.outputL.connect(mixL);
    this.outputR.connect(mixR);
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
    this.outputL.disconnect();
    this.outputR.disconnect();
    this.monitorGain.disconnect();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API: STATUS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get active input mode.
   * @returns {InputMode|null}
   */
  get activeMode() {
    return this._activeMode;
  }

  /**
   * Check if any source is currently active.
   * @returns {boolean}
   */
  get isActive() {
    return this._activeMode !== null;
  }

  /**
   * Check if a specific mode is active.
   * @param {InputMode} mode
   * @returns {boolean}
   */
  isModeActive(mode) {
    return this._activeMode === mode;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API: BROWSER TAB CAPTURE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start capturing audio from browser tab.
   * Uses getDisplayMedia with audio:true.
   *
   * @returns {Promise<MediaStreamTrack>} Audio track
   * @throws {Error} If capture denied or unsupported
   */
  async startBrowserCapture() {
    // Stop any existing source first
    this.stopAll();

    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('Browser does not support getDisplayMedia');
    }

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true, // Required for getDisplayMedia
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2
      }
    });

    // Stop video track - we only need audio
    stream.getVideoTracks().forEach(t => t.stop());

    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) {
      stream.getTracks().forEach(t => t.stop());
      throw new Error('No audio track in captured stream. Enable "Share audio" when selecting tab.');
    }

    // Force stereo if possible
    try {
      audioTrack.applyConstraints({ advanced: [{ channelCount: 2 }] });
    } catch { /* Ignore if not supported */ }
    audioTrack.contentHint = 'music';

    this._browserStream = stream;
    this._browserSource = this.context.createMediaStreamSource(stream);

    // Trim node for input gain adjustment
    this._browserTrimNode = this.context.createGain();
    this._browserTrimNode.gain.value = dbToGain(this._browserTrimDb);
    this._browserSource.connect(this._browserTrimNode);

    // Splitter to discrete L/R outputs
    this._browserSplit = this.context.createChannelSplitter(2);
    this._browserTrimNode.connect(this._browserSplit);
    this._browserSplit.connect(this.outputL, 0);
    this._browserSplit.connect(this.outputR, 1);

    // Monitor output (muted by default)
    this._browserMonGain = this.context.createGain();
    this._browserMonGain.gain.value = 0;
    this._browserTrimNode.connect(this._browserMonGain);
    this._browserMonGain.connect(this.context.destination);
    this._browserMonitorMuted = true;

    this._activeMode = InputMode.BROWSER;

    // Handle track ending (user stopped sharing)
    audioTrack.onended = () => {
      this.stopBrowserCapture();
      appState.set({ isCapturing: false });
    };

    const settings = audioTrack.getSettings?.() || {};
    appState.set({
      inputMode: InputMode.BROWSER,
      isCapturing: true,
      sampleRate: this.context.sampleRate,
      channelCount: settings.channelCount || 2
    });

    return audioTrack;
  }

  /**
   * Stop browser tab capture.
   */
  stopBrowserCapture() {
    [this._browserSource, this._browserTrimNode, this._browserSplit, this._browserMonGain].forEach(n => {
      try { n?.disconnect(); } catch { /* ignore */ }
    });
    this._browserSource = null;
    this._browserTrimNode = null;
    this._browserSplit = null;
    this._browserMonGain = null;

    if (this._browserStream) {
      this._browserStream.getTracks().forEach(t => t.stop());
      this._browserStream = null;
    }

    this._browserMonitorMuted = true;
    if (this._activeMode === InputMode.BROWSER) {
      this._activeMode = null;
      appState.set({ isCapturing: false });
    }
  }

  /**
   * Set browser input trim.
   * @param {number} dB - Trim level in dB
   */
  setBrowserTrim(dB) {
    this._browserTrimDb = dB;
    if (this._browserTrimNode) {
      this._browserTrimNode.gain.value = dbToGain(dB);
    }
  }

  /**
   * Set browser monitor level.
   * @param {number} percent - Level 0-100
   * @param {boolean} muted - Mute state
   */
  setBrowserMonitor(percent, muted) {
    this._browserMonitorMuted = muted;
    if (this._browserMonGain) {
      this._browserMonGain.gain.value = muted ? 0 : (percent / 100);
    }
  }

  /**
   * Toggle browser monitor mute.
   * @returns {boolean} New mute state
   */
  toggleBrowserMonitorMute() {
    this._browserMonitorMuted = !this._browserMonitorMuted;
    if (this._browserMonGain) {
      const level = appState.get('browserMonitorLevel') || 20;
      this._browserMonGain.gain.value = this._browserMonitorMuted ? 0 : (level / 100);
    }
    return this._browserMonitorMuted;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API: EXTERNAL DEVICE CAPTURE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start capturing from external audio device.
   *
   * @param {string} [deviceId] - Specific device ID, or default
   * @returns {Promise<MediaStreamTrack>} Audio track
   */
  async startExternalCapture(deviceId) {
    // Stop any existing source first
    this.stopAll();

    const constraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2
      }
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) {
      stream.getTracks().forEach(t => t.stop());
      throw new Error('No audio track available');
    }

    // Force stereo if possible
    try {
      audioTrack.applyConstraints({ advanced: [{ channelCount: 2 }] });
    } catch { /* Ignore if not supported */ }
    audioTrack.contentHint = 'music';

    this._externalStream = stream;
    this._externalSource = this.context.createMediaStreamSource(stream);

    // Trim node for input gain adjustment
    this._externalTrimNode = this.context.createGain();
    this._externalTrimNode.gain.value = dbToGain(this._externalTrimDb);
    this._externalSource.connect(this._externalTrimNode);

    // Splitter to discrete L/R outputs
    this._externalSplit = this.context.createChannelSplitter(2);
    this._externalTrimNode.connect(this._externalSplit);
    this._externalSplit.connect(this.outputL, 0);
    this._externalSplit.connect(this.outputR, 1);

    // Monitor output (muted by default)
    this._externalMonGain = this.context.createGain();
    this._externalMonGain.gain.value = 0;
    this._externalTrimNode.connect(this._externalMonGain);
    this._externalMonGain.connect(this.context.destination);
    this._externalMonitorMuted = true;

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
    [this._externalSource, this._externalTrimNode, this._externalSplit, this._externalMonGain].forEach(n => {
      try { n?.disconnect(); } catch { /* ignore */ }
    });
    this._externalSource = null;
    this._externalTrimNode = null;
    this._externalSplit = null;
    this._externalMonGain = null;

    if (this._externalStream) {
      this._externalStream.getTracks().forEach(t => t.stop());
      this._externalStream = null;
    }

    this._externalMonitorMuted = true;
    if (this._activeMode === InputMode.EXTERNAL) {
      this._activeMode = null;
      appState.set({ isCapturing: false });
    }
  }

  /**
   * Set external input trim.
   * @param {number} dB - Trim level in dB
   */
  setExternalTrim(dB) {
    this._externalTrimDb = dB;
    if (this._externalTrimNode) {
      this._externalTrimNode.gain.value = dbToGain(dB);
    }
  }

  /**
   * Set external monitor level.
   * @param {number} percent - Level 0-100
   * @param {boolean} muted - Mute state
   */
  setExternalMonitor(percent, muted) {
    this._externalMonitorMuted = muted;
    if (this._externalMonGain) {
      this._externalMonGain.gain.value = muted ? 0 : (percent / 100);
    }
  }

  /**
   * Toggle external monitor mute.
   * @returns {boolean} New mute state
   */
  toggleExternalMonitorMute() {
    this._externalMonitorMuted = !this._externalMonitorMuted;
    if (this._externalMonGain) {
      const level = appState.get('externalMonitorLevel') || 20;
      this._externalMonGain.gain.value = this._externalMonitorMuted ? 0 : (level / 100);
    }
    return this._externalMonitorMuted;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API: SIGNAL GENERATOR
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start signal generator with configuration.
   *
   * @param {Object} config - Generator configuration
   * @param {string} config.type - Signal type (sine, pink, white, brown, sweep, glits, lissajous, vector-text)
   * @param {number} [config.freq=400] - Frequency in Hz
   * @param {number} [config.db=-18] - Level in dBFS
   * @param {string} [config.routing='stereo'] - Routing mode
   * @param {number} [config.lo=20] - Low frequency limit
   * @param {number} [config.hi=20000] - High frequency limit
   * @param {number} [config.phase=0] - Phase offset in degrees
   * @param {string} [config.ratio='1:1'] - Frequency ratio for Lissajous
   * @param {number} [config.duration=20] - Sweep duration in seconds
   */
  async startGenerator(config = {}) {
    // Stop any existing source first
    this.stopAll();

    const {
      type = SignalType.SINE,
      freq = 400,
      db = ALIGNMENT_LEVEL_DBFS,
      routing = RoutingMode.STEREO,
      lo = 20,
      hi = 20000,
      phase = 0,
      ratio = '1:1',
      duration = 20
    } = config;

    const amplitude = dbToLinear(db);

    // Create output chain
    this._genGain = this.context.createGain();
    this._genGain.gain.value = amplitude;

    this._genLeftGain = this.context.createGain();
    this._genRightGain = this.context.createGain();
    this._genMerger = this.context.createChannelMerger(2);

    // Apply routing
    this._applyRouting(routing);

    // Create signal based on type
    await this._createSignal(type, { freq, db, lo, hi, phase, ratio, duration, routing, amplitude });

    // Connect to merger
    this._genLeftGain.connect(this._genMerger, 0, 0);
    this._genRightGain.connect(this._genMerger, 0, 1);

    // Monitor output
    this._genMonGain = this.context.createGain();
    const monitorLevel = appState.get('generatorMonitorLevel') || 20;
    this._genMonGain.gain.value = this._genMonitorMuted ? 0 : (monitorLevel / 100);
    this._genMerger.connect(this._genMonGain);
    this._genMonGain.connect(this.context.destination);

    // Analysis output via splitter
    this._genSplit = this.context.createChannelSplitter(2);
    this._genMerger.connect(this._genSplit);
    this._genSplit.connect(this.outputL, 0);
    this._genSplit.connect(this.outputR, 1);

    this._activeMode = InputMode.GENERATOR;

    appState.set({
      inputMode: InputMode.GENERATOR,
      isCapturing: true,
      sampleRate: this.context.sampleRate,
      channelCount: 2
    });
  }

  /**
   * Stop signal generator.
   */
  stopGenerator() {
    this._cleanupGeneratorNodes();

    this._genMerger = null;
    this._genMonGain = null;
    this._genSplit = null;

    if (this._activeMode === InputMode.GENERATOR) {
      this._activeMode = null;
      appState.set({ isCapturing: false });
    }
  }

  /**
   * Switch generator to new preset without full restart.
   * @param {Object} config - New generator configuration
   */
  async switchGeneratorPreset(config) {
    if (this._activeMode !== InputMode.GENERATOR) {
      return this.startGenerator(config);
    }

    // Store monitor state
    const currentMonitorGain = this._genMonGain?.gain.value || 0;

    // Clean up current signal nodes (but not monitor chain)
    this._cleanupGeneratorNodes();

    // Recreate signal with new config
    const {
      type = SignalType.SINE,
      freq = 400,
      db = ALIGNMENT_LEVEL_DBFS,
      routing = RoutingMode.STEREO,
      lo = 20,
      hi = 20000,
      phase = 0,
      ratio = '1:1',
      duration = 20
    } = config;

    const amplitude = dbToLinear(db);

    // Recreate output chain
    this._genGain = this.context.createGain();
    this._genGain.gain.value = amplitude;

    this._genLeftGain = this.context.createGain();
    this._genRightGain = this.context.createGain();
    this._genMerger = this.context.createChannelMerger(2);

    this._applyRouting(routing);
    await this._createSignal(type, { freq, db, lo, hi, phase, ratio, duration, routing, amplitude });

    // Reconnect
    this._genLeftGain.connect(this._genMerger, 0, 0);
    this._genRightGain.connect(this._genMerger, 0, 1);

    // Restore monitor
    this._genMonGain = this.context.createGain();
    this._genMonGain.gain.value = currentMonitorGain;
    this._genMerger.connect(this._genMonGain);
    this._genMonGain.connect(this.context.destination);

    // Reconnect analysis output
    this._genSplit = this.context.createChannelSplitter(2);
    this._genMerger.connect(this._genSplit);
    this._genSplit.connect(this.outputL, 0);
    this._genSplit.connect(this.outputR, 1);
  }

  /**
   * Set generator monitor level.
   * @param {number} percent - Level 0-100
   * @param {boolean} muted - Mute state
   */
  setGeneratorMonitor(percent, muted) {
    this._genMonitorMuted = muted;
    if (this._genMonGain) {
      this._genMonGain.gain.value = muted ? 0 : (percent / 100);
    }
  }

  /**
   * Toggle generator monitor mute.
   * @returns {boolean} New mute state
   */
  toggleGeneratorMonitorMute() {
    this._genMonitorMuted = !this._genMonitorMuted;
    if (this._genMonGain) {
      const level = appState.get('generatorMonitorLevel') || 20;
      this._genMonGain.gain.value = this._genMonitorMuted ? 0 : (level / 100);
    }
    return this._genMonitorMuted;
  }

  /**
   * Set left channel gain for EBU Stereo-ID pulse pattern.
   * Used for 3-second pulse pattern with 250ms mute on left channel.
   * @param {number} value - Gain value (0 or 1)
   * @param {number} [rampTime=0.002] - Ramp time in seconds for click-free transitions
   */
  setLeftChannelGain(value, rampTime = 0.002) {
    if (!this._genLeftGain) return;
    const now = this.context.currentTime;
    this._genLeftGain.gain.setValueAtTime(this._genLeftGain.gain.value, now);
    this._genLeftGain.gain.linearRampToValueAtTime(value, now + rampTime);
  }

  /**
   * Check if generator left gain node is available.
   * @returns {boolean} True if generator is active with left channel control
   */
  hasLeftChannelControl() {
    return this._genLeftGain !== null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API: COMMON
  // ═══════════════════════════════════════════════════════════════════════════

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
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: GENERATOR HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Apply channel routing configuration.
   * @private
   */
  _applyRouting(routing) {
    switch (routing) {
      case RoutingMode.LEFT_ONLY:
        this._genLeftGain.gain.value = 1;
        this._genRightGain.gain.value = 0;
        break;
      case RoutingMode.RIGHT_ONLY:
        this._genLeftGain.gain.value = 0;
        this._genRightGain.gain.value = 1;
        break;
      case RoutingMode.ANTI_PHASE:
        this._genLeftGain.gain.value = 1;
        this._genRightGain.gain.value = -1;
        break;
      default:
        this._genLeftGain.gain.value = 1;
        this._genRightGain.gain.value = 1;
    }
  }

  /**
   * Create signal source based on type.
   * @private
   */
  async _createSignal(type, params) {
    const { freq, amplitude, lo, hi, phase, ratio, duration, routing } = params;

    switch (type) {
      case SignalType.SINE:
        this._createSineSignal(freq);
        break;

      case SignalType.PINK:
      case SignalType.WHITE:
      case SignalType.BROWN:
        this._createNoiseSignal(type, lo, hi, amplitude, routing);
        break;

      case SignalType.SWEEP:
        this._createSweepSignal(lo, hi, duration);
        break;

      case SignalType.GLITS:
        this._createGlitsSignal();
        break;

      case SignalType.LISSAJOUS:
        this._createLissajousSignal(freq, phase, ratio, amplitude);
        break;

      case SignalType.VECTOR_TEXT:
        await this._createVectorTextSignal(amplitude);
        break;

      default:
        // Default to sine
        this._createSineSignal(freq);
    }
  }

  /**
   * Create sine oscillator signal.
   * @private
   */
  _createSineSignal(freq) {
    const { osc } = createSineOscillator(this.context, freq);
    osc.connect(this._genGain);
    osc.start();
    this._genSourceNodes.push(osc);

    this._genGain.connect(this._genLeftGain);
    this._genGain.connect(this._genRightGain);
  }

  /**
   * Create noise source signal.
   * @private
   */
  _createNoiseSignal(type, lo, hi, amplitude, routing) {
    if (routing === RoutingMode.STEREO_UNCORR) {
      // Uncorrelated: separate INDEPENDENT noise for L and R
      // EBU Tech 3341: Each channel must have statistically independent noise
      const noiseL = createNoiseSource(this.context, type, lo, hi, true); // uniqueBuffer=true
      const noiseR = createNoiseSource(this.context, type, lo, hi, true); // uniqueBuffer=true

      const gainL = this.context.createGain();
      const gainR = this.context.createGain();
      gainL.gain.value = amplitude;
      gainR.gain.value = amplitude;

      noiseL.output.connect(gainL);
      noiseR.output.connect(gainR);
      gainL.connect(this._genLeftGain);
      gainR.connect(this._genRightGain);

      noiseL.source.start();
      noiseR.source.start();
      this._genSourceNodes.push(noiseL.source, noiseR.source);
      this._genFilterNodes.push(gainL, gainR);
      if (noiseL.filters) this._genFilterNodes.push(...noiseL.filters);
      if (noiseR.filters) this._genFilterNodes.push(...noiseR.filters);
    } else {
      // Correlated: same noise to both channels
      const noise = createNoiseSource(this.context, type, lo, hi);
      noise.output.connect(this._genGain);
      this._genGain.connect(this._genLeftGain);
      this._genGain.connect(this._genRightGain);
      noise.source.start();
      this._genSourceNodes.push(noise.source);
      if (noise.filters) this._genFilterNodes.push(...noise.filters);
    }
  }

  /**
   * Create sweep oscillator signal.
   * @private
   */
  _createSweepSignal(lo, hi, duration) {
    const sweep = createSweepOscillator(this.context, lo, hi, duration);
    sweep.osc.connect(this._genGain);
    this._genSourceNodes.push(sweep.osc);
    this._activeSweepGenerator = sweep;

    this._genGain.connect(this._genLeftGain);
    this._genGain.connect(this._genRightGain);

    sweep.startSweep();
  }

  /**
   * Create GLITS (EBU Tech 3304) signal.
   * @private
   */
  _createGlitsSignal() {
    const glits = createGlitsOscillator(this.context, this._genLeftGain, this._genRightGain);
    glits.osc.connect(this._genGain);
    this._genSourceNodes.push(glits.osc);
    this._activeGlitsGenerator = glits;

    this._genGain.connect(this._genLeftGain);
    this._genGain.connect(this._genRightGain);

    glits.startGlits();
  }

  /**
   * Create Lissajous pattern signal.
   * @private
   */
  _createLissajousSignal(freq, phase, ratio, amplitude) {
    const { freqL, freqR } = parseFrequencyRatio(freq, ratio);

    if (freqL === freqR && phase !== 0) {
      // Same frequency with phase offset: use single oscillator + delay
      const lissajous = createLissajousWithPhase(this.context, freqL, phase, amplitude);
      lissajous.gainL.connect(this._genLeftGain);
      lissajous.gainR.connect(this._genRightGain);
      lissajous.osc.start();
      this._genSourceNodes.push(lissajous.osc);
      this._genFilterNodes.push(...lissajous.nodes);
    } else {
      // Different frequencies or no phase offset: use two oscillators
      const lissajous = createLissajousDualFreq(this.context, freqL, freqR, amplitude);
      lissajous.gainL.connect(this._genLeftGain);
      lissajous.gainR.connect(this._genRightGain);
      lissajous.oscL.start(lissajous.startTime);
      lissajous.oscR.start(lissajous.startTime);
      this._genSourceNodes.push(lissajous.oscL, lissajous.oscR);
      this._genFilterNodes.push(...lissajous.nodes);
    }
  }

  /**
   * Create THÅST vector text signal.
   * @private
   */
  async _createVectorTextSignal(amplitude) {
    try {
      // Load worklet module if not already loaded
      if (!this._vectorWorkletLoaded) {
        await this.context.audioWorklet.addModule('./src/generators/thast-vector-worklet.js');
        this._vectorWorkletLoaded = true;
      }

      // Create worklet node with configuration
      this._vectorWorkletNode = new AudioWorkletNode(this.context, 'thast-vector-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: {
          pointsPerSecond: 4000,
          outputScale: amplitude,
          resampleStep: 0.025,
          blankingLength: 8,
          normalisationMargin: 0.85
        }
      });

      // Create splitter to route stereo to L/R gains
      const workletSplit = this.context.createChannelSplitter(2);
      this._vectorWorkletNode.connect(workletSplit);
      workletSplit.connect(this._genLeftGain, 0);
      workletSplit.connect(this._genRightGain, 1);

      this._genFilterNodes.push(workletSplit);
    } catch (err) {
      console.error('[SourceController] Vector text generator failed to load:', err);
    }
  }

  /**
   * Clean up generator nodes.
   * @private
   */
  _cleanupGeneratorNodes() {
    // Clean up sweep generator
    if (this._activeSweepGenerator) {
      this._activeSweepGenerator.clearInterval();
      this._activeSweepGenerator = null;
    }

    // Clean up GLITS generator
    if (this._activeGlitsGenerator) {
      this._activeGlitsGenerator.clearInterval();
      this._activeGlitsGenerator = null;
    }

    // Cancel scheduled automation events
    [this._genGain, this._genLeftGain, this._genRightGain, this._genMonGain].forEach(n => {
      try { n?.gain?.cancelScheduledValues(0); } catch { /* ignore */ }
    });

    // Stop and disconnect source nodes
    this._genSourceNodes.forEach(n => {
      try { n.stop?.(); n.disconnect(); } catch { /* ignore */ }
    });

    // Disconnect filter nodes
    this._genFilterNodes.forEach(n => {
      try { n.disconnect(); } catch { /* ignore */ }
    });

    // Disconnect chain nodes
    [this._genGain, this._genLeftGain, this._genRightGain, this._genMerger, this._genMonGain, this._genSplit].forEach(n => {
      try { n?.disconnect(); } catch { /* ignore */ }
    });

    // Clean up vector worklet
    if (this._vectorWorkletNode) {
      try {
        this._vectorWorkletNode.port.postMessage({ type: 'stop' });
        this._vectorWorkletNode.disconnect();
      } catch { /* ignore */ }
      this._vectorWorkletNode = null;
    }

    this._genSourceNodes = [];
    this._genFilterNodes = [];
    this._genGain = null;
    this._genLeftGain = null;
    this._genRightGain = null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: STATE HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle appState changes.
   * @private
   */
  _handleStateChange(state, changed) {
    // Update browser trim
    if (changed.browserTrim && state.inputMode === InputMode.BROWSER) {
      this.setBrowserTrim(state.browserTrim);
    }

    // Update external trim
    if (changed.externalTrim && state.inputMode === InputMode.EXTERNAL) {
      this.setExternalTrim(state.externalTrim);
    }

    // Update browser monitor
    if ((changed.browserMonitorLevel || changed.browserMonitorMuted) && state.inputMode === InputMode.BROWSER) {
      this.setBrowserMonitor(state.browserMonitorLevel, state.browserMonitorMuted);
    }

    // Update external monitor
    if ((changed.externalMonitorLevel || changed.externalMonitorMuted) && state.inputMode === InputMode.EXTERNAL) {
      this.setExternalMonitor(state.externalMonitorLevel, state.externalMonitorMuted);
    }

    // Update generator monitor
    if ((changed.generatorMonitorLevel || changed.generatorMonitorMuted) && state.inputMode === InputMode.GENERATOR) {
      this.setGeneratorMonitor(state.generatorMonitorLevel, state.generatorMonitorMuted);
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
