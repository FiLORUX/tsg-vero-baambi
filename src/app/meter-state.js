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

/** Nordic PPM Type I peak-hold duration (RTW/DK convention) */
export const NORDIC_PPM_PEAK_HOLD_SEC = 3;

/** BBC PPM Type IIa peak-hold duration */
export const BBC_PPM_PEAK_HOLD_SEC = 3;

/** Sample Peak peak-hold duration */
export const SP_PEAK_HOLD_SEC = 3;

/** Frame hold threshold for glitch protection */
export const FRAME_HOLD_THRESHOLD = 80;

// BBC PPM constants moved to src/metering/ppm.js for centralisation

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
  sessionStartWallTime: Date.now(),  // Wall-clock start time for export
  lastMeasureTime: performance.now(),
  lastRenderTime: performance.now(),

  // EBU Tech 3341 §5.5 Pause state
  measurementPaused: false,
  pausedAt: null,           // timestamp when paused
  totalPausedMs: 0,         // accumulated pause duration
  frozenIntegrated: null,   // frozen I value for display
  frozenLra: null,          // frozen LRA value for display
  frozenRadarTs: null,      // frozen timestamp for radar (Date.now() at pause)
  radarPauseBreaks: [],     // list of pause timestamps (gap boundaries)

  // True Peak cumulative max (for R128 TPmax display)
  tpMaxL: -Infinity,
  tpMaxR: -Infinity,

  // True Peak peak-hold (for bar meter display)
  tpPeakHoldL: -60,
  tpPeakHoldR: -60,
  tpPeakTimeL: 0,
  tpPeakTimeR: 0,

  // Nordic PPM Type I peak-hold (for bar meter display)
  nordicPeakHoldL: -60,
  nordicPeakHoldR: -60,
  nordicPeakTimeL: 0,
  nordicPeakTimeR: 0,

  // BBC PPM Type IIa (IEC 60268-10)
  // Ballistics: −2 dB at 10 ms (τ = 6.33 ms), 24 dB in 2.8 s return
  // Uses RC detector state for sample-by-sample processing
  bbcRcStateL: { envelope: 0, peakDb: -60 },
  bbcRcStateR: { envelope: 0, peakDb: -60 },
  bbcPeakHoldL: -60,
  bbcPeakHoldR: -60,
  bbcPeakTimeL: 0,
  bbcPeakTimeR: 0,

  // Sample Peak (IEC 60268-18 / AES17)
  // No ballistics - instantaneous sample peak
  spPeakHoldL: -60,
  spPeakHoldR: -60,
  spPeakTimeL: 0,
  spPeakTimeR: 0,

  // RMS smoothing (300ms hold for crest factor calculation)
  rmsHoldL: 0,
  rmsHoldR: 0,
  lastRmsTs: performance.now(),

  // Crest factor peak
  crestPeak: -Infinity,

  // Peak indicator state (500ms hold)
  peakIndicatorOn: false,
  peakIndicatorLastTrigger: 0,

  // LUFS readings (updated by measure-loop, used by history strip)
  shortTermLufs: -Infinity,
  integratedLufs: -Infinity,

  // Radar history (short-term LUFS over time)
  radarHistory: [],

  // Frame hold buffers for glitch protection
  holdBufL: null,
  holdBufR: null,

  // ─────────────────────────────────────────────────────────────────────────
  // REMOTE/TAURI METERING STATE
  // When activeCapture === 'remote' or 'tauri', these values are used instead
  // of local audio processing (data comes from external sources)
  // ─────────────────────────────────────────────────────────────────────────

  // True Peak (instantaneous, from remote)
  remoteTpL: -60,
  remoteTpR: -60,

  // Nordic PPM Type I (instantaneous dBFS, from remote)
  remoteNordicPpmL: -60,
  remoteNordicPpmR: -60,

  // BBC PPM Type IIa (instantaneous dBFS, from remote)
  // Note: Remote probes transmit TP, BBC ballistics applied locally
  remoteBbcPpmL: -60,
  remoteBbcPpmR: -60,

  // RMS (dBFS, from remote)
  remoteRmsL: -60,
  remoteRmsR: -60,

  // Sample Peak (dBFS, from remote - uses TP as approximation)
  remoteSpL: -60,
  remoteSpR: -60,

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

  // Goniometer M/S points: [M0,S0, M1,S1, ...] normalised ±1
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
 * Also clears pause state per EBU Tech 3341 (reset from any state).
 */
export function resetMeterState() {
  const now = performance.now();

  meterState.startTs = now;
  meterState.sessionStartWallTime = Date.now();
  meterState.lastMeasureTime = now;
  meterState.lastRenderTime = now;

  // Clear pause state
  meterState.measurementPaused = false;
  meterState.pausedAt = null;
  meterState.totalPausedMs = 0;
  meterState.frozenIntegrated = null;
  meterState.frozenLra = null;
  meterState.frozenRadarTs = null;
  meterState.radarPauseBreaks = [];

  meterState.tpMaxL = -Infinity;
  meterState.tpMaxR = -Infinity;

  meterState.tpPeakHoldL = -60;
  meterState.tpPeakHoldR = -60;
  meterState.tpPeakTimeL = 0;
  meterState.tpPeakTimeR = 0;

  meterState.nordicPeakHoldL = -60;
  meterState.nordicPeakHoldR = -60;
  meterState.nordicPeakTimeL = 0;
  meterState.nordicPeakTimeR = 0;

  meterState.bbcRcStateL = { envelope: 0, peakDb: -60 };
  meterState.bbcRcStateR = { envelope: 0, peakDb: -60 };
  meterState.bbcPeakHoldL = -60;
  meterState.bbcPeakHoldR = -60;
  meterState.bbcPeakTimeL = 0;
  meterState.bbcPeakTimeR = 0;

  meterState.spPeakHoldL = -60;
  meterState.spPeakHoldR = -60;
  meterState.spPeakTimeL = 0;
  meterState.spPeakTimeR = 0;

  meterState.rmsHoldL = 0;
  meterState.rmsHoldR = 0;
  meterState.lastRmsTs = now;

  meterState.crestPeak = -Infinity;

  meterState.peakIndicatorOn = false;
  meterState.peakIndicatorLastTrigger = 0;

  meterState.shortTermLufs = -Infinity;
  meterState.integratedLufs = -Infinity;

  meterState.radarHistory = [];

  meterState.holdBufL = null;
  meterState.holdBufR = null;
}

/**
 * Get elapsed time since last reset in seconds.
 * Subtracts paused duration for EBU Tech 3341 compliance.
 * @returns {number} Elapsed seconds (excluding paused time)
 */
export function getElapsedSeconds() {
  const raw = performance.now() - meterState.startTs;
  let pausedTime = meterState.totalPausedMs;

  // If currently paused, add time since pause started
  if (meterState.measurementPaused && meterState.pausedAt) {
    pausedTime += performance.now() - meterState.pausedAt;
  }

  return (raw - pausedTime) / 1000;
}

/**
 * Reset remote meter state to idle values.
 * Called when the subscribed probe goes offline.
 */
export function resetRemoteMeterState() {
  // True Peak
  meterState.remoteTpL = -60;
  meterState.remoteTpR = -60;

  // Nordic PPM
  meterState.remoteNordicPpmL = -60;
  meterState.remoteNordicPpmR = -60;

  // BBC PPM
  meterState.remoteBbcPpmL = -60;
  meterState.remoteBbcPpmR = -60;

  // RMS
  meterState.remoteRmsL = -60;
  meterState.remoteRmsR = -60;

  // Sample Peak
  meterState.remoteSpL = -60;
  meterState.remoteSpR = -60;

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
