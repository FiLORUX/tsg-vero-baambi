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
 * METER STATE MODULE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Shared state between measureLoop and renderLoop.
 * Centralises all meter-related state to avoid circular dependencies.
 *
 * @module app/meter-state
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// TIMING CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Measurement loop interval (20 Hz) */
export const MEASURE_INTERVAL_MS = 50;

/** True Peak peak-hold duration */
export const TP_PEAK_HOLD_SEC = 3;

/** PPM peak-hold duration */
export const PPM_PEAK_HOLD_SEC = 3;

/** Frame hold threshold for glitch protection */
export const FRAME_HOLD_THRESHOLD = 80;

// ─────────────────────────────────────────────────────────────────────────────
// METER STATE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shared meter state object.
 * Mutable state accessed by both measureLoop and renderLoop.
 */
export const meterState = {
  // Timing
  startTs: performance.now(),
  lastMeasureTime: performance.now(),
  lastRenderTime: performance.now(),

  // True Peak cumulative max (for R128 TPmax display)
  tpMaxL: -Infinity,
  tpMaxR: -Infinity,

  // True Peak peak-hold (for bar meter display)
  tpPeakHoldL: -60,
  tpPeakHoldR: -60,
  tpPeakTimeL: 0,
  tpPeakTimeR: 0,

  // PPM peak-hold (for bar meter display)
  ppmPeakHoldL: -60,
  ppmPeakHoldR: -60,
  ppmPeakTimeL: 0,
  ppmPeakTimeR: 0,

  // RMS smoothing (300ms hold for crest factor calculation)
  rmsHoldL: 0,
  rmsHoldR: 0,
  lastRmsTs: performance.now(),

  // Crest factor peak
  crestPeak: -Infinity,

  // Peak indicator state (500ms hold)
  peakIndicatorOn: false,
  peakIndicatorLastTrigger: 0,

  // Radar history (short-term LUFS over time)
  radarHistory: [],

  // Frame hold buffers for glitch protection
  holdBufL: null,
  holdBufR: null
};

// ─────────────────────────────────────────────────────────────────────────────
// STATE UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reset all meter state (called on R128 reset).
 */
export function resetMeterState() {
  const now = performance.now();

  meterState.startTs = now;
  meterState.lastMeasureTime = now;
  meterState.lastRenderTime = now;

  meterState.tpMaxL = -Infinity;
  meterState.tpMaxR = -Infinity;

  meterState.tpPeakHoldL = -60;
  meterState.tpPeakHoldR = -60;
  meterState.tpPeakTimeL = 0;
  meterState.tpPeakTimeR = 0;

  meterState.ppmPeakHoldL = -60;
  meterState.ppmPeakHoldR = -60;
  meterState.ppmPeakTimeL = 0;
  meterState.ppmPeakTimeR = 0;

  meterState.rmsHoldL = 0;
  meterState.rmsHoldR = 0;
  meterState.lastRmsTs = now;

  meterState.crestPeak = -Infinity;

  meterState.peakIndicatorOn = false;
  meterState.peakIndicatorLastTrigger = 0;

  meterState.radarHistory = [];

  meterState.holdBufL = null;
  meterState.holdBufR = null;
}

/**
 * Get elapsed time since last reset in seconds.
 * @returns {number} Elapsed seconds
 */
export function getElapsedSeconds() {
  return (performance.now() - meterState.startTs) / 1000;
}
