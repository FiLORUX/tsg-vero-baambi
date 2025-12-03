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
 * RENDER LOOP ORCHESTRATOR
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Coordinates meter updates and canvas rendering at display refresh rate.
 * Manages visibility-based throttling and provides timing utilities.
 *
 * @module app/renderer
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// RENDER LOOP CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Animation frame orchestrator with visibility handling.
 *
 * @example
 * const renderer = new RenderLoop();
 *
 * // Add render callbacks
 * renderer.add('meters', (dt, time) => updateMeters());
 * renderer.add('display', (dt, time) => redrawCanvases());
 *
 * // Start the loop
 * renderer.start();
 */
export class RenderLoop {
  constructor() {
    /** @type {Map<string, RenderCallback>} */
    this._callbacks = new Map();

    /** @type {number|null} */
    this._frameId = null;

    /** @type {boolean} */
    this._running = false;

    /** @type {boolean} */
    this._visible = true;

    /** @type {number} */
    this._lastTime = 0;

    /** @type {number} */
    this._startTime = 0;

    /** @type {number} */
    this._frameCount = 0;

    /** @type {number} */
    this._fps = 0;

    /** @type {number} */
    this._fpsAccum = 0;

    /** @type {number} */
    this._fpsFrames = 0;

    /** @type {number} */
    this._lastFpsUpdate = 0;

    // Bound methods for event handlers
    this._tick = this._tick.bind(this);
    this._onVisibilityChange = this._onVisibilityChange.bind(this);

    // Listen for visibility changes
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._onVisibilityChange);
    }
  }

  /**
   * Add a render callback.
   *
   * @param {string} id - Unique identifier for this callback
   * @param {RenderCallback} callback - Function called each frame
   */
  add(id, callback) {
    this._callbacks.set(id, callback);
  }

  /**
   * Remove a render callback.
   *
   * @param {string} id - Callback identifier
   */
  remove(id) {
    this._callbacks.delete(id);
  }

  /**
   * Start the render loop.
   */
  start() {
    if (this._running) return;

    this._running = true;
    this._startTime = performance.now();
    this._lastTime = this._startTime;
    this._lastFpsUpdate = this._startTime;
    this._frameCount = 0;

    this._scheduleFrame();
  }

  /**
   * Stop the render loop.
   */
  stop() {
    this._running = false;

    if (this._frameId !== null) {
      cancelAnimationFrame(this._frameId);
      this._frameId = null;
    }
  }

  /**
   * Check if loop is running.
   *
   * @returns {boolean}
   */
  get running() {
    return this._running;
  }

  /**
   * Get current FPS.
   *
   * @returns {number}
   */
  get fps() {
    return this._fps;
  }

  /**
   * Get total frame count since start.
   *
   * @returns {number}
   */
  get frameCount() {
    return this._frameCount;
  }

  /**
   * Get elapsed time since start in milliseconds.
   *
   * @returns {number}
   */
  get elapsed() {
    return this._lastTime - this._startTime;
  }

  /**
   * Check if document is visible.
   *
   * @returns {boolean}
   */
  get visible() {
    return this._visible;
  }

  /**
   * Dispose and clean up.
   */
  dispose() {
    this.stop();
    this._callbacks.clear();

    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
    }
  }

  /**
   * @private
   */
  _tick(now) {
    if (!this._running) return;

    const dt = now - this._lastTime;
    this._lastTime = now;
    this._frameCount++;

    // Update FPS every 500ms
    this._fpsFrames++;
    this._fpsAccum += dt;
    if (now - this._lastFpsUpdate >= 500) {
      this._fps = Math.round((this._fpsFrames * 1000) / this._fpsAccum);
      this._fpsFrames = 0;
      this._fpsAccum = 0;
      this._lastFpsUpdate = now;
    }

    // Call all render callbacks
    for (const callback of this._callbacks.values()) {
      try {
        callback(dt, now);
      } catch (e) {
        console.error('[RenderLoop] Callback error:', e);
      }
    }

    this._scheduleFrame();
  }

  /**
   * @private
   */
  _scheduleFrame() {
    if (this._running && this._visible) {
      this._frameId = requestAnimationFrame(this._tick);
    }
  }

  /**
   * @private
   */
  _onVisibilityChange() {
    this._visible = document.visibilityState === 'visible';

    if (this._visible && this._running) {
      // Resume after becoming visible
      this._lastTime = performance.now();
      this._scheduleFrame();
    }
  }
}

/**
 * @callback RenderCallback
 * @param {number} dt - Delta time since last frame in ms
 * @param {number} now - Current timestamp from performance.now()
 */

// ─────────────────────────────────────────────────────────────────────────────
// METER RENDERER CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Coordinates all meter components with audio data.
 *
 * @example
 * const meterRenderer = new MeterRenderer({
 *   analyserL,
 *   analyserR,
 *   kWeightedL,
 *   kWeightedR
 * });
 *
 * // Add meter components
 * meterRenderer.addMeter('lufs', lufsMeter);
 * meterRenderer.addMeter('truePeak', truePeakMeter);
 *
 * // Add display components
 * meterRenderer.addDisplay('radar', radarDisplay);
 *
 * // In render loop
 * renderLoop.add('meters', (dt) => meterRenderer.update(dt));
 */
export class MeterRenderer {
  /**
   * @param {Object} options - Configuration
   * @param {AnalyserNode} options.analyserL - Left channel analyser
   * @param {AnalyserNode} options.analyserR - Right channel analyser
   * @param {AnalyserNode} [options.kWeightedL] - K-weighted left analyser
   * @param {AnalyserNode} [options.kWeightedR] - K-weighted right analyser
   */
  constructor({ analyserL, analyserR, kWeightedL, kWeightedR }) {
    this.analyserL = analyserL;
    this.analyserR = analyserR;
    this.kWeightedL = kWeightedL || analyserL;
    this.kWeightedR = kWeightedR || analyserR;

    // Pre-allocate buffers
    const fftSize = analyserL.fftSize;
    this.bufferL = new Float32Array(fftSize);
    this.bufferR = new Float32Array(fftSize);
    this.kBufferL = new Float32Array(fftSize);
    this.kBufferR = new Float32Array(fftSize);

    /** @type {Map<string, MeterComponent>} */
    this._meters = new Map();

    /** @type {Map<string, DisplayComponent>} */
    this._displays = new Map();

    /** @type {MeterReadings} */
    this._readings = {
      peakL: -60,
      peakR: -60,
      truePeakL: -60,
      truePeakR: -60,
      truePeakHoldL: -60,
      truePeakHoldR: -60,
      ppmL: -60,
      ppmR: -60,
      ppmHoldL: -60,
      ppmHoldR: -60,
      momentaryLufs: -Infinity,
      shortTermLufs: -Infinity,
      integratedLufs: -Infinity,
      lra: null,
      correlation: 0,
      balance: 0,
      width: 0
    };
  }

  /**
   * Add a metering component.
   *
   * @param {string} id - Component identifier
   * @param {MeterComponent} meter - Meter instance with update() method
   */
  addMeter(id, meter) {
    this._meters.set(id, meter);
  }

  /**
   * Add a display component.
   *
   * @param {string} id - Component identifier
   * @param {DisplayComponent} display - Display instance with draw() method
   */
  addDisplay(id, display) {
    this._displays.set(id, display);
  }

  /**
   * Remove a component.
   *
   * @param {string} id - Component identifier
   */
  remove(id) {
    this._meters.delete(id);
    this._displays.delete(id);
  }

  /**
   * Get current meter readings.
   *
   * @returns {MeterReadings}
   */
  get readings() {
    return { ...this._readings };
  }

  /**
   * Update all meters with current audio data.
   *
   * @param {number} dt - Delta time in ms
   */
  update(dt) {
    // Get audio data
    this.analyserL.getFloatTimeDomainData(this.bufferL);
    this.analyserR.getFloatTimeDomainData(this.bufferR);
    this.kWeightedL.getFloatTimeDomainData(this.kBufferL);
    this.kWeightedR.getFloatTimeDomainData(this.kBufferR);

    // Update meters
    for (const meter of this._meters.values()) {
      if (typeof meter.update === 'function') {
        meter.update(this.bufferL, this.bufferR, this.kBufferL, this.kBufferR, dt);
      }
    }

    // Collect readings from meters
    this._collectReadings();
  }

  /**
   * Render all display components.
   */
  render() {
    for (const display of this._displays.values()) {
      if (typeof display.render === 'function') {
        display.render(this._readings);
      } else if (typeof display.draw === 'function') {
        display.draw(this._readings);
      }
    }
  }

  /**
   * Update and render in one call.
   *
   * @param {number} dt - Delta time in ms
   */
  frame(dt) {
    this.update(dt);
    this.render();
  }

  /**
   * Reset all meters.
   */
  reset() {
    for (const meter of this._meters.values()) {
      if (typeof meter.reset === 'function') {
        meter.reset();
      }
    }
  }

  /**
   * @private
   */
  _collectReadings() {
    // Collect from each meter type
    for (const [id, meter] of this._meters) {
      if (typeof meter.getState === 'function') {
        const state = meter.getState();

        switch (id) {
          case 'truePeak':
            this._readings.truePeakL = state.dbtpLeft;
            this._readings.truePeakR = state.dbtpRight;
            this._readings.truePeakHoldL = state.dbtpHoldLeft;
            this._readings.truePeakHoldR = state.dbtpHoldRight;
            break;

          case 'ppm':
            this._readings.ppmL = state.dbfsLeft;
            this._readings.ppmR = state.dbfsRight;
            this._readings.ppmHoldL = state.dbfsHoldLeft;
            this._readings.ppmHoldR = state.dbfsHoldRight;
            break;

          case 'stereo':
            this._readings.correlation = state.correlation;
            this._readings.balance = state.balance;
            this._readings.width = state.width;
            break;
        }
      }

      if (typeof meter.getReadings === 'function') {
        const readings = meter.getReadings();
        if ('momentary' in readings) {
          this._readings.momentaryLufs = readings.momentary;
          this._readings.shortTermLufs = readings.shortTerm;
          this._readings.integratedLufs = readings.integrated;
          this._readings.lra = readings.lra;
        }
      }
    }
  }
}

/**
 * @typedef {Object} MeterReadings
 * @property {number} peakL - Left peak in dBFS
 * @property {number} peakR - Right peak in dBFS
 * @property {number} truePeakL - Left True Peak in dBTP
 * @property {number} truePeakR - Right True Peak in dBTP
 * @property {number} truePeakHoldL - Left True Peak hold
 * @property {number} truePeakHoldR - Right True Peak hold
 * @property {number} ppmL - Left PPM in dBFS
 * @property {number} ppmR - Right PPM in dBFS
 * @property {number} ppmHoldL - Left PPM hold
 * @property {number} ppmHoldR - Right PPM hold
 * @property {number} momentaryLufs - Momentary loudness in LUFS
 * @property {number} shortTermLufs - Short-term loudness in LUFS
 * @property {number} integratedLufs - Integrated loudness in LUFS
 * @property {number|null} lra - Loudness Range in LU
 * @property {number} correlation - Phase correlation (-1 to +1)
 * @property {number} balance - L/R balance (-1 to +1)
 * @property {number} width - Stereo width (0+)
 */

/**
 * @typedef {Object} MeterComponent
 * @property {function(Float32Array, Float32Array, Float32Array, Float32Array, number): void} update
 * @property {function(): Object} [getState]
 * @property {function(): Object} [getReadings]
 * @property {function(): void} [reset]
 */

/**
 * @typedef {Object} DisplayComponent
 * @property {function(MeterReadings): void} [render]
 * @property {function(MeterReadings): void} [draw]
 */

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON INSTANCE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shared render loop instance.
 * @type {RenderLoop}
 */
export const renderLoop = new RenderLoop();
