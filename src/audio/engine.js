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
 * AUDIO ENGINE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * ───────
 * Centralized management of Web Audio API resources:
 * - AudioContext lifecycle (create, suspend, resume, close)
 * - AudioWorklet registration
 * - Analyser node creation with proper FFT settings
 * - Source management (microphone, external devices, test tone)
 *
 * DESIGN PRINCIPLES
 * ─────────────────
 * - Single AudioContext instance per engine
 * - Automatic state management (suspend on blur, resume on focus)
 * - Clean resource disposal
 * - Event-driven status updates
 *
 * @module audio/engine
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default FFT size for analysers.
 * 2048 provides good balance of frequency resolution and latency.
 * @type {number}
 */
export const DEFAULT_FFT_SIZE = 2048;

/**
 * Default smoothing time constant for analysers.
 * 0 = no smoothing (immediate response)
 * @type {number}
 */
export const DEFAULT_SMOOTHING = 0;

/**
 * Preferred sample rate for professional audio.
 * @type {number}
 */
export const PREFERRED_SAMPLE_RATE = 48000;

// ─────────────────────────────────────────────────────────────────────────────
// AUDIO ENGINE CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Audio Engine for managing Web Audio resources.
 *
 * @example
 * const engine = new AudioEngine({
 *   workletPath: './external-meter-processor.js'
 * });
 *
 * await engine.initialize();
 * const { left, right } = engine.createStereoAnalysers();
 * await engine.connectMicrophone();
 */
export class AudioEngine {
  /**
   * @param {Object} options - Configuration options
   * @param {string} [options.workletPath] - Path to AudioWorklet processor
   * @param {number} [options.sampleRate] - Preferred sample rate
   * @param {number} [options.fftSize=DEFAULT_FFT_SIZE] - Default FFT size
   */
  constructor({
    workletPath,
    sampleRate,
    fftSize = DEFAULT_FFT_SIZE
  } = {}) {
    this.workletPath = workletPath;
    this.preferredSampleRate = sampleRate;
    this.defaultFftSize = fftSize;

    /** @type {AudioContext|null} */
    this.context = null;

    /** @type {boolean} */
    this.workletLoaded = false;

    /** @type {MediaStream|null} */
    this.currentStream = null;

    /** @type {MediaStreamAudioSourceNode|null} */
    this.currentSource = null;

    /** @type {Set<AudioNode>} */
    this.activeNodes = new Set();

    /** @type {function[]} */
    this.stateListeners = [];

    // Bind methods for event handlers
    this._handleVisibilityChange = this._handleVisibilityChange.bind(this);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // LIFECYCLE
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Initialise the audio engine.
   * Creates AudioContext and loads AudioWorklet if specified.
   *
   * @returns {Promise<void>}
   */
  async initialise() {
    if (this.context) {
      console.warn('[AudioEngine] Already initialised');
      return;
    }

    // Create AudioContext with preferred sample rate
    const options = {};
    if (this.preferredSampleRate) {
      options.sampleRate = this.preferredSampleRate;
    }

    this.context = new AudioContext(options);
    console.log(`[AudioEngine] Created context @ ${this.context.sampleRate}Hz`);

    // Load AudioWorklet if path specified
    if (this.workletPath) {
      try {
        await this.context.audioWorklet.addModule(this.workletPath);
        this.workletLoaded = true;
        console.log('[AudioEngine] AudioWorklet loaded:', this.workletPath);
      } catch (error) {
        console.error('[AudioEngine] Failed to load AudioWorklet:', error);
        throw error;
      }
    }

    // Set up visibility change handler for power management
    document.addEventListener('visibilitychange', this._handleVisibilityChange);

    this._notifyStateChange();
  }

  /**
   * Resume audio context if suspended.
   * Call this in response to user interaction.
   *
   * @returns {Promise<void>}
   */
  async resume() {
    if (!this.context) {
      throw new Error('AudioEngine not initialised');
    }

    if (this.context.state === 'suspended') {
      await this.context.resume();
      console.log('[AudioEngine] Resumed');
      this._notifyStateChange();
    }
  }

  /**
   * Suspend audio context to save power.
   *
   * @returns {Promise<void>}
   */
  async suspend() {
    if (this.context && this.context.state === 'running') {
      await this.context.suspend();
      console.log('[AudioEngine] Suspended');
      this._notifyStateChange();
    }
  }

  /**
   * Dispose of all resources and close context.
   *
   * @returns {Promise<void>}
   */
  async dispose() {
    // Stop current stream
    this.disconnectSource();

    // Disconnect all tracked nodes
    for (const node of this.activeNodes) {
      try {
        node.disconnect();
      } catch (e) {
        // Ignore disconnect errors
      }
    }
    this.activeNodes.clear();

    // Close context
    if (this.context) {
      await this.context.close();
      this.context = null;
      console.log('[AudioEngine] Disposed');
    }

    // Remove event listener
    document.removeEventListener('visibilitychange', this._handleVisibilityChange);

    this.workletLoaded = false;
    this._notifyStateChange();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ANALYSER CREATION
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Create an analyser node with metering-optimized settings.
   *
   * @param {Object} [options] - Analyser options
   * @param {number} [options.fftSize] - FFT size (default from constructor)
   * @param {number} [options.smoothing=0] - Smoothing time constant
   * @returns {AnalyserNode} Configured analyser node
   */
  createAnalyser({ fftSize, smoothing = DEFAULT_SMOOTHING } = {}) {
    if (!this.context) {
      throw new Error('AudioEngine not initialised');
    }

    const analyser = this.context.createAnalyser();
    analyser.fftSize = fftSize ?? this.defaultFftSize;
    analyser.smoothingTimeConstant = smoothing;

    this.activeNodes.add(analyser);
    return analyser;
  }

  /**
   * Create a pair of stereo analysers.
   *
   * @param {Object} [options] - Analyser options
   * @returns {{left: AnalyserNode, right: AnalyserNode, splitter: ChannelSplitterNode}}
   */
  createStereoAnalysers(options = {}) {
    if (!this.context) {
      throw new Error('AudioEngine not initialised');
    }

    const splitter = this.context.createChannelSplitter(2);
    const left = this.createAnalyser(options);
    const right = this.createAnalyser(options);

    splitter.connect(left, 0);
    splitter.connect(right, 1);

    this.activeNodes.add(splitter);

    return { left, right, splitter };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // SOURCE CONNECTION
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Connect microphone input.
   *
   * @param {string} [deviceId] - Specific device ID, or default
   * @returns {Promise<MediaStreamAudioSourceNode>} Source node
   */
  async connectMicrophone(deviceId) {
    this.disconnectSource();

    const constraints = {
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {})
      }
    };

    try {
      this.currentStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.currentSource = this.context.createMediaStreamSource(this.currentStream);
      this.activeNodes.add(this.currentSource);

      console.log('[AudioEngine] Microphone connected');
      this._notifyStateChange();

      return this.currentSource;
    } catch (error) {
      console.error('[AudioEngine] Microphone connection failed:', error);
      throw error;
    }
  }

  /**
   * Connect a MediaStream source (e.g., screen capture, external device).
   *
   * @param {MediaStream} stream - Media stream to connect
   * @returns {MediaStreamAudioSourceNode} Source node
   */
  connectStream(stream) {
    this.disconnectSource();

    this.currentStream = stream;
    this.currentSource = this.context.createMediaStreamSource(stream);
    this.activeNodes.add(this.currentSource);

    console.log('[AudioEngine] Stream connected');
    this._notifyStateChange();

    return this.currentSource;
  }

  /**
   * Disconnect current source and stop stream.
   */
  disconnectSource() {
    if (this.currentSource) {
      this.currentSource.disconnect();
      this.activeNodes.delete(this.currentSource);
      this.currentSource = null;
    }

    if (this.currentStream) {
      for (const track of this.currentStream.getTracks()) {
        track.stop();
      }
      this.currentStream = null;
    }

    this._notifyStateChange();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST TONE GENERATOR
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Create a test tone oscillator.
   *
   * @param {Object} [options] - Tone options
   * @param {number} [options.frequency=1000] - Frequency in Hz
   * @param {string} [options.type='sine'] - Waveform type
   * @param {number} [options.gain=-18] - Gain in dB
   * @returns {{oscillator: OscillatorNode, gainNode: GainNode, start: function, stop: function}}
   */
  createTestTone({
    frequency = 1000,
    type = 'sine',
    gain = -18
  } = {}) {
    if (!this.context) {
      throw new Error('AudioEngine not initialised');
    }

    const oscillator = this.context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.value = frequency;

    const gainNode = this.context.createGain();
    gainNode.gain.value = Math.pow(10, gain / 20);

    oscillator.connect(gainNode);

    this.activeNodes.add(oscillator);
    this.activeNodes.add(gainNode);

    return {
      oscillator,
      gainNode,
      output: gainNode,

      start() {
        oscillator.start();
      },

      stop() {
        oscillator.stop();
      },

      setFrequency(freq) {
        oscillator.frequency.value = freq;
      },

      setGain(dB) {
        gainNode.gain.value = Math.pow(10, dB / 20);
      }
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // WORKLET NODE CREATION
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Create an AudioWorkletNode.
   *
   * @param {string} processorName - Registered processor name
   * @param {Object} [options] - AudioWorkletNode options
   * @returns {AudioWorkletNode} Worklet node
   */
  createWorkletNode(processorName, options = {}) {
    if (!this.context) {
      throw new Error('AudioEngine not initialised');
    }

    if (!this.workletLoaded) {
      throw new Error('AudioWorklet not loaded');
    }

    const node = new AudioWorkletNode(this.context, processorName, options);
    this.activeNodes.add(node);

    return node;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STATE & EVENTS
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Get current engine state.
   *
   * @returns {AudioEngineState} Current state
   */
  getState() {
    return {
      initialized: !!this.context,
      contextState: this.context?.state ?? 'closed',
      sampleRate: this.context?.sampleRate ?? 0,
      workletLoaded: this.workletLoaded,
      hasSource: !!this.currentSource,
      currentTime: this.context?.currentTime ?? 0
    };
  }

  /**
   * Add state change listener.
   *
   * @param {function(AudioEngineState): void} listener - Callback
   * @returns {function} Unsubscribe function
   */
  onStateChange(listener) {
    this.stateListeners.push(listener);
    return () => {
      const idx = this.stateListeners.indexOf(listener);
      if (idx >= 0) this.stateListeners.splice(idx, 1);
    };
  }

  /**
   * @private
   */
  _notifyStateChange() {
    const state = this.getState();
    for (const listener of this.stateListeners) {
      try {
        listener(state);
      } catch (e) {
        console.error('[AudioEngine] State listener error:', e);
      }
    }
  }

  /**
   * @private
   */
  _handleVisibilityChange() {
    // Optional: suspend/resume based on visibility
    // Uncomment to save power when tab is hidden:
    // if (document.hidden) {
    //   this.suspend();
    // } else {
    //   this.resume();
    // }
  }

  /**
   * Alias for backwards compatibility.
   * @deprecated Use initialise() instead
   */
  async initialize() {
    return this.initialise();
  }
}

/**
 * @typedef {Object} AudioEngineState
 * @property {boolean} initialized - Whether engine is initialised
 * @property {string} contextState - AudioContext state ('running', 'suspended', 'closed')
 * @property {number} sampleRate - Current sample rate
 * @property {boolean} workletLoaded - Whether AudioWorklet is loaded
 * @property {boolean} hasSource - Whether a source is connected
 * @property {number} currentTime - AudioContext currentTime
 */

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE ENUMERATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get list of available audio input devices.
 *
 * @returns {Promise<MediaDeviceInfo[]>} Array of audio input devices
 */
export async function getAudioInputDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(d => d.kind === 'audioinput');
}

/**
 * Get list of available audio output devices.
 *
 * @returns {Promise<MediaDeviceInfo[]>} Array of audio output devices
 */
export async function getAudioOutputDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(d => d.kind === 'audiooutput');
}

/**
 * Request microphone permission and return device list.
 * Permission is required before device labels are available.
 *
 * @returns {Promise<MediaDeviceInfo[]>} Array of audio input devices with labels
 */
export async function requestMicrophonePermission() {
  // Request permission with a temporary stream
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  // Stop the stream immediately
  for (const track of stream.getTracks()) {
    track.stop();
  }

  // Now we can get device labels
  return getAudioInputDevices();
}
