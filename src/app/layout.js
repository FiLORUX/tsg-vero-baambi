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
 * LAYOUT MODULE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Handles responsive canvas sizing for meter components.
 * Ensures canvases maintain correct pixel density at any viewport size.
 *
 * COMPONENTS
 * ──────────
 *   - sizeWrap: Adjusts main container height
 *   - layoutXY: Sizes goniometer, correlation, and balance canvases
 *   - layoutLoudness: Sizes loudness radar canvas
 *
 * @module app/layout
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// MODULE STATE
// ─────────────────────────────────────────────────────────────────────────────

// Dependencies initialised via initLayout()
let dom = null;
let uiComponents = null;
let getLayoutFrozen = null;

// ─────────────────────────────────────────────────────────────────────────────
// INITIALISATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialise layout with required dependencies.
 *
 * @param {Object} deps - Dependencies
 * @param {Object} deps.dom - DOM element references
 * @param {HTMLElement} deps.dom.wrap - Main container
 * @param {HTMLElement} deps.dom.spatialMeter - Spatial analysis meter
 * @param {HTMLCanvasElement} deps.dom.xy - Goniometer canvas
 * @param {HTMLCanvasElement} deps.dom.corr - Correlation canvas
 * @param {HTMLCanvasElement} deps.dom.monoDev - Balance canvas
 * @param {HTMLElement} deps.dom.loudnessModule - Loudness module container
 * @param {HTMLElement} deps.dom.radarWrap - Radar wrapper
 * @param {HTMLCanvasElement} deps.dom.loudnessRadar - Radar canvas
 * @param {Object} deps.uiComponents - UI component instances
 * @param {Object} deps.uiComponents.goniometer - Goniometer instance
 * @param {Function} deps.getLayoutFrozen - Function returning freeze state
 */
export function initLayout(deps) {
  dom = deps.dom;
  uiComponents = deps.uiComponents;
  getLayoutFrozen = deps.getLayoutFrozen;
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Size main container to fill viewport minus header.
 */
export function sizeWrap() {
  const headerH = document.querySelector('header')?.offsetHeight || 56;
  if (dom.wrap) dom.wrap.style.height = `calc(100dvh - ${headerH}px)`;
}

/**
 * Layout goniometer/vectorscope section.
 * Handles canvas sizing with device pixel ratio.
 */
export function layoutXY() {
  if (getLayoutFrozen() || !dom.spatialMeter) return;

  const dpr = window.devicePixelRatio || 1;
  const stereoContainer = dom.spatialMeter.querySelector('.stereoContainer');
  if (!stereoContainer) return;

  const availH = stereoContainer.clientHeight;
  const availW = stereoContainer.clientWidth;
  const gonioSize = Math.min(availH * 0.85, availW * 0.55);

  // Goniometer
  const gonioSquare = dom.spatialMeter.querySelector('.gonioSquare');
  if (gonioSquare && dom.xy) {
    gonioSquare.style.width = gonioSize + 'px';
    gonioSquare.style.height = gonioSize + 'px';
    const w = Math.floor(gonioSize * dpr);
    if (dom.xy.width !== w || dom.xy.height !== w) {
      dom.xy.width = w;
      dom.xy.height = w;
    }
  }

  // Left column width
  const leftCol = dom.spatialMeter.querySelector('.stereoLeftCol');
  if (leftCol) {
    leftCol.style.width = gonioSize + 'px';
  }

  // Phase correlation canvas
  const corrWrapEl = dom.spatialMeter.querySelector('.corrWrap');
  if (corrWrapEl && dom.corr) {
    const rect = corrWrapEl.getBoundingClientRect();
    const cw = Math.floor(rect.width * dpr);
    const ch = Math.floor(rect.height * dpr);
    if (dom.corr.width !== cw || dom.corr.height !== ch) {
      dom.corr.width = Math.max(10, cw);
      dom.corr.height = Math.max(10, ch);
    }
  }

  // Balance meter
  const monoDevWrapEl = dom.spatialMeter.querySelector('.monoDevWrap');
  if (monoDevWrapEl && dom.monoDev) {
    const rect = monoDevWrapEl.getBoundingClientRect();
    const mdw = Math.floor(rect.width * dpr);
    const mdh = Math.floor(rect.height * dpr);
    if (dom.monoDev.width !== mdw || dom.monoDev.height !== mdh) {
      dom.monoDev.width = Math.max(10, mdw);
      dom.monoDev.height = Math.max(10, mdh);
    }
  }

  // Trigger resize on goniometer
  if (uiComponents.goniometer) uiComponents.goniometer.resize();
  // Correlation meter handles its own sizing in draw()
}

/**
 * Layout loudness/radar section.
 *
 * NOTE: Radar wrapper sizing is now handled entirely by CSS.
 * See .radarWrap styles: aspect-ratio: 1, max-height: 100%, max-width: 100%.
 * Canvas dimensions are set by radar.render() using offsetWidth/Height.
 *
 * This function is kept as a no-op for API compatibility.
 */
export function layoutLoudness() {
  // No-op: CSS handles radar sizing via aspect-ratio and grid constraints
  // Canvas dimensions set by radar.render() synced with drawing
}
