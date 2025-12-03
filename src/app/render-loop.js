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
 * RENDER LOOP (60 Hz)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Renders all visual meters and UI components at display refresh rate.
 * Uses requestAnimationFrame for smooth 60fps rendering.
 *
 * COMPONENTS RENDERED
 * ───────────────────
 *   - Goniometer (vectorscope)
 *   - Correlation meter
 *   - Balance meter
 *   - Spectrum analyzer
 *   - M/S meter
 *   - Width meter
 *   - Rotation meter
 *   - Loudness radar
 *   - PPM bar meter
 *   - dBFS bar meter
 *   - True Peak bar meter
 *
 * GLITCH PROTECTION
 * ─────────────────
 *   - Holds last known-good buffer on long frames (>80ms)
 *   - Prevents visual artifacts from timing skew
 *
 * @module app/render-loop
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { meterState, FRAME_HOLD_THRESHOLD, TP_PEAK_HOLD_SEC, PPM_PEAK_HOLD_SEC } from './meter-state.js';

// ─────────────────────────────────────────────────────────────────────────────
// MODULE STATE
// ─────────────────────────────────────────────────────────────────────────────

// Dependencies initialised via initRenderLoop()
let dom = null;
let meters = null;
let uiComponents = null;
let config = null;
let helpers = null;
let TransitionGuard = null;
let GlitchDebug = null;
let captureState = null;

// Animation frame handle
let animationFrameId = null;

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const PEAK_INDICATOR_HOLD_MS = 500;

// ─────────────────────────────────────────────────────────────────────────────
// INITIALISATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialise the render loop with required dependencies.
 *
 * @param {Object} deps - Dependencies
 * @param {Object} deps.dom - DOM element references
 * @param {Object} deps.meters - Meter instances
 * @param {Object} deps.uiComponents - UI component instances
 * @param {Object} deps.config - Config accessor functions
 * @param {Object} deps.helpers - Helper functions
 * @param {Object} deps.TransitionGuard - TransitionGuard singleton
 * @param {Object} deps.GlitchDebug - GlitchDebug singleton
 */
export function initRenderLoop(deps) {
  dom = deps.dom;
  meters = deps.meters;
  uiComponents = deps.uiComponents;
  config = deps.config;
  helpers = deps.helpers;
  TransitionGuard = deps.TransitionGuard;
  GlitchDebug = deps.GlitchDebug;
  captureState = deps.captureState || null;
}

/**
 * Start the render loop.
 */
export function startRenderLoop() {
  if (animationFrameId) return;
  animationFrameId = requestAnimationFrame(renderLoop);
}

/**
 * Stop the render loop.
 */
export function stopRenderLoop() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMAT HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format dB value with fixed precision.
 * @param {number} db - dB value
 * @param {number} decimals - Decimal places
 * @returns {string} Formatted string
 */
function formatDb(db, decimals = 1) {
  if (!isFinite(db)) return '--.-';
  return db.toFixed(decimals);
}

/**
 * Format dBu value for PPM display.
 * @param {number} ppm - PPM value (Nordic scale)
 * @returns {string} Formatted string with dBu suffix
 */
function formatDbu(ppm) {
  if (!isFinite(ppm)) return '--.-';
  // PPM to dBu: PPM 0 = +4 dBu (Nordic reference)
  const dbu = ppm + 4;
  const sign = dbu >= 0 ? '+' : '';
  return `${sign}${dbu.toFixed(1)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDER LOOP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main render loop function.
 * Called via requestAnimationFrame (~60 Hz).
 */
function renderLoop() {
  const now = performance.now();
  const frameDelta = now - meterState.lastRenderTime;
  meterState.lastRenderTime = now;

  // Layout
  helpers.layoutXY();
  helpers.layoutLoudness();

  // Sample analysers ONCE (always get fresh data for debugging)
  helpers.sampleAnalysers();

  // On long frames, AnalyserNode buffers may have timing skew between L/R reads.
  // Use held (last known-good) buffers for display to prevent visual artifacts.
  const isLongFrame = frameDelta > FRAME_HOLD_THRESHOLD;
  const useBufL = (isLongFrame && meterState.holdBufL) ? meterState.holdBufL : meters.bufL;
  const useBufR = (isLongFrame && meterState.holdBufR) ? meterState.holdBufR : meters.bufR;

  // Store good buffers for potential hold (only when frame timing is normal)
  if (!isLongFrame) {
    if (!meterState.holdBufL) meterState.holdBufL = new Float32Array(meters.bufL.length);
    if (!meterState.holdBufR) meterState.holdBufR = new Float32Array(meters.bufR.length);
    meterState.holdBufL.set(meters.bufL);
    meterState.holdBufR.set(meters.bufR);
  }

  // DEBUG: Analyze actual (possibly glitched) buffers for accurate debugging
  if (GlitchDebug) {
    GlitchDebug.analyze(meters.bufL, meters.bufR, now);
  }

  // Check if we're in remote capture mode (used throughout render loop)
  const isRemoteCapture = captureState?.getActiveCapture?.() === 'remote';

  // ─────────────────────────────────────────────────────────────────────────
  // Stereo Analysis Components
  // ─────────────────────────────────────────────────────────────────────────

  // Stereo analysis engine - use held buffers for stable display (skip in remote mode)
  if (uiComponents.stereoAnalysis && !isRemoteCapture) {
    uiComponents.stereoAnalysis.analyze(useBufL, useBufR);
  }

  // Goniometer - use held buffers on long frames, or remote M/S points
  if (uiComponents.goniometer) {
    if (isRemoteCapture) {
      // Remote mode: use pre-computed M/S points, or draw empty if probe offline
      uiComponents.goniometer.drawFromPoints(
        meterState.remoteGoniometerPoints || [],
        TransitionGuard.shouldRender()
      );
    } else {
      // Local: compute M/S from raw audio buffers
      uiComponents.goniometer.draw(useBufL, useBufR, TransitionGuard.shouldRender());
    }
  }

  // Correlation meter
  if (uiComponents.correlationMeter) {
    if (isRemoteCapture) {
      // Use remote correlation value
      uiComponents.correlationMeter.drawValue(meterState.remoteCorrelation, TransitionGuard.shouldRender());
    } else {
      // Local calculation from buffers
      uiComponents.correlationMeter.draw(useBufL, useBufR, TransitionGuard.shouldRender());
    }
  }

  // Balance meter
  if (uiComponents.balanceMeterUI) {
    if (isRemoteCapture) {
      // Use remote balance value
      uiComponents.balanceMeterUI.drawValue(meterState.remoteBalance);
    } else {
      // Local calculation from buffers
      uiComponents.balanceMeterUI.draw(meters.bufL, meters.bufR);
    }
  }

  // Spectrum analyzer - use remote bands or local FFT
  if (uiComponents.spectrumAnalyzerUI) {
    if (isRemoteCapture) {
      // Remote mode: use pre-computed bands, or draw silence if probe offline
      let bands = meterState.remoteSpectrumBands;
      if (!bands) {
        // Create silence array (-100 dB per band)
        // Low enough to force ballistics to fall off screen, but finite to avoid NaN
        bands = new Float32Array(31).fill(-100);
      }
      uiComponents.spectrumAnalyzerUI.drawFromBands(bands, dom.xyCard);
    } else {
      // Local: compute FFT→1/3-octave from analysers
      uiComponents.spectrumAnalyzerUI.draw(dom.xyCard, config.getSampleRate());
    }
  }

  // M/S meter
  if (uiComponents.msMeterUI) {
    if (isRemoteCapture) {
      // Use remote M/S levels
      uiComponents.msMeterUI.update(meterState.remoteMidLevel, meterState.remoteSideLevel);
    } else if (uiComponents.stereoAnalysis) {
      uiComponents.msMeterUI.update(
        uiComponents.stereoAnalysis.getMidLevel(),
        uiComponents.stereoAnalysis.getSideLevel()
      );
    }
  }

  // Width meter
  if (uiComponents.widthMeterUI) {
    if (isRemoteCapture) {
      // Use remote width values
      uiComponents.widthMeterUI.draw(meterState.remoteWidth, meterState.remoteWidthPeak);
    } else if (uiComponents.stereoAnalysis) {
      uiComponents.widthMeterUI.draw(
        uiComponents.stereoAnalysis.getWidth(),
        uiComponents.stereoAnalysis.getWidthPeak()
      );
    }
  }

  // Rotation meter
  if (uiComponents.rotationMeterUI) {
    if (isRemoteCapture) {
      // Use remote rotation values
      uiComponents.rotationMeterUI.draw(
        meterState.remoteRotation,
        meterState.remoteRotationHistory,
        dom.xyCard
      );
    } else if (uiComponents.stereoAnalysis) {
      uiComponents.rotationMeterUI.draw(
        uiComponents.stereoAnalysis.getRotation(),
        uiComponents.stereoAnalysis.getRotationHistory(),
        dom.xyCard
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Radar
  // ─────────────────────────────────────────────────────────────────────────

  if (uiComponents.radar) {
    const mVal = dom.lufsM ? parseFloat(dom.lufsM.dataset.v) : undefined;
    uiComponents.radar.render(
      meterState.radarHistory,
      isFinite(mVal) ? mVal : undefined,
      config.getRadarMaxSeconds(),
      meterState.peakIndicatorOn
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PPM Meter
  // ─────────────────────────────────────────────────────────────────────────
  const nowSec = now / 1000;
  // isRemoteCapture is already defined at the top of renderFrame

  let ppmDisplayL, ppmDisplayR, ppmL, ppmR, isSilentL, isSilentR;

  if (isRemoteCapture) {
    // Use remote values from meterState (set by handleRemoteMetrics)
    ppmDisplayL = meterState.remotePpmL;
    ppmDisplayR = meterState.remotePpmR;
    // Convert dBFS to PPM scale for display (PPM = dBFS + offset)
    ppmL = ppmDisplayL + 9; // Approximate Nordic PPM offset
    ppmR = ppmDisplayR + 9;
    isSilentL = ppmDisplayL <= -59;
    isSilentR = ppmDisplayR <= -59;
    // Peak holds are already updated by handleRemoteMetrics
  } else {
    // Local metering
    meters.ppmMeter.update(meters.bufL, meters.bufR);
    const ppmState = meters.ppmMeter.getState();
    ppmDisplayL = ppmState.dbfsLeft;
    ppmDisplayR = ppmState.dbfsRight;
    ppmL = ppmState.ppmScaleLeft;
    ppmR = ppmState.ppmScaleRight;
    isSilentL = ppmState.isSilentLeft;
    isSilentR = ppmState.isSilentRight;

    // PPM peak-hold uses dBFS values (for bar drawing)
    if (ppmDisplayL > meterState.ppmPeakHoldL) {
      meterState.ppmPeakHoldL = ppmDisplayL;
      meterState.ppmPeakTimeL = nowSec;
    } else if (nowSec - meterState.ppmPeakTimeL > PPM_PEAK_HOLD_SEC) {
      meterState.ppmPeakHoldL = ppmDisplayL;
      meterState.ppmPeakTimeL = nowSec;
    }
    if (ppmDisplayR > meterState.ppmPeakHoldR) {
      meterState.ppmPeakHoldR = ppmDisplayR;
      meterState.ppmPeakTimeR = nowSec;
    } else if (nowSec - meterState.ppmPeakTimeR > PPM_PEAK_HOLD_SEC) {
      meterState.ppmPeakHoldR = ppmDisplayR;
      meterState.ppmPeakTimeR = nowSec;
    }
  }

  // Text display uses PPM values (dBu scale)
  if (dom.ppmLVal) dom.ppmLVal.textContent = isSilentL ? '--.-' : formatDbu(ppmL);
  if (dom.ppmRVal) dom.ppmRVal.textContent = isSilentR ? '--.-' : formatDbu(ppmR);

  // Draw PPM bar with dBFS values (-54 to -9 range)
  if (dom.ppmCanvas) {
    helpers.drawHBar_PPM(
      dom.ppmCanvas,
      ppmDisplayL,
      ppmDisplayR,
      meterState.ppmPeakHoldL,
      meterState.ppmPeakHoldR
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RMS / dBFS Meter
  // ─────────────────────────────────────────────────────────────────────────

  let dbfsL, dbfsR;

  if (isRemoteCapture) {
    // Use remote RMS values from meterState (already in dB)
    dbfsL = meterState.remoteRmsL;
    dbfsR = meterState.remoteRmsR;
  } else {
    // Local RMS calculation
    let rmsL = 0, rmsR = 0;
    for (let i = 0; i < meters.bufL.length; i++) {
      rmsL += meters.bufL[i] * meters.bufL[i];
      rmsR += meters.bufR[i] * meters.bufR[i];
    }
    rmsL = Math.sqrt(rmsL / meters.bufL.length);
    rmsR = Math.sqrt(rmsR / meters.bufR.length);

    // Smoothing
    const dt = Math.max(0.001, (now - meterState.lastRmsTs) / 1000);
    meterState.lastRmsTs = now;
    const tau = 0.3;
    const a = 1 - Math.exp(-dt / tau);
    meterState.rmsHoldL += a * (rmsL - meterState.rmsHoldL);
    meterState.rmsHoldR += a * (rmsR - meterState.rmsHoldR);

    dbfsL = 20 * Math.log10(meterState.rmsHoldL + 1e-12);
    dbfsR = 20 * Math.log10(meterState.rmsHoldR + 1e-12);
  }

  // Show "--.-" if signal is below bottom of scale (-60 dBFS)
  const dbfsLStr = (dbfsL <= -59) ? '--.-' : formatDb(dbfsL, 1);
  const dbfsRStr = (dbfsR <= -59) ? '--.-' : formatDb(dbfsR, 1);
  if (dom.dbL) dom.dbL.textContent = dbfsLStr;
  if (dom.dbR) dom.dbR.textContent = dbfsRStr;

  // Draw dBFS bar
  if (dom.dbfs) {
    helpers.drawHBar_DBFS(dom.dbfs, dbfsL, dbfsR);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // True Peak Meter
  // ─────────────────────────────────────────────────────────────────────────

  let tpLeft, tpRight;

  if (isRemoteCapture) {
    // Use remote values from meterState (set by handleRemoteMetrics)
    tpLeft = meterState.remoteTpL;
    tpRight = meterState.remoteTpR;
    // Peak holds and peak indicator already updated by handleRemoteMetrics
  } else {
    // Local metering
    meters.truePeakMeter.update(meters.bufL, meters.bufR);
    const tpState = meters.truePeakMeter.getState();
    tpLeft = tpState.dbtpLeft;
    tpRight = tpState.dbtpRight;

    // True Peak peak-hold
    if (tpLeft > meterState.tpPeakHoldL) {
      meterState.tpPeakHoldL = tpLeft;
      meterState.tpPeakTimeL = nowSec;
    } else if (nowSec - meterState.tpPeakTimeL > TP_PEAK_HOLD_SEC) {
      meterState.tpPeakHoldL = tpLeft;
      meterState.tpPeakTimeL = nowSec;
    }
    if (tpRight > meterState.tpPeakHoldR) {
      meterState.tpPeakHoldR = tpRight;
      meterState.tpPeakTimeR = nowSec;
    } else if (nowSec - meterState.tpPeakTimeR > TP_PEAK_HOLD_SEC) {
      meterState.tpPeakHoldR = tpRight;
      meterState.tpPeakTimeR = nowSec;
    }

    // Peak indicator for radar
    const currentTruePeak = Math.max(tpLeft, tpRight);
    if (currentTruePeak >= config.getTpLimit()) {
      meterState.peakIndicatorOn = true;
      meterState.peakIndicatorLastTrigger = now;
    } else if (now - meterState.peakIndicatorLastTrigger > PEAK_INDICATOR_HOLD_MS) {
      meterState.peakIndicatorOn = false;
    }
  }

  // Text display
  if (dom.tpL) dom.tpL.textContent = formatDb(tpLeft, 1);
  if (dom.tpR) dom.tpR.textContent = formatDb(tpRight, 1);

  // Draw True Peak bar
  if (dom.tp) {
    helpers.drawDiodeBar_TP(
      dom.tp,
      tpLeft,
      tpRight,
      meterState.tpPeakHoldL,
      meterState.tpPeakHoldR
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Uptime Display
  // ─────────────────────────────────────────────────────────────────────────

  const uptimeSec = (performance.now() - meterState.startTs) / 1000;
  const h = Math.floor(uptimeSec / 3600);
  const m = Math.floor((uptimeSec % 3600) / 60);
  const s = Math.floor(uptimeSec % 60);
  const ms = Math.floor((uptimeSec * 10) % 10);
  const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

  if (dom.uptimeEl) dom.uptimeEl.textContent = `${timeStr}.${ms}`;
  if (dom.statusSummary) dom.statusSummary.textContent = timeStr;

  // Schedule next frame
  animationFrameId = requestAnimationFrame(renderLoop);
}
