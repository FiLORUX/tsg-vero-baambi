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
 * MEASUREMENT LOOP (20 Hz)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Updates LUFS, True Peak, and R128 statistics at 20 Hz.
 * Separated from render loop for consistent timing regardless of frame rate.
 *
 * TIMING
 * ──────
 *   - Runs every 50ms (20 Hz) via setInterval
 *   - Independent of requestAnimationFrame
 *   - Handles EBU Stereo-ID pulse timing
 *
 * DISPLAY DELAYS (time-gated values)
 * ──────────────────────────────────
 *   - M (Momentary): show after 1s
 *   - S (Short-term): show after 10s
 *   - I (Integrated): show after 30s
 *
 * @module app/measure-loop
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { formatLUFS } from '../metering/lufs.js';
import { meterState, MEASURE_INTERVAL_MS, getElapsedSeconds } from './meter-state.js';
import { InputMode } from './state.js';

// ─────────────────────────────────────────────────────────────────────────────
// MODULE STATE
// ─────────────────────────────────────────────────────────────────────────────

// Initialised via initMeasureLoop()
let dom = null;
let meters = null;
let captureState = null;
let ebuState = null;
let config = null;
let sourceController = null;
let TransitionGuard = null;
let getPresetConfig = null;
let loudnessColour = null;

// Interval handle
let measureInterval = null;

// ─────────────────────────────────────────────────────────────────────────────
// DISPLAY DELAY CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const DELAY_M = 1;   // Momentary: show after 1s
const DELAY_S = 10;  // Short-term: show after 10s
const DELAY_I = 30;  // Integrated: show after 30s

// ─────────────────────────────────────────────────────────────────────────────
// INITIALISATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialise the measure loop with required dependencies.
 *
 * @param {Object} deps - Dependencies
 * @param {Object} deps.dom - DOM element references
 * @param {Object} deps.meters - Meter instances (lufsMeter, truePeakMeter)
 * @param {Object} deps.captureState - Capture state accessor { getActiveCapture }
 * @param {Object} deps.ebuState - EBU pulse state { get/set ebuModeActive, ebuPrevState, leftMuteTimer }
 * @param {Object} deps.config - Config accessor { getTargetLufs, getTpLimit, getRadarMaxSeconds }
 * @param {Object} deps.sourceController - SourceController instance
 * @param {Object} deps.TransitionGuard - TransitionGuard singleton
 * @param {Function} deps.getPresetConfig - Function to get current generator preset
 * @param {Function} deps.loudnessColour - Function to get colour for LUFS value
 */
export function initMeasureLoop(deps) {
  dom = deps.dom;
  meters = deps.meters;
  captureState = deps.captureState;
  ebuState = deps.ebuState;
  config = deps.config;
  sourceController = deps.sourceController;
  TransitionGuard = deps.TransitionGuard;
  getPresetConfig = deps.getPresetConfig;
  loudnessColour = deps.loudnessColour;
}

/**
 * Start the measurement loop.
 */
export function startMeasureLoop() {
  if (measureInterval) return;
  measureInterval = setInterval(measureLoop, MEASURE_INTERVAL_MS);
}

/**
 * Stop the measurement loop.
 */
export function stopMeasureLoop() {
  if (measureInterval) {
    clearInterval(measureInterval);
    measureInterval = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMAT HELPER
// ─────────────────────────────────────────────────────────────────────────────

function formatTime(ms) {
  if (!isFinite(ms) || ms < 0) return '--:--:--';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MEASURE LOOP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main measurement loop function.
 * Called every 50ms (20 Hz).
 */
function measureLoop() {
  const now = performance.now();
  const dt = now - meterState.lastMeasureTime;
  meterState.lastMeasureTime = now;

  // ─────────────────────────────────────────────────────────────────────────
  // EBU Stereo-ID pulse timing
  // ─────────────────────────────────────────────────────────────────────────
  const activeCapture = captureState.getActiveCapture();
  const presetConfig = activeCapture === 'generator' ? getPresetConfig() : null;
  const isPulsedPreset = presetConfig && presetConfig.pulsed && presetConfig.type === 'sine' &&
    sourceController.isModeActive(InputMode.GENERATOR);

  if (isPulsedPreset && sourceController.hasLeftChannelControl()) {
    ebuState.ebuModeActive = true;
    ebuState.leftMuteTimer += dt;
    const EBU_PERIOD_MS = 3000;
    const EBU_MUTE_MS = 250;
    const shouldBeOn = (ebuState.leftMuteTimer % EBU_PERIOD_MS) >= EBU_MUTE_MS;

    if (shouldBeOn !== ebuState.ebuPrevState) {
      TransitionGuard.trigger();
      sourceController.setLeftChannelGain(shouldBeOn ? 1 : 0);
      ebuState.ebuPrevState = shouldBeOn;
    }
  } else if (ebuState.ebuModeActive && !isPulsedPreset) {
    ebuState.ebuModeActive = false;
    if (sourceController.hasLeftChannelControl()) {
      sourceController.setLeftChannelGain(1);
    }
  }

  if (!activeCapture) return;

  // ─────────────────────────────────────────────────────────────────────────
  // REMOTE MODE: Skip local metering - handleRemoteMetrics updates displays
  // ─────────────────────────────────────────────────────────────────────────
  if (activeCapture === 'remote') {
    // In remote mode, all LUFS/TP/radar updates come from handleRemoteMetrics
    // Only update elapsed time display here
    const elapsed = performance.now() - meterState.startTs;
    if (dom.r128Time) dom.r128Time.textContent = formatTime(elapsed);
    return;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LUFS measurement (local modes only)
  // ─────────────────────────────────────────────────────────────────────────
  const energy = meters.lufsMeter.calculateBlockEnergy(meters.bufL, meters.bufR);
  meters.lufsMeter.pushBlock(energy);
  const readings = meters.lufsMeter.getReadings();

  const elapsedSec = getElapsedSeconds();

  // Momentary LUFS
  if (dom.lufsM) {
    const mDisp = readings.momentary;
    if (elapsedSec >= DELAY_M && isFinite(mDisp)) {
      dom.lufsM.textContent = formatLUFS(mDisp);
      dom.lufsM.style.color = loudnessColour(mDisp);
    } else {
      dom.lufsM.textContent = '--.- LUFS';
      dom.lufsM.style.color = '';
    }
    dom.lufsM.dataset.v = mDisp;
  }

  // Short-term LUFS
  if (dom.lufsS) {
    const sDisp = readings.shortTerm;
    if (elapsedSec >= DELAY_S && isFinite(sDisp)) {
      dom.lufsS.textContent = formatLUFS(sDisp);
      dom.lufsS.style.color = loudnessColour(sDisp);
    } else {
      dom.lufsS.textContent = '--.- LUFS';
      dom.lufsS.style.color = '';
    }
  }

  // Integrated LUFS
  if (dom.lufsI) {
    const iDisp = readings.integrated;
    if (elapsedSec >= DELAY_I && isFinite(iDisp)) {
      dom.lufsI.textContent = formatLUFS(iDisp);
      dom.lufsI.style.color = loudnessColour(iDisp);
    } else {
      dom.lufsI.textContent = '--.- LUFS';
      dom.lufsI.style.color = '';
    }
  }

  // LRA
  if (dom.lraEl) {
    if (elapsedSec >= DELAY_I && readings.lra !== null && isFinite(readings.lra)) {
      dom.lraEl.textContent = readings.lra.toFixed(1) + ' LU';
    } else {
      dom.lraEl.textContent = '--.- LU';
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // True Peak tracking (cumulative max for R128 display)
  // ─────────────────────────────────────────────────────────────────────────
  const tpState = meters.truePeakMeter.getState();

  if (tpState.peakLeft > meterState.tpMaxL) meterState.tpMaxL = tpState.peakLeft;
  if (tpState.peakRight > meterState.tpMaxR) meterState.tpMaxR = tpState.peakRight;
  const tpMax = Math.max(meterState.tpMaxL, meterState.tpMaxR);

  // TPmax display
  if (dom.r128TpMax) {
    if (elapsedSec >= DELAY_M && isFinite(tpMax) && tpMax > -60) {
      dom.r128TpMax.textContent = tpMax.toFixed(1) + ' dBTP';
    } else {
      dom.r128TpMax.textContent = '--.- dBTP';
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Crest factor: TP - RMS
  // ─────────────────────────────────────────────────────────────────────────
  const currentTp = Math.max(tpState.left, tpState.right);
  const rmsDbL = 20 * Math.log10(meterState.rmsHoldL + 1e-12);
  const rmsDbR = 20 * Math.log10(meterState.rmsHoldR + 1e-12);
  const currentRms = Math.max(rmsDbL, rmsDbR);
  const crest = currentTp - currentRms;

  if (dom.r128Crest) {
    if (elapsedSec >= DELAY_S && isFinite(crest) && currentTp > -60 && currentRms > -60) {
      dom.r128Crest.textContent = crest.toFixed(1) + ' dB';
    } else {
      dom.r128Crest.textContent = '--.- dB';
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Peak LED
  // ─────────────────────────────────────────────────────────────────────────
  if (dom.peakLed) {
    dom.peakLed.classList.toggle('on', tpMax > config.getTpLimit());
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Radar history
  // ─────────────────────────────────────────────────────────────────────────
  if (readings.shortTerm !== null && isFinite(readings.shortTerm)) {
    const now = Date.now();
    const maxAge = config.getRadarMaxSeconds() * 1000;
    while (meterState.radarHistory.length > 0 && now - meterState.radarHistory[0].t > maxAge) {
      meterState.radarHistory.shift();
    }
    meterState.radarHistory.push({ t: now, v: readings.shortTerm });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Elapsed time display
  // ─────────────────────────────────────────────────────────────────────────
  const elapsed = performance.now() - meterState.startTs;
  if (dom.r128Time) dom.r128Time.textContent = formatTime(elapsed);
}
