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
 * APPLICATION UI BUILDER
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Creates the meter interface DOM structure and wires components together.
 *
 * LAYOUT
 * ──────
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │ Header: Source selector, status, uptime                        │
 *   ├───────────────┬─────────────────────────────────────────────────┤
 *   │               │ ┌─────────┬─────────┐                           │
 *   │  Goniometer   │ │   TP    │  LUFS   │                           │
 *   │  (L/R/M/S)    │ ├─────────┴─────────┤                           │
 *   │               │ │     Loudness      │                           │
 *   ├───────────────┤ │      Radar        │                           │
 *   │ Correlation   │ └───────────────────┘                           │
 *   └───────────────┴─────────────────────────────────────────────────┘
 *
 * @module app/ui
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { appState, InputMode } from './state.js';

// ─────────────────────────────────────────────────────────────────────────────
// CSS STYLES
// ─────────────────────────────────────────────────────────────────────────────

const STYLES = `
  :root {
    --bg: #141618;
    --panel: #1b1f23;
    --ink: #e8eef9;
    --muted: #a9b2c7;
    --outline: #2a2f36;
    --grid: #29323b;
    --ok: #58d38c;
    --warn: #ffde58;
    --caution: #ff9a2d;
    --hot: #ff5a63;
    --cyan: #69bfff;
    --btn: #2d6bff;
  }

  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  html, body {
    height: 100%;
    background: var(--bg);
    color: var(--ink);
    font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, sans-serif;
    overflow: hidden;
  }

  .app-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  /* Header */
  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    background: linear-gradient(180deg, rgba(27, 31, 35, 0.95), rgba(27, 31, 35, 0.8));
    border-bottom: 1px solid var(--outline);
    flex-shrink: 0;
  }

  .app-title {
    font-size: 1rem;
    font-weight: 500;
    letter-spacing: 0.05em;
    color: var(--cyan);
  }

  .source-controls {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .source-btn {
    padding: 0.5rem 1rem;
    background: var(--btn);
    border: none;
    border-radius: 4px;
    color: white;
    font-size: 0.875rem;
    cursor: pointer;
    transition: opacity 0.2s;
  }

  .source-btn:hover {
    opacity: 0.9;
  }

  .source-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .source-btn.active {
    background: var(--ok);
    color: #111;
  }

  .status-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.75rem;
    color: var(--muted);
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--muted);
  }

  .status-dot.active {
    background: var(--ok);
    box-shadow: 0 0 6px var(--ok);
  }

  /* Main meter grid */
  .meter-grid {
    display: grid;
    grid-template-columns: minmax(200px, 280px) 1fr;
    grid-template-rows: 1fr;
    gap: 0.5rem;
    padding: 0.5rem;
    flex: 1;
    min-height: 0;
  }

  /* Left column: Goniometer + Correlation */
  .left-column {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-height: 0;
  }

  /* Right column: Meters + Radar */
  .right-column {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto 1fr;
    gap: 0.5rem;
    min-height: 0;
  }

  /* Meter panel */
  .meter-panel {
    background: var(--panel);
    border: 1px solid var(--outline);
    border-radius: 8px;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .meter-panel.gonio {
    flex: 2;
    aspect-ratio: 1;
  }

  .meter-panel.corr {
    flex: 1;
    min-height: 80px;
  }

  .meter-panel.radar {
    grid-column: 1 / -1;
  }

  .panel-title {
    font-size: 0.625rem;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 0.5rem;
    flex-shrink: 0;
  }

  .panel-content {
    flex: 1;
    min-height: 0;
    position: relative;
  }

  .panel-canvas {
    width: 100%;
    height: 100%;
    display: block;
    background: #0a0c0e;
    border-radius: 4px;
  }

  /* Meter values display */
  .meter-values {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    margin-bottom: 0.5rem;
    font-family: ui-monospace, monospace;
  }

  .meter-value {
    color: var(--muted);
  }

  .meter-value b {
    color: var(--ink);
    font-weight: 500;
  }

  /* LUFS display */
  .lufs-display {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.5rem;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 4px;
    margin-bottom: 0.5rem;
  }

  .lufs-row {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  .lufs-label {
    font-size: 0.625rem;
    color: var(--muted);
    width: 1rem;
  }

  .lufs-value {
    font-size: 1rem;
    font-weight: 500;
    font-family: ui-monospace, monospace;
  }

  .lufs-value.momentary { color: var(--cyan); }
  .lufs-value.shortterm { color: var(--ok); }
  .lufs-value.integrated { color: var(--ink); }

  /* Uptime */
  .uptime {
    font-family: ui-monospace, monospace;
    font-size: 0.875rem;
    color: var(--muted);
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// DOM BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an element with attributes and children.
 *
 * @param {string} tag - Element tag name
 * @param {Object} attrs - Attributes and properties
 * @param {...(Element|string)} children - Child elements or text
 * @returns {HTMLElement}
 */
function el(tag, attrs = {}, ...children) {
  const element = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'className') {
      element.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(element.style, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'dataset') {
      Object.assign(element.dataset, value);
    } else {
      element.setAttribute(key, value);
    }
  }

  for (const child of children) {
    if (typeof child === 'string') {
      element.appendChild(document.createTextNode(child));
    } else if (child) {
      element.appendChild(child);
    }
  }

  return element;
}

// ─────────────────────────────────────────────────────────────────────────────
// UI BUILDER CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds and manages the meter UI.
 */
export class MeterUI {
  /**
   * @param {HTMLElement} container - Mount point element
   */
  constructor(container) {
    this.container = container;

    // DOM references
    this.elements = {};

    // Component instances
    this.components = {};

    // State
    this.isRunning = false;
    this.startTime = 0;
  }

  /**
   * Build the UI and return references to key elements.
   *
   * @returns {Object} Element references
   */
  build() {
    // Inject styles
    this._injectStyles();

    // Build DOM structure
    const root = this._buildStructure();
    this.container.appendChild(root);

    return this.elements;
  }

  /**
   * @private
   */
  _injectStyles() {
    if (document.getElementById('vero-styles')) return;

    const style = document.createElement('style');
    style.id = 'vero-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  /**
   * @private
   */
  _buildStructure() {
    // Header
    const header = el('header', { className: 'app-header' },
      el('h1', { className: 'app-title' }, 'VERO-BAAMBI'),
      this._buildSourceControls(),
      this._buildStatusIndicator()
    );

    // Left column: Goniometer + Correlation
    const leftColumn = el('div', { className: 'left-column' },
      this._buildGoniometerPanel(),
      this._buildCorrelationPanel()
    );

    // Right column: TP, LUFS, Radar
    const rightColumn = el('div', { className: 'right-column' },
      this._buildTPPanel(),
      this._buildLUFSPanel(),
      this._buildRadarPanel()
    );

    // Main grid
    const meterGrid = el('div', { className: 'meter-grid' },
      leftColumn,
      rightColumn
    );

    // Container
    const root = el('div', { className: 'app-container' },
      header,
      meterGrid
    );

    return root;
  }

  /**
   * @private
   */
  _buildSourceControls() {
    const btnBrowser = el('button', {
      className: 'source-btn',
      id: 'btn-browser',
      onClick: () => this._handleSourceClick('browser')
    }, '🔊 Browser Tab');

    const btnDevice = el('button', {
      className: 'source-btn',
      id: 'btn-device',
      onClick: () => this._handleSourceClick('device')
    }, '🎤 Input Device');

    const btnGenerator = el('button', {
      className: 'source-btn',
      id: 'btn-generator',
      onClick: () => this._handleSourceClick('generator')
    }, '〰️ Test Tone');

    this.elements.btnBrowser = btnBrowser;
    this.elements.btnDevice = btnDevice;
    this.elements.btnGenerator = btnGenerator;

    return el('div', { className: 'source-controls' },
      btnBrowser, btnDevice, btnGenerator
    );
  }

  /**
   * @private
   */
  _buildStatusIndicator() {
    const dot = el('span', { className: 'status-dot', id: 'status-dot' });
    const uptime = el('span', { className: 'uptime', id: 'uptime' }, '00:00:00');

    this.elements.statusDot = dot;
    this.elements.uptime = uptime;

    return el('div', { className: 'status-indicator' }, dot, uptime);
  }

  /**
   * @private
   */
  _buildGoniometerPanel() {
    const canvas = el('canvas', { className: 'panel-canvas', id: 'gonio-canvas' });
    this.elements.gonioCanvas = canvas;

    return el('div', { className: 'meter-panel gonio' },
      el('div', { className: 'panel-title' }, 'Goniometer'),
      el('div', { className: 'panel-content' }, canvas)
    );
  }

  /**
   * @private
   */
  _buildCorrelationPanel() {
    const canvas = el('canvas', { className: 'panel-canvas', id: 'corr-canvas' });
    this.elements.corrCanvas = canvas;

    return el('div', { className: 'meter-panel corr' },
      el('div', { className: 'panel-title' }, 'Phase Correlation'),
      el('div', { className: 'panel-content' }, canvas)
    );
  }

  /**
   * @private
   */
  _buildTPPanel() {
    const canvas = el('canvas', { className: 'panel-canvas', id: 'tp-canvas' });
    const valL = el('b', { id: 'tp-val-l' }, '--.-');
    const valR = el('b', { id: 'tp-val-r' }, '--.-');

    this.elements.tpCanvas = canvas;
    this.elements.tpValL = valL;
    this.elements.tpValR = valR;

    return el('div', { className: 'meter-panel' },
      el('div', { className: 'panel-title' }, 'True Peak'),
      el('div', { className: 'meter-values' },
        el('span', { className: 'meter-value' }, 'L: ', valL, ' dBTP'),
        el('span', { className: 'meter-value' }, 'R: ', valR, ' dBTP')
      ),
      el('div', { className: 'panel-content' }, canvas)
    );
  }

  /**
   * @private
   */
  _buildLUFSPanel() {
    const lufsM = el('span', { className: 'lufs-value momentary', id: 'lufs-m' }, '--.- LUFS');
    const lufsS = el('span', { className: 'lufs-value shortterm', id: 'lufs-s' }, '--.- LUFS');
    const lufsI = el('span', { className: 'lufs-value integrated', id: 'lufs-i' }, '--.- LUFS');

    this.elements.lufsM = lufsM;
    this.elements.lufsS = lufsS;
    this.elements.lufsI = lufsI;

    return el('div', { className: 'meter-panel' },
      el('div', { className: 'panel-title' }, 'Loudness'),
      el('div', { className: 'lufs-display' },
        el('div', { className: 'lufs-row' },
          el('span', { className: 'lufs-label' }, 'M'),
          lufsM
        ),
        el('div', { className: 'lufs-row' },
          el('span', { className: 'lufs-label' }, 'S'),
          lufsS
        ),
        el('div', { className: 'lufs-row' },
          el('span', { className: 'lufs-label' }, 'I'),
          lufsI
        )
      )
    );
  }

  /**
   * @private
   */
  _buildRadarPanel() {
    const canvas = el('canvas', { className: 'panel-canvas', id: 'radar-canvas' });
    this.elements.radarCanvas = canvas;

    return el('div', { className: 'meter-panel radar' },
      el('div', { className: 'panel-title' }, 'Loudness Radar'),
      el('div', { className: 'panel-content' }, canvas)
    );
  }

  /**
   * Handle source button clicks.
   * @private
   */
  _handleSourceClick(source) {
    // Dispatch event for external handling
    this.container.dispatchEvent(new CustomEvent('source-select', {
      detail: { source },
      bubbles: true
    }));
  }

  /**
   * Update running state display.
   *
   * @param {boolean} running - Whether audio is active
   */
  setRunning(running) {
    this.isRunning = running;
    if (running) {
      this.startTime = performance.now();
      this.elements.statusDot.classList.add('active');
    } else {
      this.elements.statusDot.classList.remove('active');
    }
  }

  /**
   * Update uptime display.
   */
  updateUptime() {
    if (!this.isRunning) return;

    const elapsed = (performance.now() - this.startTime) / 1000;
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = Math.floor(elapsed % 60);

    this.elements.uptime.textContent =
      `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  /**
   * Update LUFS display values.
   *
   * @param {number} momentary - Momentary LUFS
   * @param {number} shortTerm - Short-term LUFS
   * @param {number} integrated - Integrated LUFS
   */
  updateLUFS(momentary, shortTerm, integrated) {
    const fmt = (v) => isFinite(v) ? v.toFixed(1) + ' LUFS' : '--.- LUFS';
    this.elements.lufsM.textContent = fmt(momentary);
    this.elements.lufsS.textContent = fmt(shortTerm);
    this.elements.lufsI.textContent = fmt(integrated);
  }

  /**
   * Update True Peak display values.
   *
   * @param {number} left - Left channel dBTP
   * @param {number} right - Right channel dBTP
   */
  updateTruePeak(left, right) {
    const fmt = (v) => isFinite(v) ? v.toFixed(1) : '--.-';
    this.elements.tpValL.textContent = fmt(left);
    this.elements.tpValR.textContent = fmt(right);
  }

  /**
   * Set active source button.
   *
   * @param {string|null} source - Active source or null
   */
  setActiveSource(source) {
    this.elements.btnBrowser.classList.toggle('active', source === 'browser');
    this.elements.btnDevice.classList.toggle('active', source === 'device');
    this.elements.btnGenerator.classList.toggle('active', source === 'generator');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export { el };
