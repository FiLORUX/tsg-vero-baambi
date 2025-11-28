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
 * VERO-BAAMBI MAIN MODULE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PHASE 3: AUDIO ENGINE & UTILITIES
 * ──────────────────────────────────
 * Foundation modules for audio processing and UI:
 *   - AudioEngine class for Web Audio management
 *   - Utility functions (math, formatting, DOM)
 *   - Color schemes for meter displays
 *
 * ARCHITECTURE OVERVIEW
 * ─────────────────────
 *   index.html
 *       │
 *       └─► src/main.js (this file)
 *               │
 *               ├─► config/storage.js    - LocalStorage versioning
 *               ├─► remote/types.js      - Metrics schema (probe/client)
 *               ├─► metering/            - EBU R128, LUFS, True Peak, PPM
 *               ├─► stereo/              - Phase correlation
 *               ├─► audio/               - AudioContext, worklets
 *               │   └─► engine.js        - AudioEngine class
 *               ├─► ui/                  - Display components
 *               │   └─► colors.js        - Meter color schemes
 *               └─► utils/               - Shared utilities
 *                   ├─► format.js        - Display formatting
 *                   ├─► math.js          - Math utilities
 *                   └─► dom.js           - DOM helpers
 *
 * @module main
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import.meta
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { STORAGE_VERSION, migrateStorage } from './config/storage.js';

// Metering modules
import {
  LUFSMeter,
  TruePeakMeter,
  PPMMeter,
  createStereoKWeightingFilters,
  DEFAULT_TARGET_LUFS,
  TP_LIMIT_EBU,
  formatLUFS,
  formatTruePeak,
  formatPPM
} from './metering/index.js';

// Stereo analysis
import {
  StereoMeter,
  formatCorrelation,
  getCorrelationZone
} from './stereo/index.js';

// Audio engine
import {
  AudioEngine,
  getAudioInputDevices
} from './audio/index.js';

// Utilities
import {
  formatDb,
  formatTime,
  clamp,
  dbToGain,
  createAnimationLoop
} from './utils/index.js';

// UI colors
import {
  DEFAULT_COLORS,
  getLoudnessColor,
  getCorrelationColor
} from './ui/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// MODULE-LEVEL CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base URL for resolving relative paths within the module.
 * Critical for AudioWorklet registration and dynamic imports.
 * @type {URL}
 */
const MODULE_BASE = new URL('.', import.meta.url);

/**
 * AudioWorklet processor path, resolved relative to module location.
 * @type {string}
 */
const WORKLET_PATH = new URL('../external-meter-processor.js', import.meta.url).href;

/**
 * Application version for cache busting and diagnostics.
 * @type {string}
 */
export const APP_VERSION = '2.0.0-phase3';

// ─────────────────────────────────────────────────────────────────────────────
// APPLICATION STATE
// ─────────────────────────────────────────────────────────────────────────────

/** @type {AudioContext|null} */
let audioContext = null;

/** @type {boolean} */
let isInitialized = false;

/** @type {Object|null} - Meter instances for demo */
let meters = null;

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialize the VERO-BAAMBI application.
 *
 * @param {Object} options - Initialization options
 * @param {HTMLElement} options.mountElement - DOM element to mount app into
 * @param {HTMLElement} [options.loadingElement] - Loading indicator to hide
 * @returns {Promise<void>}
 *
 * @example
 * import { initApp } from './src/main.js';
 * await initApp({
 *   mountElement: document.getElementById('app'),
 *   loadingElement: document.getElementById('loading')
 * });
 */
export async function initApp({ mountElement, loadingElement }) {
  if (isInitialized) {
    console.warn('[VERO-BAAMBI] Already initialized');
    return;
  }

  console.log(`[VERO-BAAMBI] Initializing v${APP_VERSION}`);
  console.log(`[VERO-BAAMBI] Storage version: ${STORAGE_VERSION}`);
  console.log(`[VERO-BAAMBI] Module base: ${MODULE_BASE.href}`);
  console.log(`[VERO-BAAMBI] Worklet path: ${WORKLET_PATH}`);

  // ─────────────────────────────────────────────────────────────────────────
  // STORAGE MIGRATION
  // ─────────────────────────────────────────────────────────────────────────
  migrateStorage();

  // ─────────────────────────────────────────────────────────────────────────
  // VERIFY MODULE IMPORTS
  // ─────────────────────────────────────────────────────────────────────────
  console.log('[VERO-BAAMBI] Verifying metering modules...');
  console.log('  - LUFSMeter:', typeof LUFSMeter);
  console.log('  - TruePeakMeter:', typeof TruePeakMeter);
  console.log('  - PPMMeter:', typeof PPMMeter);
  console.log('  - StereoMeter:', typeof StereoMeter);
  console.log('  - createStereoKWeightingFilters:', typeof createStereoKWeightingFilters);

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 2: Metering modules loaded, UI integration in Phase 3+
  // ─────────────────────────────────────────────────────────────────────────

  // Render Phase 2 UI with module verification
  renderPhase2UI(mountElement);

  // Hide loading indicator
  if (loadingElement) {
    loadingElement.classList.add('hidden');
  }

  // Show app
  mountElement.classList.add('ready');

  isInitialized = true;
  console.log('[VERO-BAAMBI] Initialization complete');
}

/**
 * Get the AudioWorklet processor path.
 * Uses import.meta.url for reliable resolution across deployment scenarios.
 *
 * @returns {string} Absolute URL to the AudioWorklet processor
 */
export function getWorkletPath() {
  return WORKLET_PATH;
}

/**
 * Get the module base URL.
 *
 * @returns {string} Base URL of the module
 */
export function getModuleBase() {
  return MODULE_BASE.href;
}

// Re-export classes for external use
export {
  // Metering
  LUFSMeter,
  TruePeakMeter,
  PPMMeter,
  StereoMeter,
  createStereoKWeightingFilters,
  // Audio
  AudioEngine,
  // Utilities
  formatDb,
  formatTime,
  clamp,
  dbToGain,
  // Colors
  DEFAULT_COLORS,
  getLoudnessColor
};

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render Phase 3 UI showing all extracted modules.
 *
 * @param {HTMLElement} container - Mount element
 * @private
 */
function renderPhase2UI(container) {
  const modules = [
    { name: 'K-weighting', status: 'ok', desc: 'ITU-R BS.1770-4 pre-filter' },
    { name: 'LUFSMeter', status: 'ok', desc: 'EBU R128 loudness measurement' },
    { name: 'TruePeakMeter', status: 'ok', desc: '4× oversampling peak detection' },
    { name: 'PPMMeter', status: 'ok', desc: 'IEC 60268-10 Type I ballistics' },
    { name: 'StereoMeter', status: 'ok', desc: 'Phase correlation analysis' },
    { name: 'AudioEngine', status: 'ok', desc: 'Web Audio context management' },
    { name: 'utils/format', status: 'ok', desc: 'Fixed-width display formatting' },
    { name: 'utils/math', status: 'ok', desc: 'dB conversion, smoothing, stats' },
    { name: 'utils/dom', status: 'ok', desc: 'Canvas DPI, animation loops' },
    { name: 'ui/colors', status: 'ok', desc: 'Meter color schemes (RTW-style)' },
  ];

  const moduleList = modules.map(m => `
    <div style="
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 0;
      border-bottom: 1px solid #1a2744;
    ">
      <span style="color: #00d4aa;">✓</span>
      <span style="flex: 1; font-weight: 500;">${m.name}</span>
      <span style="opacity: 0.6; font-size: 0.75rem;">${m.desc}</span>
    </div>
  `).join('');

  container.innerHTML = `
    <div style="
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 2rem;
      gap: 2rem;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #e0e0e0;
    ">
      <h1 style="
        font-size: 2rem;
        font-weight: 300;
        letter-spacing: 0.2em;
        color: #00d4aa;
      ">VERO-BAAMBI</h1>

      <div style="
        background: #16213e;
        border: 1px solid #0f3460;
        border-radius: 8px;
        padding: 2rem;
        max-width: 600px;
        width: 100%;
      ">
        <h2 style="
          font-size: 1rem;
          font-weight: 500;
          margin-bottom: 1rem;
          color: #00d4aa;
          text-align: center;
        ">Phase 3: Audio Engine & Utilities</h2>

        <div style="margin-bottom: 1.5rem;">
          ${moduleList}
        </div>

        <p style="
          font-size: 0.875rem;
          line-height: 1.6;
          opacity: 0.8;
          margin-bottom: 1.5rem;
          text-align: center;
        ">
          Core metering algorithms extracted as ES modules.
          <br>UI integration will be completed in Phase 3.
        </p>

        <div style="
          display: flex;
          gap: 1rem;
          justify-content: center;
          flex-wrap: wrap;
        ">
          <a href="audio-meters-grid.html" style="
            display: inline-block;
            padding: 0.75rem 1.5rem;
            background: #00d4aa;
            color: #1a1a2e;
            text-decoration: none;
            border-radius: 4px;
            font-weight: 500;
            font-size: 0.875rem;
          ">Launch Full Meter (Legacy)</a>

          <button onclick="testWorkletPath()" style="
            padding: 0.75rem 1.5rem;
            background: transparent;
            color: #00d4aa;
            border: 1px solid #00d4aa;
            border-radius: 4px;
            font-weight: 500;
            font-size: 0.875rem;
            cursor: pointer;
          ">Test AudioWorklet</button>

          <button onclick="testMeteringModules()" style="
            padding: 0.75rem 1.5rem;
            background: transparent;
            color: #00d4aa;
            border: 1px solid #00d4aa;
            border-radius: 4px;
            font-weight: 500;
            font-size: 0.875rem;
            cursor: pointer;
          ">Test Metering</button>
        </div>

        <pre id="test-result" style="
          margin-top: 1.5rem;
          padding: 1rem;
          background: #0d1b2a;
          border-radius: 4px;
          font-size: 0.75rem;
          text-align: left;
          overflow-x: auto;
          display: none;
          white-space: pre-wrap;
        "></pre>
      </div>

      <p style="
        font-size: 0.75rem;
        opacity: 0.5;
      ">
        Storage v${STORAGE_VERSION} · Module v${APP_VERSION} · Target: ${DEFAULT_TARGET_LUFS} LUFS · TP Limit: ${TP_LIMIT_EBU} dBTP
      </p>
    </div>
  `;

  // Test AudioWorklet path
  window.testWorkletPath = async function() {
    const result = document.getElementById('test-result');
    result.style.display = 'block';
    result.textContent = 'Testing AudioWorklet path...';

    try {
      const ctx = new AudioContext();
      await ctx.audioWorklet.addModule(WORKLET_PATH);
      result.style.color = '#00d4aa';
      result.textContent = '✓ AudioWorklet loaded successfully\n\nPath: ' + WORKLET_PATH;
      await ctx.close();
    } catch (error) {
      result.style.color = '#ff6b6b';
      result.textContent = '✗ AudioWorklet failed to load\n\nPath: ' + WORKLET_PATH + '\n\nError: ' + error.message;
    }
  };

  // Test metering modules with synthetic data
  window.testMeteringModules = function() {
    const result = document.getElementById('test-result');
    result.style.display = 'block';
    result.style.color = '#e0e0e0';

    try {
      // Create test buffers (1kHz sine wave at -23 dBFS)
      const sampleRate = 48000;
      const blockSize = 2048;
      const amplitude = Math.pow(10, -23 / 20); // -23 dBFS

      const testBufferL = new Float32Array(blockSize);
      const testBufferR = new Float32Array(blockSize);

      for (let i = 0; i < blockSize; i++) {
        const t = i / sampleRate;
        const sample = amplitude * Math.sin(2 * Math.PI * 1000 * t);
        testBufferL[i] = sample;
        testBufferR[i] = sample; // Mono signal
      }

      // Test LUFS meter
      const lufsMeter = new LUFSMeter({ sampleRate, blockSize });
      const energy = lufsMeter.calculateBlockEnergy(testBufferL, testBufferR);
      lufsMeter.pushBlock(energy);
      const lufsReadings = lufsMeter.getReadings();

      // Test True Peak meter
      const tpMeter = new TruePeakMeter();
      tpMeter.update(testBufferL, testBufferR);
      const tpState = tpMeter.getState();

      // Test PPM meter
      const ppmMeter = new PPMMeter({ sampleRate });
      ppmMeter.update(testBufferL, testBufferR);
      const ppmState = ppmMeter.getState();

      // Test Stereo meter
      const stereoMeter = new StereoMeter();
      stereoMeter.update(testBufferL, testBufferR);
      const stereoState = stereoMeter.getState();

      result.innerHTML = `<span style="color:#00d4aa">✓ All metering modules working</span>

<b>Test Signal:</b> 1kHz sine @ -23 dBFS (mono)

<b>LUFS Meter:</b>
  Momentary: ${formatLUFS(lufsReadings.momentary)}
  (Expected: ~-23 LUFS for K-weighted sine)

<b>True Peak:</b>
  Left:  ${formatTruePeak(tpState.left)}
  Right: ${formatTruePeak(tpState.right)}

<b>PPM:</b>
  Left:  ${formatPPM(ppmState.ppmL)}
  Right: ${formatPPM(ppmState.ppmR)}

<b>Stereo:</b>
  Correlation: ${formatCorrelation(stereoState.correlation)} (${getCorrelationZone(stereoState.correlation)})
  (Expected: +1.00 for mono signal)`;

    } catch (error) {
      result.style.color = '#ff6b6b';
      result.textContent = '✗ Metering test failed\n\nError: ' + error.message + '\n\nStack: ' + error.stack;
    }
  };
}
