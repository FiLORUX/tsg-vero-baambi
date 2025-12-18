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
  holdBufR: null,

  // ─────────────────────────────────────────────────────────────────────────
  // REMOTE METERING STATE
  // When activeCapture === 'remote', these values are used instead of local
  // ─────────────────────────────────────────────────────────────────────────

  // True Peak (instantaneous, from remote)
  remoteTpL: -60,
  remoteTpR: -60,

  // PPM (instantaneous dBFS, from remote)
  remotePpmL: -60,
  remotePpmR: -60,

  // RMS (dBFS, from remote)
  remoteRmsL: -60,
  remoteRmsR: -60,

  // Stereo correlation (from remote)
  remoteCorrelation: 0,

  // Balance (from remote)
  remoteBalance: 0,

  // Stereo width (from remote, 0-1 range)
  remoteWidth: 0,
  remoteWidthPeak: 0,

  // M/S levels (from remote, dB)
  remoteMidLevel: -60,
  remoteSideLevel: -60,

  // Rotation (from remote, -1 to +1)
  remoteRotation: 0,
  remoteRotationHistory: [],

  // ─────────────────────────────────────────────────────────────────────────
  // VISUALIZATION DATA (from remote probe)
  // Pre-computed on probe for efficient transmission without raw audio
  // ─────────────────────────────────────────────────────────────────────────

  // Goniometer M/S points: [M0,S0, M1,S1, ...] normalized ±1
  // 128 points = 256 floats, ~1 KB per frame
  remoteGoniometerPoints: null,

  // 1/3-octave spectrum bands: 31 dB values
  // ISO 266 frequencies from 20 Hz to 20 kHz
  remoteSpectrumBands: null
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

/**
 * Reset remote meter state to idle values.
 * Called when the subscribed probe goes offline.
 */
export function resetRemoteMeterState() {
  // True Peak
  meterState.remoteTpL = -60;
  meterState.remoteTpR = -60;

  // PPM
  meterState.remotePpmL = -60;
  meterState.remotePpmR = -60;

  // RMS
  meterState.remoteRmsL = -60;
  meterState.remoteRmsR = -60;

  // Stereo analysis
  meterState.remoteCorrelation = 0;
  meterState.remoteBalance = 0;
  meterState.remoteWidth = 0;
  meterState.remoteWidthPeak = 0;
  meterState.remoteMidLevel = -60;
  meterState.remoteSideLevel = -60;
  meterState.remoteRotation = 0;
  meterState.remoteRotationHistory = [];

  // Visualization data
  meterState.remoteGoniometerPoints = null;
  meterState.remoteSpectrumBands = null;

  // R128 cumulative values
  meterState.tpMaxL = -Infinity;
  meterState.tpMaxR = -Infinity;

  // Radar history (clear so radar shows empty)
  meterState.radarHistory = [];
}
