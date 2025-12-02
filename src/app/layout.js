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
 * @param {HTMLElement} deps.dom.xyCard - Goniometer card
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
  if (getLayoutFrozen() || !dom.xyCard) return;

  const dpr = window.devicePixelRatio || 1;
  const stereoContainer = dom.xyCard.querySelector('.stereoContainer');
  if (!stereoContainer) return;

  const availH = stereoContainer.clientHeight;
  const availW = stereoContainer.clientWidth;
  const gonioSize = Math.min(availH * 0.85, availW * 0.55);

  // Goniometer
  const gonioSquare = dom.xyCard.querySelector('.gonioSquare');
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
  const leftCol = dom.xyCard.querySelector('.stereoLeftCol');
  if (leftCol) {
    leftCol.style.width = gonioSize + 'px';
  }

  // Phase correlation canvas
  const corrWrapEl = dom.xyCard.querySelector('.corrWrap');
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
  const monoDevWrapEl = dom.xyCard.querySelector('.monoDevWrap');
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
 * Handles canvas sizing with device pixel ratio.
 */
export function layoutLoudness() {
  if (getLayoutFrozen() || !dom.loudnessModule || !dom.radarWrap || !dom.loudnessRadar) return;

  const dpr = window.devicePixelRatio || 1;
  const r128MinHeight = 180;
  const gap = 12;

  const availH = dom.loudnessModule.clientHeight;
  const availW = dom.loudnessModule.clientWidth;

  const maxRadarH = availH - r128MinHeight - gap;
  const radarSize = Math.max(100, Math.min(maxRadarH, availW));

  dom.radarWrap.style.width = radarSize + 'px';
  dom.radarWrap.style.height = radarSize + 'px';

  const canvasSize = Math.floor(radarSize * dpr);
  if (dom.loudnessRadar.width !== canvasSize || dom.loudnessRadar.height !== canvasSize) {
    dom.loudnessRadar.width = canvasSize;
    dom.loudnessRadar.height = canvasSize;
  }
  // Radar handles its own sizing in render() via offsetWidth/Height
}
