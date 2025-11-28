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
 * PHASE 1: FACADE WRAPPER
 * ───────────────────────
 * This module serves as the entry point for the modular ESM architecture.
 * In Phase 1, it provides a thin facade over the legacy implementation while
 * establishing the module structure for incremental extraction.
 *
 * ARCHITECTURE OVERVIEW
 * ─────────────────────
 *   index.html
 *       │
 *       └─► src/main.js (this file)
 *               │
 *               ├─► config/storage.js    - LocalStorage versioning
 *               ├─► remote/types.js      - Metrics schema (probe/client)
 *               ├─► metering/            - EBU R128, LUFS, True Peak
 *               ├─► audio/               - AudioContext, worklets
 *               ├─► stereo/              - Correlation, phase meters
 *               ├─► ui/                  - DOM rendering, animations
 *               └─► utils/               - Shared utilities
 *
 * AUDIOWORKLET PATH RESOLUTION
 * ────────────────────────────
 * AudioWorklet modules must be loaded via URL, not imported as ESM.
 * Using import.meta.url ensures correct path resolution regardless of
 * how the application is deployed (file://, http://, subdirectory, etc.)
 *
 * @module main
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import.meta
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { STORAGE_VERSION, migrateStorage } from './config/storage.js';

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
export const APP_VERSION = '2.0.0-phase1';

// ─────────────────────────────────────────────────────────────────────────────
// APPLICATION STATE
// ─────────────────────────────────────────────────────────────────────────────

/** @type {AudioContext|null} */
let audioContext = null;

/** @type {boolean} */
let isInitialized = false;

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
  // Check and migrate localStorage if needed
  migrateStorage();

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 1: PLACEHOLDER INITIALIZATION
  // ─────────────────────────────────────────────────────────────────────────
  // In Phase 1, we establish the module structure but don't yet extract
  // the full application logic. This placeholder demonstrates the init flow.
  //
  // TODO Phase 2+: Extract and initialize actual modules:
  //   - await initAudioEngine({ workletPath: WORKLET_PATH })
  //   - await initMeteringPipeline()
  //   - await initUI({ mountElement })
  //   - await initRemote() // if enabled
  // ─────────────────────────────────────────────────────────────────────────

  // Simulate module loading for demonstration
  await new Promise(resolve => setTimeout(resolve, 100));

  // For now, show a placeholder UI
  // Phase 2+ will render the actual metering interface
  renderPlaceholderUI(mountElement);

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
 * Useful for resolving other assets relative to the module.
 *
 * @returns {string} Base URL of the module
 */
export function getModuleBase() {
  return MODULE_BASE.href;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render placeholder UI for Phase 1.
 * This will be replaced by actual metering UI in Phase 2+.
 *
 * @param {HTMLElement} container - Mount element
 * @private
 */
function renderPlaceholderUI(container) {
  container.innerHTML = `
    <div style="
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
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
        text-align: center;
      ">
        <h2 style="
          font-size: 1rem;
          font-weight: 500;
          margin-bottom: 1rem;
          color: #00d4aa;
        ">Phase 1: Modular Architecture</h2>

        <p style="
          font-size: 0.875rem;
          line-height: 1.6;
          opacity: 0.8;
          margin-bottom: 1.5rem;
        ">
          ESM module structure established. AudioWorklet path resolution verified.
          <br>Full metering UI will be extracted in subsequent phases.
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
          ">Test AudioWorklet Path</button>
        </div>

        <pre id="worklet-test-result" style="
          margin-top: 1.5rem;
          padding: 1rem;
          background: #0d1b2a;
          border-radius: 4px;
          font-size: 0.75rem;
          text-align: left;
          overflow-x: auto;
          display: none;
        "></pre>
      </div>

      <p style="
        font-size: 0.75rem;
        opacity: 0.5;
      ">
        Storage v${STORAGE_VERSION} · Module v${APP_VERSION}
      </p>
    </div>
  `;

  // Add test function to window for the button
  window.testWorkletPath = async function() {
    const result = document.getElementById('worklet-test-result');
    result.style.display = 'block';
    result.textContent = 'Testing AudioWorklet path...';

    try {
      const ctx = new AudioContext();
      await ctx.audioWorklet.addModule(WORKLET_PATH);
      result.style.color = '#00d4aa';
      result.textContent = '✓ AudioWorklet loaded successfully\\n\\nPath: ' + WORKLET_PATH;
      await ctx.close();
    } catch (error) {
      result.style.color = '#ff6b6b';
      result.textContent = '✗ AudioWorklet failed to load\\n\\nPath: ' + WORKLET_PATH + '\\n\\nError: ' + error.message;
    }
  };
}
