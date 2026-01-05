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
 * BOOTSTRAP MODULE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Wires modular components to the existing DOM structure from audio-meters-grid.html.
 * This file replaces the inline JavaScript while keeping identical HTML/CSS.
 *
 * @module app/bootstrap
 * ═══════════════════════════════════════════════════════════════════════════════
 */

console.log('%c[TSG] Bootstrap v2024-12-08-B loaded', 'color: lime; font-weight: bold');

import { Goniometer } from '../ui/goniometer.js';
import { CorrelationMeter } from '../ui/correlation-meter.js';
import { LoudnessRadar } from '../ui/radar.js';
import { LUFSMeter, formatLUFS } from '../metering/lufs.js';
import { TruePeakMeter, formatTruePeak, TRUE_PEAK_MODE } from '../metering/true-peak.js';
import { PPMMeter, formatPPM } from '../metering/ppm.js';
import { SamplePeakMeter } from '../metering/sample-peak.js';
import { StereoMeter, formatCorrelation, calculateCorrelation } from '../metering/correlation.js';
import { createStereoKWeightingFilters } from '../metering/k-weighting.js';
// Centralised state management
import { appState, InputMode } from './state.js';
// Source controller (prepared for phased integration)
import { SourceController, SignalType, RoutingMode } from './sources.js';
// Stereo analysis widgets
import { StereoAnalysisEngine } from '../ui/stereo-analysis.js';
import { WidthMeter } from '../ui/width-meter.js';
import { RotationMeter } from '../ui/rotation-meter.js';
import { SpectrumAnalyser } from '../ui/spectrum.js';
import { MSMeter } from '../ui/ms-meter.js';
import { BalanceMeter } from '../ui/balance-meter.js';
// Bar meters
import { drawHBar_DBFS, drawDiodeBar_TP, drawHBar_Nordic_PPM, drawHBar_BBC_PPM, drawSamplePeakBar, layoutDBFSScale, layoutTPScale, layoutNordicPPMScale, layoutBBCPPMScale, layoutSamplePeakScale, setTpLimit, updateTpLimitDisplay } from '../ui/bar-meter.js';
// Signal generator preset configuration
// Signal generation itself handled by SourceController
import { getPresetConfig as getPresetConfigFromModule } from '../generators/index.js';
// Measure loop (20 Hz) - extracted from bootstrap
import { initMeasureLoop, startMeasureLoop, stopMeasureLoop, pauseMeasurement, resumeMeasurement, toggleMeasurementPause, isMeasurementPaused } from './measure-loop.js';
// Render loop (60 Hz) - extracted from bootstrap
import { initRenderLoop, startRenderLoop, stopRenderLoop } from './render-loop.js';
// Shared meter state between measureLoop and renderLoop
import { meterState, resetMeterState, resetRemoteMeterState, MEASURE_INTERVAL_MS, TP_PEAK_HOLD_SEC, NORDIC_PPM_PEAK_HOLD_SEC, FRAME_HOLD_THRESHOLD } from './meter-state.js';
// Drag-and-drop system removed (see docs/PROJECT-A-DRAG-DROP-REMOVAL.md)
// Fixed layout provides consistent UX for broadcast monitoring
// Transition guard for EBU pulse blanking - extracted from bootstrap
import { TransitionGuard } from './transition-guard.js';
// Helper functions - extracted from bootstrap
import { dbToGain, clamp, formatDb, formatDbu, formatTime, getCss, formatCorr, loudnessColour as loudnessColourBase } from './helpers.js';
// Layout functions - extracted from bootstrap
import { initLayout, sizeWrap, layoutXY, layoutLoudness } from './layout.js';
// Bargraph meter (physics-based 3D carousel) - extracted from bootstrap
import { setupBargraphMeter, navigateTo as navigateToBargraph } from './bargraph-meter.js';
// Remote metering client
import { MetricsReceiver } from '../remote/client/index.js';
// Calibration system
import { CalibrationStatusBadge } from '../ui/calibration-badge.js';
import { VerificationStatusBadge } from '../ui/verification-badge.js';
import { HeaderCalIndicator } from '../ui/header-cal-indicator.js';
import { CalibrationWizard } from '../ui/calibration-wizard.js';
import { CalibrationEngine, applyActiveProfilesOnStartup } from '../calibration/index.js';
// Loudness history strip
import { LoudnessHistoryStrip } from '../ui/loudness-history.js';
// Stereo sampler (dual-mode L/R sync) - loaded dynamically for file:// compatibility
let stereoSamplerModule = null;
// Meter verification
import { VerificationModal } from '../ui/verification-modal.js';
// Session capture
import {
  SessionIndicator,
  isSessionHotkeyEnabled,
  setSessionHotkeyEnabled,
  isSessionCapturing,
  toggleSessionCapture,
  startSessionCapture,
  stopSessionCapture,
  loadSessionPreferences,
  exportSessionJSON,
  exportSessionXML
} from '../ui/session-indicator.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURABLE PARAMETERS
// ─────────────────────────────────────────────────────────────────────────────

// Initialise from centralised state (persisted in localStorage via appState)
let LOUDNESS_TARGET = appState.get('targetLufs');
let TP_LIMIT = appState.get('truePeakLimit');
let radarMaxSeconds = appState.get('radarMaxSeconds');
let historyDuration = appState.get('historyDuration');

// ─────────────────────────────────────────────────────────────────────────────
// DOM ELEMENT REFERENCES
// ─────────────────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

// Layout containers
const wrap = $('wrap');
const meters = $('meters');

// Loudness section
const loudnessMeter = $('loudnessMeter');
const loudnessRadar = $('loudnessRadar');
const radarWrap = loudnessMeter?.querySelector('.radarWrap');
const loudnessModule = loudnessMeter?.querySelector('.loudnessModule');
const peakLed = $('peakLed');
const radarExportBtn = $('radarExportBtn');
const radarExportJsonBtn = $('radarExportJsonBtn');
const radarTooltip = $('radarTooltip');

// Goniometer/Vectorscope (Spatial Analysis)
const spatialMeter = $('spatialMeter');
const xyWrap = $('xyWrap');
const xy = $('xy');
const corr = $('corr');
const corrVal = $('corrVal');

// Stereo analysis widgets
const monoDev = $('monoDev');
const monoDevVal = $('monoDevVal');
const widthMeter = $('widthMeter');
const rotationCanvas = $('rotationCanvas');
const spectrumAnalyser = $('spectrumAnalyser');
const kWeightToggle = $('kWeightToggle');
const msFillM = $('msFillM');
const msFillS = $('msFillS');
const msValueM = $('msValueM');
const msValueS = $('msValueS');

// Level meters
const dbfs = $('dbfs');
const dbfsScale = $('dbfsScale');
const dbL = $('dbL');
const dbR = $('dbR');
const tp = $('tp');
const tpScale = $('tpScale');
const tpL = $('tpL');
const tpR = $('tpR');
const nordicCanvas = $('nordicCanvas');
const nordicScale = $('nordicScale');
const nordicLVal = $('nordicLVal');
const nordicRVal = $('nordicRVal');
const bbcCanvas = $('bbcCanvas');
const bbcScale = $('bbcScale');
const bbcLVal = $('bbcLVal');
const bbcRVal = $('bbcRVal');
const spCanvas = $('spCanvas');
const spScale = $('spScale');
const spLVal = $('spLVal');
const spRVal = $('spRVal');

// LUFS display
const lufsM = $('lufsM');
const lufsS = $('lufsS');
const lufsI = $('lufsI');
const lraEl = $('lra');
const r128TpMax = $('r128TpMax');
const r128Crest = $('r128Crest');
const r128Time = $('r128Time');
const r128Reset = $('r128Reset');
const btnMeasurePause = $('btnMeasurePause');

// Status elements
const ctxState = $('ctxState');
const uptimeEl = $('uptime');
const statusSummary = $('statusSummary');

// Source controls
const btnModeBrowser = $('btnModeBrowser');
const btnModeExternal = $('btnModeExternal');
const btnModeGenerator = $('btnModeGenerator');
const btnModeRemote = $('btnModeRemote');
const btnStartCapture = $('btnStartCapture');
const btnStopCapture = $('btnStopCapture');
const verificationBadgeContainer = $('verificationBadgeContainer');
const browserSourcePanel = $('browserSourcePanel');
const externalSourcePanel = $('externalSourcePanel');
const generatorSourcePanel = $('generatorSourcePanel');
const remoteSourcePanel = $('remoteSourcePanel');
const sourcePanelsContainer = $('sourcePanelsContainer');
const inputSourceSummary = $('inputSourceSummary');

// Remote source controls
const remoteBrokerUrl = $('remoteBrokerUrl');
const btnRemoteCheck = $('btnRemoteCheck');
const remoteBrokerStatus = $('remoteBrokerStatus');
const remoteLatency = $('remoteLatency');
const remoteProbeList = $('remoteProbeList');
const remoteWarning = $('remoteWarning');
const dbgRemote = $('dbgRemote');

// Browser source controls
const sysMonGainEl = $('sysMonGain');
const sysMonVal = $('sysMonVal');
const btnSysMonMute = $('btnSysMonMute');
const sysTrimRange = $('sysTrimRange');
const sysTrimVal = $('sysTrimVal');
const sysTrimReset = $('sysTrimReset');
const srcKind = $('srcKind');
const cc = $('cc');
const sr = $('sr');
const stOK = $('stOK');

// Generator controls
const genPreset = $('genPreset');
const genModeVal = $('genModeVal');
const genStereoIdVal = $('genStereoIdVal');
const monGainEl = $('monGain');

// Status panel elements
const dbgTab = $('dbgTab');
const dbgExt = $('dbgExt');
const dbgGen = $('dbgGen');
const monitorStatusEl = $('monitorStatus');
const monVal = $('monVal');
const btnMonMute = $('btnMonMute');

// External device controls
const extDeviceSelect = $('extDeviceSelect');
const btnExtRefresh = $('btnExtRefresh');
const extMonGainEl = $('extMonGain');
const extMonVal = $('extMonVal');
const btnExtMonMute = $('btnExtMonMute');
const extTrimRange = $('extTrimRange');
const extTrimVal = $('extTrimVal');
const extDevice = $('extDevice');
const extCc = $('extCc');
const extSr = $('extSr');
const extStatus = $('extStatus');

// Bargraph meter
const bargraphMeter = $('bargraphMeter');
const bargraphBadge = $('bargraphBadge');

// Settings
const targetPreset = $('targetPreset');
const tpLimitSelect = $('tpLimit');
const radarSweep = $('radarSweep');

// Sidebar toggle
const sidebarToggle = $('sidebarToggle');

// Calibration system
const calibrationBadgeContainer = $('calibrationBadgeContainer');
const calibrationWizardContainer = $('calibrationWizardContainer');
const headerCalIndicator = $('headerCalIndicator');
const calStatusBox = $('calStatusBox');
const calStatusProfile = $('calStatusProfile');
const calStatusStandard = $('calStatusStandard');

// Session indicator element (for badge sync)
const headerSessionIndicator = $('headerSessionIndicator');

/** Pending badge sync frame */
let badgeSyncPending = false;

/**
 * Sync widths of calibration and session badges.
 * Whichever is wider determines the width of both.
 * Batched via rAF for smooth, GPU-efficient animation.
 */
function syncBadgeWidths() {
  if (badgeSyncPending) return;
  badgeSyncPending = true;

  requestAnimationFrame(() => {
    badgeSyncPending = false;
    if (!headerCalIndicator || !headerSessionIndicator) return;

    const calVisible = headerCalIndicator.style.display !== 'none';
    const sessionVisible = headerSessionIndicator.style.display !== 'none';

    if (!calVisible && !sessionVisible) return;

    // Batch read: temporarily remove width to measure content
    if (calVisible) headerCalIndicator.style.width = 'auto';
    if (sessionVisible) headerSessionIndicator.style.width = 'auto';

    // Single forced reflow - measure both
    const calWidth = calVisible ? headerCalIndicator.offsetWidth : 0;
    const sessionWidth = sessionVisible ? headerSessionIndicator.offsetWidth : 0;
    const maxWidth = Math.max(calWidth, sessionWidth);

    // Batch write: set both widths (CSS transition handles animation)
    if (maxWidth > 0) {
      const widthPx = `${maxWidth}px`;
      if (calVisible) headerCalIndicator.style.width = widthPx;
      if (sessionVisible) headerSessionIndicator.style.width = widthPx;
    }
  });
}

// Loudness history strip
const loudnessHistoryCanvas = $('loudnessHistoryCanvas');
const loudnessHistoryDuration = $('loudnessHistoryDuration');

// ─────────────────────────────────────────────────────────────────────────────
// AUDIO CONTEXT AND ROUTING
// ─────────────────────────────────────────────────────────────────────────────

let ac;
try {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error('Web Audio API not supported in this browser');
  }
  ac = new AudioContextClass({ sampleRate: 48000 });
} catch (e) {
  console.error('[TSG] Failed to create AudioContext:', e);
  // Show error in UI
  const errorEl = document.createElement('div');
  errorEl.className = 'audio-error';
  errorEl.innerHTML = `
    <h2>Audio Not Available</h2>
    <p>Web Audio API is required but not available: ${e.message}</p>
    <p>Please use a modern browser (Chrome, Firefox, Safari, Edge).</p>
  `;
  errorEl.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--bg,#1a1a2e);color:var(--hot,#ff6b6b);text-align:center;padding:2rem;z-index:9999;';
  document.body.appendChild(errorEl);
  throw e; // Re-throw to halt further initialisation
}

function updateCtxState() {
  if (ctxState) ctxState.textContent = ac.state === 'running' ? 'Yes' : 'No';
}
updateCtxState();
ac.onstatechange = updateCtxState;

// Analysis bus: discrete L/R paths
const mixL = ac.createGain();
const mixR = ac.createGain();
mixL.gain.value = 1;
mixR.gain.value = 1;

// Analysers for time-domain data
const analyserL = ac.createAnalyser();
const analyserR = ac.createAnalyser();
analyserL.fftSize = 4096;
analyserR.fftSize = 4096;
analyserL.smoothingTimeConstant = 0;
analyserR.smoothingTimeConstant = 0;

mixL.connect(analyserL);
mixR.connect(analyserR);

// K-weighted signal path for LUFS measurement (ITU-R BS.1770-4)
// Separate from unweighted path used by True Peak, PPM, spectrum, correlation
const kWeightFilters = createStereoKWeightingFilters(ac);
const kAnalyserL = ac.createAnalyser();
const kAnalyserR = ac.createAnalyser();
kAnalyserL.fftSize = 4096;
kAnalyserR.fftSize = 4096;
kAnalyserL.smoothingTimeConstant = 0;
kAnalyserR.smoothingTimeConstant = 0;

// Connect: mixL/R → K-weight filters → K-weighted analysers
mixL.connect(kWeightFilters.left.input);
mixR.connect(kWeightFilters.right.input);
kWeightFilters.left.output.connect(kAnalyserL);
kWeightFilters.right.output.connect(kAnalyserR);

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE CONTROLLER (Phase 1: instantiation and connection)
// ─────────────────────────────────────────────────────────────────────────────
// The SourceController manages all audio input sources (browser, external, generator)
// in a unified way. During phased integration, it runs in parallel with legacy code.
const sourceController = new SourceController(ac);
sourceController.connectOutput(mixL, mixR);
console.log('%c[TSG] SourceController instantiated and connected to analysis bus', 'color: cyan');

// Initialise stereo sampler (dual-mode L/R sync)
// Attempts AudioWorklet first (preferred), falls back to ScriptProcessorNode if unavailable.
// Dynamic import for file:// compatibility (Chrome blocks static ES module imports on file://)
// See docs/STEREO-SAMPLING-ARCHITECTURE.md
const stereoSyncModeEl = document.getElementById('stereoSyncMode');
import('../audio/stereo-sampler.js').then(async (module) => {
  stereoSamplerModule = module;
  const mode = await module.initStereoSampler(ac, mixL, mixR);
  if (stereoSyncModeEl) {
    if (mode === 'worklet') {
      stereoSyncModeEl.textContent = 'AudioWorklet';
    } else if (mode === 'scriptprocessor') {
      stereoSyncModeEl.textContent = 'ScriptProcessor';
    }
  }
}).catch(e => {
  console.warn('[TSG] Stereo sampler not available:', e.message);
  if (stereoSyncModeEl) stereoSyncModeEl.textContent = 'Unavailable';
});

// Shared sample buffers (sampled ONCE per frame)
const FFT_SIZE = 4096;
const bufL = new Float32Array(FFT_SIZE);
const bufR = new Float32Array(FFT_SIZE);

// K-weighted sample buffers for LUFS measurement
const kBufL = new Float32Array(FFT_SIZE);
const kBufR = new Float32Array(FFT_SIZE);

/**
 * Sample L/R audio buffers.
 * Uses AudioWorklet for sample-accurate sync (preferred), or
 * falls back to ScriptProcessorNode if AudioWorklet is unavailable.
 * @see docs/STEREO-SAMPLING-ARCHITECTURE.md
 */
function sampleAnalysers() {
  if (stereoSamplerModule?.isWorkletMode?.()) {
    // AudioWorklet mode: use pre-synchronized buffers
    const { bufL: wBufL, bufR: wBufR, ready } = stereoSamplerModule.getWorkletBuffers();
    if (ready) {
      // Copy worklet buffers to our buffers (they may be different sizes)
      const copyLen = Math.min(bufL.length, wBufL.length);
      bufL.set(wBufL.subarray(wBufL.length - copyLen));
      bufR.set(wBufR.subarray(wBufR.length - copyLen));
    }
    // If not ready, keep previous buffer values (no glitchy updates)
  } else {
    // Analyser mode: sequential reads with glitch filtering in meters
    analyserL.getFloatTimeDomainData(bufL);
    analyserR.getFloatTimeDomainData(bufR);
  }
}

function sampleKWeightedAnalysers() {
  kAnalyserL.getFloatTimeDomainData(kBufL);
  kAnalyserR.getFloatTimeDomainData(kBufR);
}

// ─────────────────────────────────────────────────────────────────────────────
// METERING INSTANCES
// ─────────────────────────────────────────────────────────────────────────────

const lufsMeter = new LUFSMeter({ sampleRate: ac.sampleRate, blockSize: FFT_SIZE });
const truePeakMeter = new TruePeakMeter({
  mode: appState.get('truePeakMode') || TRUE_PEAK_MODE.HERMITE
});
const ppmMeter = new PPMMeter({ sampleRate: ac.sampleRate, detectorMode: 'rc' });
const samplePeakMeter = new SamplePeakMeter();
const stereoMeter = new StereoMeter();

// ─────────────────────────────────────────────────────────────────────────────
// UI COMPONENT INSTANCES
// ─────────────────────────────────────────────────────────────────────────────

let goniometer = null;
let correlationMeter = null;
let radar = null;
// Stereo analysis instances
let stereoAnalysis = null;
let widthMeterUI = null;
let rotationMeterUI = null;
let spectrumAnalyserUI = null;
let msMeterUI = null;
let balanceMeterUI = null;
// Remote metering receiver instance
let remoteReceiver = null;
let isRemoteAvailable = false;
// Calibration system instances
let calibrationEngine = null;
let calibrationBadge = null;
let calibrationWizard = null;
let headerCalIndicatorInstance = null;

// Verification system instances
let verificationBadge = null;
// Session capture indicator instance
let sessionIndicator = null;
// Loudness history strip instance
let loudnessHistoryStrip = null;
// Radar tooltip hover position (for dynamic updates in render loop)
let radarHoverPos = null;
let radarTooltipRefs = null;  // { radar, tooltip } set by initUIComponents

/** Update radar tooltip at current hover position (called from render loop) */
function updateRadarTooltip() {
  if (!radarHoverPos || !radarTooltipRefs) return;
  const { radar, tooltip } = radarTooltipRefs;

  const point = radar.getPointAtPosition(
    radarHoverPos.x, radarHoverPos.y,
    meterState.radarHistory, radarMaxSeconds
  );

  if (point) {
    // tabular-nums in CSS handles fixed-width digits
    const sec = Math.round(point.age % 60);
    const ageStr = point.age < 60
      ? `${sec}s ago`
      : `${Math.floor(point.age / 60)}m ${sec}s ago`;
    tooltip.innerHTML = `
      <div class="tooltip-lufs">${point.lufs.toFixed(1)} LUFS</div>
      <div class="tooltip-time">${ageStr}</div>
    `;
    tooltip.style.display = 'block';
    tooltip.style.left = `${radarHoverPos.x}px`;
    tooltip.style.top = `${radarHoverPos.y}px`;
  } else {
    tooltip.style.display = 'none';
  }
}
// Meter verification modal
let verificationModal = null;

function initUIComponents() {
  if (xy) {
    goniometer = new Goniometer(xy);
  }
  if (corr) {
    correlationMeter = new CorrelationMeter(corr, corrVal, getCss, formatCorr);
  }
  if (loudnessRadar) {
    radar = new LoudnessRadar(loudnessRadar, LOUDNESS_TARGET);
  }

  // Radar export buttons
  if (radarExportBtn && radar) {
    radarExportBtn.onclick = () => {
      radar.downloadPNG();
    };
  }

  if (radarExportJsonBtn && radar) {
    radarExportJsonBtn.onclick = () => {
      // Collect current stats from meterState
      const stats = {
        integrated: meterState.integratedLufs,
        lra: meterState.lra,
        tpMax: Math.max(meterState.tpMaxL, meterState.tpMaxR)
      };
      radar.downloadJSON(meterState.radarHistory, stats);
    };
  }

  // Radar hover tooltip - tracks mouse position for dynamic updates
  if (loudnessRadar && radarTooltip && radar) {
    loudnessRadar.addEventListener('mousemove', (e) => {
      const rect = loudnessRadar.getBoundingClientRect();
      radarHoverPos = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
      updateRadarTooltip();
    });

    loudnessRadar.addEventListener('mouseleave', () => {
      radarHoverPos = null;
      radarTooltip.style.display = 'none';
    });

    // Store refs for dynamic updates in render loop
    radarTooltipRefs = { radar, tooltip: radarTooltip };
  }

  // Stereo analysis engine
  stereoAnalysis = new StereoAnalysisEngine();

  // Width meter
  if (widthMeter) {
    widthMeterUI = new WidthMeter(widthMeter);
  }

  // Rotation meter
  if (rotationCanvas) {
    rotationMeterUI = new RotationMeter(rotationCanvas);
  }

  // Spectrum analyser
  if (spectrumAnalyser) {
    spectrumAnalyserUI = new SpectrumAnalyser(spectrumAnalyser, analyserL, analyserR);
  }

  // K-weighting curve toggle
  if (kWeightToggle && spectrumAnalyserUI) {
    kWeightToggle.onclick = () => {
      kWeightToggle.classList.toggle('active');
      spectrumAnalyserUI.setKWeightingVisible(kWeightToggle.classList.contains('active'));
    };
  }

  // M/S meter
  if (msFillM && msFillS) {
    msMeterUI = new MSMeter(msFillM, msFillS, msValueM, msValueS);
  }

  // Balance meter
  if (monoDev) {
    balanceMeterUI = new BalanceMeter(monoDev, monoDevVal);
  }

  // Layout scales
  layoutDBFSScale(dbfsScale);
  layoutTPScale(tpScale);
  layoutNordicPPMScale(nordicScale);
  layoutBBCPPMScale(bbcScale);
  layoutSamplePeakScale(spScale);

  // Synchronise UI controls with persisted state values
  if (targetPreset) {
    targetPreset.value = String(LOUDNESS_TARGET);
  }
  if (tpLimitSelect) {
    tpLimitSelect.value = String(TP_LIMIT);
    setTpLimit(TP_LIMIT);
  }

  // Loudness history strip
  if (loudnessHistoryCanvas) {
    loudnessHistoryStrip = new LoudnessHistoryStrip(loudnessHistoryCanvas, {
      duration: historyDuration,
      target: LOUDNESS_TARGET,
      tolerance: 1
    });

    // Trace visibility toggle buttons
    const traceToggles = document.querySelectorAll('.trace-toggle[data-trace]');
    traceToggles.forEach(btn => {
      btn.addEventListener('click', () => {
        const trace = btn.dataset.trace;
        const nowVisible = loudnessHistoryStrip.setTraceVisible(trace);
        btn.classList.toggle('active', nowVisible);
      });
    });
  }

}

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT STATE
// ─────────────────────────────────────────────────────────────────────────────

// Layout freeze state removed with drag-and-drop system
// Layouts now update immediately on resize (no drag interference)

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS (wrapper for loudnessColour with LOUDNESS_TARGET binding)
// ─────────────────────────────────────────────────────────────────────────────

// Wrapper that binds LOUDNESS_TARGET to imported loudnessColourBase
function loudnessColour(lufs) {
  return loudnessColourBase(lufs, LOUDNESS_TARGET);
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE MANAGEMENT - EXACT from audio-meters-grid.html lines 3835-3970
// ─────────────────────────────────────────────────────────────────────────────

// State: selectedMode = UI selection, activeCapture = currently running source
let selectedInputMode = 'browser'; // 'browser', 'external', 'generator'
let activeCapture = null; // null, 'browser', 'external', 'generator'

// Generator monitor and EBU pulse state
let monitorMuted = false;
let ebuModeActive = false;
let ebuPrevState = true;
let leftMuteTimer = 0;

// Browser source UI state (audio managed by SourceController)
let sysMonitorMuted = true;
let sysTrimDb = 0;
const SYS_TRIM_DEFAULT = -12;
const SYS_TRIM_STORAGE_KEY = 'tsg_sysTrimDb';

// External source UI state (audio managed by SourceController)
let extMonitorMuted = true;
let extTrimDb = 0;
const EXT_TRIM_DEFAULT = 0;
const EXT_TRIM_STORAGE_KEY = 'tsg_extTrimDb';
const EXT_DEVICE_STORAGE_KEY = 'tsg_extDeviceId';

// Browser trim control
// Uses SourceController for unified input gain management
function setSysTrim(dB, save = true) {
  const parsed = parseFloat(dB);
  sysTrimDb = clamp(isNaN(parsed) ? SYS_TRIM_DEFAULT : parsed, -48, 24);
  if (sysTrimRange) sysTrimRange.value = sysTrimDb;
  if (sysTrimVal) sysTrimVal.value = Math.round(sysTrimDb);
  sourceController.setBrowserTrim(sysTrimDb);
  if (save) { try { localStorage.setItem(SYS_TRIM_STORAGE_KEY, sysTrimDb.toFixed(1)); } catch(e) { console.warn('Could not save browser trim setting'); } }
}

// Restore saved browser trim
const storedSysTrim = localStorage.getItem(SYS_TRIM_STORAGE_KEY);
setSysTrim(storedSysTrim !== null ? parseFloat(storedSysTrim) : SYS_TRIM_DEFAULT, false);

// External trim control
// Uses SourceController for unified input gain management
function setExtTrim(dB, save = true) {
  const parsed = parseFloat(dB);
  extTrimDb = clamp(isNaN(parsed) ? EXT_TRIM_DEFAULT : parsed, -48, 24);
  if (extTrimRange) extTrimRange.value = extTrimDb;
  if (extTrimVal) extTrimVal.value = Math.round(extTrimDb);
  sourceController.setExternalTrim(extTrimDb);
  if (save) try { localStorage.setItem(EXT_TRIM_STORAGE_KEY, extTrimDb.toFixed(1)); } catch (e) { console.warn('Could not save external trim setting'); }
}

// Restore saved external trim
const storedExtTrim = localStorage.getItem(EXT_TRIM_STORAGE_KEY);
setExtTrim(storedExtTrim !== null ? parseFloat(storedExtTrim) : EXT_TRIM_DEFAULT, false);

// Toggle browser monitor mute
// Uses SourceController for unified monitor management
function toggleSysMonitorMute() {
  sysMonitorMuted = sourceController.toggleBrowserMonitorMute();
  if (sysMonVal) sysMonVal.value = Math.round(sysMonGainEl?.value || 20);
  // RED when muted, neutral when not muted
  if (sysMonitorMuted) {
    if (btnSysMonMute) { btnSysMonMute.classList.add('btn-muted'); btnSysMonMute.classList.remove('btn-ghost'); }
  } else {
    if (btnSysMonMute) { btnSysMonMute.classList.remove('btn-muted'); btnSysMonMute.classList.add('btn-ghost'); }
  }
  updateStatusPanel();
}

// Toggle external monitor mute
// Uses SourceController for unified monitor management
function toggleExtMonitorMute() {
  extMonitorMuted = sourceController.toggleExternalMonitorMute();
  if (extMonVal) extMonVal.value = Math.round(extMonGainEl?.value || 20);
  // RED when muted, neutral when not muted
  if (extMonitorMuted) {
    if (btnExtMonMute) { btnExtMonMute.classList.add('btn-muted'); btnExtMonMute.classList.remove('btn-ghost'); }
  } else {
    if (btnExtMonMute) { btnExtMonMute.classList.remove('btn-muted'); btnExtMonMute.classList.add('btn-ghost'); }
  }
  updateStatusPanel();
}

// --- Input Mode Switching (UI only, does NOT stop/start capture) ---
// Uses collapse-swap-expand animation pattern for smooth transitions
// EXACT from audio-meters-grid.html lines 3870-3920
let isAnimatingPanels = false;
const PANEL_ANIMATION_MS = 200;

function setInputMode(mode) {
  // Skip if already on this mode or currently animating
  if (mode === selectedInputMode || isAnimatingPanels) return;

  const previousMode = selectedInputMode;
  selectedInputMode = mode;

  // Update appState.inputMode for calibration system
  const inputModeMap = {
    'browser': InputMode.BROWSER,
    'external': InputMode.EXTERNAL,
    'generator': InputMode.GENERATOR,
    'remote': InputMode.EXTERNAL  // Remote treated as external for calibration
  };
  appState.set({ inputMode: inputModeMap[mode] || InputMode.GENERATOR });

  // Clear remote mode on calibration engine when switching away from remote
  if (previousMode === 'remote' && mode !== 'remote' && calibrationEngine) {
    calibrationEngine.setRemoteMode({ enabled: false });
    appState.set({ remoteProbeId: null, remoteProbeName: null });
  }

  // Update button states immediately
  [btnModeBrowser, btnModeExternal, btnModeGenerator, btnModeRemote].forEach(btn => {
    if (btn) {
      btn.classList.remove('btn-active');
      btn.classList.add('btn-ghost');
    }
  });
  if (mode === 'browser' && btnModeBrowser) {
    btnModeBrowser.classList.add('btn-active');
    btnModeBrowser.classList.remove('btn-ghost');
  } else if (mode === 'external' && btnModeExternal) {
    btnModeExternal.classList.add('btn-active');
    btnModeExternal.classList.remove('btn-ghost');
  } else if (mode === 'generator' && btnModeGenerator) {
    btnModeGenerator.classList.add('btn-active');
    btnModeGenerator.classList.remove('btn-ghost');
  } else if (mode === 'remote' && btnModeRemote) {
    btnModeRemote.classList.add('btn-active');
    btnModeRemote.classList.remove('btn-ghost');
  }

  // Collapse-swap-expand animation
  isAnimatingPanels = true;

  // Step 1: Collapse the container
  if (sourcePanelsContainer) sourcePanelsContainer.classList.add('collapsed');

  // Step 2: After collapse animation, swap panels
  setTimeout(() => {
    // Hide all panels
    if (browserSourcePanel) browserSourcePanel.classList.remove('source-panel-active');
    if (externalSourcePanel) externalSourcePanel.classList.remove('source-panel-active');
    if (generatorSourcePanel) generatorSourcePanel.classList.remove('source-panel-active');
    if (remoteSourcePanel) remoteSourcePanel.classList.remove('source-panel-active');

    // Show the new panel
    if (mode === 'browser' && browserSourcePanel) browserSourcePanel.classList.add('source-panel-active');
    else if (mode === 'external' && externalSourcePanel) externalSourcePanel.classList.add('source-panel-active');
    else if (mode === 'generator' && generatorSourcePanel) generatorSourcePanel.classList.add('source-panel-active');
    else if (mode === 'remote' && remoteSourcePanel) remoteSourcePanel.classList.add('source-panel-active');

    // Step 3: Expand to new height
    if (sourcePanelsContainer) sourcePanelsContainer.classList.remove('collapsed');

    // Enumerate devices when switching to external mode
    if (mode === 'external') enumerateAudioDevices();
    // Connect to broker when switching to remote mode - shows probes immediately
    if (mode === 'remote') connectRemoteBroker();

    // Animation complete after expand
    setTimeout(() => {
      isAnimatingPanels = false;
    }, PANEL_ANIMATION_MS);
  }, PANEL_ANIMATION_MS);

  // Update start/stop button state based on whether THIS mode is capturing
  updateCaptureButtons();
  updateInputSourceSummary();
}

function updateCaptureButtons() {
  const isActiveMode = activeCapture === selectedInputMode;
  const isAnyCapture = activeCapture !== null;

  if (isActiveMode) {
    if (btnStartCapture) {
      btnStartCapture.disabled = true;
      btnStartCapture.classList.add('capture-active');
    }
    if (btnStopCapture) btnStopCapture.disabled = false;
  } else {
    if (btnStartCapture) {
      btnStartCapture.disabled = false;
      btnStartCapture.classList.remove('capture-active');
    }
    if (btnStopCapture) btnStopCapture.disabled = !isAnyCapture || activeCapture !== selectedInputMode;
  }
  // If viewing a different mode than active, show stop as disabled
  if (activeCapture && activeCapture !== selectedInputMode) {
    if (btnStopCapture) btnStopCapture.disabled = true;
  }

  // Update source buttons with measuring pulse
  [
    [btnModeBrowser, 'browser'],
    [btnModeExternal, 'external'],
    [btnModeGenerator, 'generator'],
    [btnModeRemote, 'remote']
  ].forEach(([btn, mode]) => {
    if (btn) btn.classList.toggle('source-measuring', activeCapture === mode);
  });
}

function updateInputSourceSummary() {
  if (!inputSourceSummary) return;
  if (!activeCapture) {
    inputSourceSummary.textContent = 'Inactive';
  } else if (activeCapture === 'browser') {
    inputSourceSummary.textContent = 'Browser Active';
  } else if (activeCapture === 'external') {
    inputSourceSummary.textContent = 'External Active';
  } else if (activeCapture === 'generator') {
    inputSourceSummary.textContent = 'Tone Active';
  } else if (activeCapture === 'remote') {
    inputSourceSummary.textContent = 'Remote Active';
  }
  updateStatusPanel();
}

// Update status panel with capture and monitor states
function updateStatusPanel() {
  // Capture status
  if (dbgTab) dbgTab.textContent = activeCapture === 'browser' ? 'Running' : 'Stopped';
  if (dbgExt) dbgExt.textContent = activeCapture === 'external' ? 'Running' : 'Stopped';
  if (dbgGen) dbgGen.textContent = activeCapture === 'generator' ? 'Running' : 'Stopped';
  if (dbgRemote) dbgRemote.textContent = activeCapture === 'remote' ? 'Running' : 'Stopped';

  // Monitor status
  if (monitorStatusEl) {
    const tabMon = sysMonitorMuted ? 'Muted' : 'Unmuted';
    const extMon = extMonitorMuted ? 'Muted' : 'Unmuted';
    const genMon = monitorMuted ? 'Muted' : 'Unmuted';
    monitorStatusEl.innerHTML = `Tab: <b>${tabMon}</b> · Ext: <b>${extMon}</b> · Gen: <b>${genMon}</b>`;
  }
}

async function enumerateAudioDevices() {
  if (!extDeviceSelect) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === 'audioinput');
    extDeviceSelect.innerHTML = audioInputs.map(d =>
      `<option value="${d.deviceId}">${d.label || 'Audio Input ' + d.deviceId.slice(0, 8)}</option>`
    ).join('');
  } catch (e) {
    console.warn('[Bootstrap] Could not enumerate devices:', e);
  }
}

// --- Unified Start Capture ---
// EXACT from audio-meters-grid.html lines 3960-4000
async function startCapture() {
  // Stop any existing capture from OTHER sources first - SYNCHRONOUSLY
  // This is critical because getDisplayMedia() requires immediate user gesture context
  if (activeCapture && activeCapture !== selectedInputMode) {
    stopActiveCaptureSync();
  }

  // Resume AudioContext - this is safe to await for non-browser modes
  // For browser capture, we do it inside startBrowserCapture to preserve user gesture
  if (selectedInputMode !== 'browser') {
    await ac.resume();
  }

  try {
    if (selectedInputMode === 'browser') {
      await startBrowserCapture();
    } else if (selectedInputMode === 'external') {
      await startExternalCapture();
    } else if (selectedInputMode === 'generator') {
      await startGeneratorCapture();
    } else if (selectedInputMode === 'remote') {
      await startRemoteCapture();
    }
  } catch (error) {
    console.error('[Bootstrap] Capture failed:', error);
  }
}

/**
 * Synchronous version of stopActiveCapture to preserve user gesture context.
 * getDisplayMedia() requires being called directly from user gesture without
 * intervening async operations that break the gesture chain.
 */
function stopActiveCaptureSync() {
  try {
    if (activeCapture === 'browser') {
      stopBrowserCapture();
    } else if (activeCapture === 'external') {
      stopExternalCapture();
    } else if (activeCapture === 'generator') {
      stopGeneratorCapture();
    } else if (activeCapture === 'remote') {
      stopRemoteCapture();
    }
  } catch (err) {
    console.error('[Bootstrap] stopActiveCaptureSync error:', err);
    activeCapture = null;
  }
}

// Browser tab capture via SourceController
// Captures audio from browser tabs using getDisplayMedia API
async function startBrowserCapture() {
  try {
    // CRITICAL: getDisplayMedia must be called immediately in user gesture context
    // Do NOT await anything before this call or browser will reject it
    const track = await sourceController.startBrowserCapture();

    // Resume AudioContext after we have the stream (safe to await now)
    await ac.resume();

    // Initialise trim from persisted state
    sourceController.setBrowserTrim(sysTrimDb);

    // Update UI with track metadata
    const settings = track.getSettings ? track.getSettings() : {};
    if (srcKind) srcKind.textContent = (track.kind || 'audio').charAt(0).toUpperCase() + (track.kind || 'audio').slice(1);
    if (cc) cc.textContent = settings.channelCount ?? 'Unknown';
    if (sr) sr.textContent = ac.sampleRate + ' Hz';
    if (stOK) stOK.textContent = (settings.channelCount >= 2 ? 'Yes' : 'Uncertain/Mono?');

    // Default: muted (RED button)
    if (btnSysMonMute) { btnSysMonMute.classList.add('btn-muted'); btnSysMonMute.classList.remove('btn-ghost'); }
    sysMonitorMuted = true;

    activeCapture = 'browser';
    updateCaptureButtons();
    updateInputSourceSummary();
    // Enable measurement controls
    if (btnMeasurePause) btnMeasurePause.disabled = false;
    if (r128Reset) r128Reset.disabled = false;
  } catch (e) {
    console.error('[Bootstrap] Browser capture failed:', e);
    alert(e.message || e);
  }
}

// External device capture via SourceController
// Captures audio from microphones and audio interfaces using getUserMedia API
async function startExternalCapture() {
  try {
    await ac.resume();
    const deviceId = extDeviceSelect?.value;

    // Persist device selection for session restore
    if (deviceId) try { localStorage.setItem(EXT_DEVICE_STORAGE_KEY, deviceId); } catch { console.warn('Could not save device selection'); }

    // Initialise trim from persisted state before capture
    sourceController.setExternalTrim(extTrimDb);

    const track = await sourceController.startExternalCapture(deviceId);

    // Update UI with track metadata
    const settings = track.getSettings ? track.getSettings() : {};
    const label = track.label || 'External Device';
    if (extDevice) extDevice.textContent = label;

    // Store device ID and label in appState for calibration wizard etc.
    appState.set({ deviceId, deviceLabel: label });
    if (extCc) extCc.textContent = settings.channelCount ?? 'Unknown';
    if (extSr) extSr.textContent = ac.sampleRate + ' Hz';
    if (extStatus) extStatus.textContent = (settings.channelCount >= 2 ? 'Stereo' : 'Active');

    // Default: muted (RED button)
    if (btnExtMonMute) { btnExtMonMute.classList.add('btn-muted'); btnExtMonMute.classList.remove('btn-ghost'); }
    extMonitorMuted = true;

    activeCapture = 'external';
    updateCaptureButtons();
    updateInputSourceSummary();
    // Enable measurement controls
    if (btnMeasurePause) btnMeasurePause.disabled = false;
    if (r128Reset) r128Reset.disabled = false;
  } catch (e) {
    console.error('[Bootstrap] External capture failed:', e);
    alert(e.message || e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIGNAL GENERATOR CONTROL
// All signal generation now handled by SourceController
// ═══════════════════════════════════════════════════════════════════════════════

// Get preset configuration from selected option
// Uses imported getPresetConfigFromModule from generators/presets.js
function getPresetConfig() {
  return getPresetConfigFromModule(genPreset);
}

// Update Gen Mode display
function updateGenModeDisplay() {
  if (!genPreset || !genModeVal) return;
  const opt = genPreset.options[genPreset.selectedIndex];
  if (!opt) return;

  const type = opt.dataset.type || 'sine';
  const db = opt.dataset.db || '-18';
  const freq = opt.dataset.freq;
  const lo = opt.dataset.lo;
  const hi = opt.dataset.hi;
  const pulsed = opt.dataset.pulsed === 'true';

  let modeText = '';
  if (type === 'sine' || type === 'lissajous') {
    modeText = freq + ' Hz ' + db + ' dBFS';
  } else if (type === 'pink' || type === 'white' || type === 'brown') {
    modeText = type.charAt(0).toUpperCase() + type.slice(1) + ' ' + db + ' dBFS';
  } else if (type === 'sweep') {
    modeText = 'Sweep ' + db + ' dBFS';
  } else if (type === 'glits') {
    modeText = 'GLITS ' + db + ' dBFS';
  } else if (type === 'full-scale-seq') {
    modeText = 'Full Scale Seq (−60→0 dBFS)';
  } else if (type === 'ppm-seq') {
    modeText = 'PPM Seq (−40→+12 PPM)';
  } else {
    modeText = opt.textContent.split('·')[0].trim();
  }

  genModeVal.textContent = modeText;

  // Update Stereo ID status
  if (genStereoIdVal) {
    genStereoIdVal.textContent = pulsed ? 'Yes' : 'No';
  }
}

// Create and connect generator based on preset
// Uses SourceController for unified audio source management
async function startGeneratorCapture() {
  if (activeCapture === 'generator' && sourceController.isModeActive(InputMode.GENERATOR)) {
    // Already running - switch to new preset without full restart
    await switchGeneratorPreset();
    return;
  }

  const config = getPresetConfig();
  if (!config) return;

  await sourceController.startGenerator(config);

  activeCapture = 'generator';
  updateCaptureButtons();
  updateInputSourceSummary();
  updateGenModeDisplay();
  // Enable measurement controls
  if (btnMeasurePause) btnMeasurePause.disabled = false;
  if (r128Reset) r128Reset.disabled = false;
}

// Switch preset without full restart
// Uses SourceController.switchGeneratorPreset() to preserve monitor state
async function switchGeneratorPreset() {
  if (activeCapture !== 'generator') return;

  const config = getPresetConfig();
  if (!config) return;

  await sourceController.switchGeneratorPreset(config);
  updateGenModeDisplay();
}

// Stop browser tab capture
function stopBrowserCapture() {
  sourceController.stopBrowserCapture();
  sysMonitorMuted = true;
  if (activeCapture === 'browser') activeCapture = null;
  updateCaptureButtons();
  updateInputSourceSummary();
  // Disable measurement controls and reset state
  if (isMeasurementPaused()) resumeMeasurement();
  if (btnMeasurePause) btnMeasurePause.disabled = true;
  if (r128Reset) r128Reset.disabled = true;
  updatePauseButtonState(false);
}

// Stop external device capture
function stopExternalCapture() {
  sourceController.stopExternalCapture();
  if (extStatus) extStatus.textContent = 'Stopped';
  extMonitorMuted = true;
  if (activeCapture === 'external') activeCapture = null;
  updateCaptureButtons();
  updateInputSourceSummary();
  // Disable measurement controls and reset state
  if (isMeasurementPaused()) resumeMeasurement();
  if (btnMeasurePause) btnMeasurePause.disabled = true;
  if (r128Reset) r128Reset.disabled = true;
  updatePauseButtonState(false);
}

function stopGeneratorCapture() {
  sourceController.stopGenerator();
  // Reset EBU pulse state and visual transition guard
  ebuModeActive = false;
  TransitionGuard.reset();
  if (activeCapture === 'generator') activeCapture = null;
  updateCaptureButtons();
  updateInputSourceSummary();
  // Disable measurement controls and reset state
  if (isMeasurementPaused()) resumeMeasurement();
  if (btnMeasurePause) btnMeasurePause.disabled = true;
  if (r128Reset) r128Reset.disabled = true;
  updatePauseButtonState(false);
}

// ═══════════════════════════════════════════════════════════════════════════════
// REMOTE METERING
// Receives metrics from remote probes via WebSocket broker
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Connect to remote broker and fetch probe list.
 * Called when user selects Remote Probe mode - shows available probes immediately.
 */
async function connectRemoteBroker() {
  const url = remoteBrokerUrl?.value?.trim() || 'ws://localhost:8765';

  if (remoteBrokerStatus) remoteBrokerStatus.textContent = 'Connecting…';
  if (remoteWarning) remoteWarning.style.display = 'none';
  if (btnRemoteCheck) btnRemoteCheck.disabled = true;

  try {
    // Create receiver if needed
    if (!remoteReceiver) {
      remoteReceiver = new MetricsReceiver({ brokerUrl: url });

      // Subscribe to probe list changes - updates UI automatically
      remoteReceiver.onProbeListChange((probes) => {
        renderRemoteProbeList(probes);

        // Handle probe online/offline state changes for selected probe
        if (selectedRemoteProbeId && activeCapture === 'remote') {
          const selectedProbe = probes.find(p => p.id === selectedRemoteProbeId);

          if (!selectedProbe || !selectedProbe.isOnline) {
            // Probe went offline - reset all meter state and displays
            resetRemoteMeterState();
            clearRemoteDisplays();
          } else if (selectedProbe.isOnline) {
            // Probe is online - ensure we're subscribed (handles reconnection)
            // The subscribe() method is idempotent, so calling it again is safe
            remoteReceiver.subscribe(selectedRemoteProbeId);
          }
        }
      });

      // Subscribe to metrics (used when capture is active)
      remoteReceiver.onMetrics((probeId, metrics) => {
        handleRemoteMetrics(probeId, metrics);
      });

      // Subscribe to connection state
      remoteReceiver.onStatusChange((state) => {
        if (remoteBrokerStatus) {
          const stateText = {
            'connected': 'RX Connected',
            'connecting': 'Connecting…',
            'reconnecting': 'Reconnecting…',
            'disconnected': 'Disconnected',
            'error': 'Error'
          }[state] || state;
          remoteBrokerStatus.textContent = stateText;
          remoteBrokerStatus.style.color = state === 'connected' ? 'var(--ok)' :
                                           state === 'error' ? 'var(--hot)' : 'var(--warn)';
        }
        isRemoteAvailable = state === 'connected';
        if (remoteWarning) remoteWarning.style.display = isRemoteAvailable ? 'none' : '';
      });
    } else {
      // Update URL if receiver already exists
      remoteReceiver.brokerUrl = url;
    }

    // Connect and fetch probe list
    await remoteReceiver.connect();
    isRemoteAvailable = true;

    // Always refresh probe list when switching to remote mode (even if already connected)
    remoteReceiver.refreshProbeList();

    console.log(`[Bootstrap] Connected to remote broker ${url}`);
  } catch (error) {
    console.warn('[Bootstrap] Remote broker connection failed:', error);
    isRemoteAvailable = false;
    if (remoteBrokerStatus) {
      remoteBrokerStatus.textContent = 'Unavailable';
      remoteBrokerStatus.style.color = 'var(--hot)';
    }
    if (remoteWarning) remoteWarning.style.display = '';
  } finally {
    if (btnRemoteCheck) btnRemoteCheck.disabled = false;
  }

  return isRemoteAvailable;
}

/**
 * Start remote capture - subscribe to selected probes and begin receiving metrics.
 * Assumes connectRemoteBroker() was already called when switching to remote mode.
 */
async function startRemoteCapture() {
  // Ensure connected first
  if (!remoteReceiver || !isRemoteAvailable) {
    const connected = await connectRemoteBroker();
    if (!connected) {
      alert('Remote broker unavailable. Check URL and ensure broker is running.');
      return;
    }
  }

  // Get selected probe from radio button
  let selectedProbeId = null;
  if (remoteProbeList) {
    const selectedRadio = remoteProbeList.querySelector('input[type="radio"]:checked');
    if (selectedRadio) {
      const label = selectedRadio.closest('[data-probe-id]');
      selectedProbeId = label?.dataset.probeId;
    }
  }

  if (!selectedProbeId) {
    alert('Please select a probe to monitor.');
    return;
  }

  // Unsubscribe from previous probe if different
  if (selectedRemoteProbeId && selectedRemoteProbeId !== selectedProbeId) {
    remoteReceiver.unsubscribe(selectedRemoteProbeId);
  }

  // Subscribe to selected probe
  selectedRemoteProbeId = selectedProbeId;
  remoteReceiver.subscribe(selectedProbeId);

  // Store probe info in appState for calibration wizard
  const selectedProbe = remoteReceiver.probes.find(p => p.id === selectedProbeId);
  appState.set({
    remoteProbeId: selectedProbeId,
    remoteProbeName: selectedProbe?.name || `Probe ${selectedProbeId.slice(0, 8)}`
  });

  // Configure CalibrationEngine for remote mode
  if (calibrationEngine) {
    calibrationEngine.setRemoteMode({
      enabled: true,
      probeId: selectedProbeId,
      metricsGetter: () => ({
        momentary: parseFloat(lufsM?.dataset?.v) || -Infinity,
        shortTerm: meterState.shortTermLufs,
        integrated: meterState.integratedLufs,
        truePeak: Math.max(meterState.remoteTpL, meterState.remoteTpR)
      }),
      trimSender: (trimDb) => {
        remoteReceiver.sendTrim(selectedRemoteProbeId, trimDb);
      },
      getTrim: () => {
        // Remote probe trim not tracked locally; return 0 as baseline
        return 0;
      }
    });
  }

  activeCapture = 'remote';
  updateCaptureButtons();
  updateInputSourceSummary();
  // Enable measurement controls
  if (btnMeasurePause) btnMeasurePause.disabled = false;
  if (r128Reset) r128Reset.disabled = false;

  console.log(`[Bootstrap] Remote capture started, monitoring probe: ${selectedProbeId}`);
}

/**
 * Stop remote capture - unsubscribe from probe (but keep connection for UI).
 */
/**
 * Clear all remote meter displays to idle state.
 * Called when probe goes offline while capture is active.
 */
function clearRemoteDisplays() {
  // LUFS displays
  if (lufsM) { lufsM.textContent = ' --.- LUFS'; lufsM.style.color = ''; }
  if (lufsS) { lufsS.textContent = ' --.- LUFS'; lufsS.style.color = ''; }
  if (lufsI) { lufsI.textContent = ' --.- LUFS'; lufsI.style.color = ''; }
  if (lraEl) { lraEl.textContent = '--.- LU'; }
  if (r128TpMax) { r128TpMax.textContent = ' --.- dBTP'; r128TpMax.style.color = ''; }
  if (r128Crest) { r128Crest.textContent = '--.- dB'; }

  // Nordic PPM values
  if (nordicLVal) { nordicLVal.textContent = ''; }
  if (nordicRVal) { nordicRVal.textContent = ''; }

  // Correlation
  if (corrVal) { corrVal.textContent = '--'; corrVal.style.color = ''; }

  // M/S levels
  if (msValueM) { msValueM.textContent = '--'; }
  if (msValueS) { msValueS.textContent = '--'; }
  if (msFillM) { msFillM.style.width = '0%'; }
  if (msFillS) { msFillS.style.width = '0%'; }

  // Width meter
  if (widthMeterUI) { widthMeterUI.update(0, 0); }

  // Balance meter
  if (balanceMeterUI) { balanceMeterUI.update(0); }

  // Latency
  if (remoteLatency) { remoteLatency.textContent = '–'; }

  console.log('[Bootstrap] Remote displays cleared - probe offline');
}

function stopRemoteCapture() {
  try {
    // Unsubscribe from current probe but keep connection for probe list
    if (remoteReceiver && selectedRemoteProbeId) {
      remoteReceiver.unsubscribe(selectedRemoteProbeId);
    }

    selectedRemoteProbeId = null;

    // Clear remote probe info from appState
    appState.set({
      remoteProbeId: null,
      remoteProbeName: null
    });

    // Disable remote mode on calibration engine
    if (calibrationEngine) {
      calibrationEngine.setRemoteMode({ enabled: false });
    }

    // Reset meter state AND clear displays
    resetRemoteMeterState();
    clearRemoteDisplays();

    if (activeCapture === 'remote') activeCapture = null;
    updateCaptureButtons();
    updateInputSourceSummary();
    // Disable measurement controls and reset state
    if (isMeasurementPaused()) resumeMeasurement();
    if (btnMeasurePause) btnMeasurePause.disabled = true;
    if (r128Reset) r128Reset.disabled = true;
    updatePauseButtonState(false);
  } catch (err) {
    console.error('[Bootstrap] stopRemoteCapture error:', err);
    if (activeCapture === 'remote') activeCapture = null;
  }
}

/**
 * Render available probes list in remote panel.
 * @param {Array} probes - Available probes from broker
 */
/** @type {string|null} Currently selected remote probe ID */
let selectedRemoteProbeId = null;

function renderRemoteProbeList(probes) {
  if (!remoteProbeList) return;

  if (!probes || probes.length === 0) {
    remoteProbeList.innerHTML = '<p class="tiny" style="color:var(--muted);text-align:center;margin:8px 0">No probes available</p>';
    return;
  }

  // Use radio buttons - only one probe at a time
  remoteProbeList.innerHTML = probes.map(probe => {
    const displayName = escapeHtml(probe.name) || probe.id.slice(0, 8);
    const isSelected = selectedRemoteProbeId === probe.id;
    const statusDot = probe.isOnline
      ? '<span style="width:6px;height:6px;border-radius:50%;background:var(--ok);flex-shrink:0"></span>'
      : '<span style="width:6px;height:6px;border-radius:50%;background:var(--muted);flex-shrink:0"></span>';

    return `
      <label style="display:flex;align-items:center;gap:6px;padding:4px;cursor:pointer" data-probe-id="${probe.id}">
        <input type="radio" name="remoteProbe" ${isSelected ? 'checked' : ''} style="accent-color:var(--ok)" />
        ${statusDot}
        <span class="tiny">${displayName}</span>
        <span class="tiny" style="margin-left:auto;color:var(--muted)" id="latency-${probe.id}"></span>
      </label>
    `;
  }).join('');

  // Bind radio selection
  remoteProbeList.querySelectorAll('input[type="radio"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const label = e.target.closest('[data-probe-id]');
      const probeId = label?.dataset.probeId;
      if (!probeId || !remoteReceiver) return;

      // Unsubscribe from previous probe
      if (selectedRemoteProbeId && selectedRemoteProbeId !== probeId) {
        remoteReceiver.unsubscribe(selectedRemoteProbeId);
      }

      // Subscribe to new probe
      selectedRemoteProbeId = probeId;
      remoteReceiver.subscribe(probeId);

      // Store probe info in appState for calibration wizard
      const probe = probes.find(p => p.id === probeId);
      appState.set({
        remoteProbeId: probeId,
        remoteProbeName: probe?.name || `Probe ${probeId.slice(0, 8)}`
      });
    });
  });
}

/**
 * Handle received remote metrics.
 * Updates all meter displays with data from remote probe.
 *
 * @param {string} probeId - Source probe ID
 * @param {Object} metrics - Metrics data { lufs, truePeak, ppm, stereo, latency }
 */
function handleRemoteMetrics(probeId, metrics) {
  // Only process metrics from the selected probe
  if (probeId !== selectedRemoteProbeId) return;

  // Only update if we're in remote capture mode
  if (activeCapture !== 'remote') return;

  // Update latency displays
  const latencyEl = document.getElementById(`latency-${probeId}`);
  if (latencyEl && metrics.latency !== undefined) {
    latencyEl.textContent = `${metrics.latency}ms`;
  }
  if (remoteLatency && metrics.latency !== undefined) {
    remoteLatency.textContent = `${metrics.latency}ms`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LUFS DISPLAY
  // ─────────────────────────────────────────────────────────────────────────
  const { lufs, truePeak, ppm, rms, stereo, visualization } = metrics;

  if (lufs) {
    // Momentary LUFS
    if (lufsM) {
      const m = lufs.momentary;
      if (isFinite(m) && m > -100) {
        lufsM.textContent = formatLUFS(m);
        lufsM.style.color = loudnessColourBase(m);
        lufsM.dataset.v = m;
      } else {
        lufsM.textContent = '--.- LUFS';
        lufsM.style.color = '';
      }
    }

    // Short-term LUFS
    if (lufsS) {
      const s = lufs.shortTerm;
      if (isFinite(s) && s > -100) {
        lufsS.textContent = formatLUFS(s);
        lufsS.style.color = loudnessColourBase(s);
        meterState.shortTermLufs = s;
      } else {
        lufsS.textContent = '--.- LUFS';
        lufsS.style.color = '';
        meterState.shortTermLufs = -Infinity;
      }
    }

    // Integrated LUFS
    if (lufsI) {
      const i = lufs.integrated;
      if (isFinite(i) && i > -100) {
        lufsI.textContent = formatLUFS(i);
        lufsI.style.color = loudnessColourBase(i);
        meterState.integratedLufs = i;
      } else {
        lufsI.textContent = '--.- LUFS';
        lufsI.style.color = '';
        meterState.integratedLufs = -Infinity;
      }
    }

    // LRA
    if (lraEl) {
      const lra = lufs.lra;
      if (isFinite(lra) && lra >= 0) {
        // Fixed-width format: pad to 4 chars (e.g., " 5.2" or "12.3")
        lraEl.textContent = lra.toFixed(1).padStart(4, ' ') + ' LU';
      } else {
        lraEl.textContent = '--.- LU';
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RADAR HISTORY (short-term LUFS over time)
    // ─────────────────────────────────────────────────────────────────────────
    const st = lufs.shortTerm;
    if (isFinite(st) && st > -100) {
      const now = Date.now();
      const maxAge = radarMaxSeconds * 1000;
      // Remove stale entries
      while (meterState.radarHistory.length > 0 && now - meterState.radarHistory[0].t > maxAge) {
        meterState.radarHistory.shift();
      }
      // Add new entry
      meterState.radarHistory.push({ t: now, v: st });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TRUE PEAK DISPLAY
  // ─────────────────────────────────────────────────────────────────────────
  if (truePeak && r128TpMax) {
    const tpMax = Math.max(truePeak.left ?? -Infinity, truePeak.right ?? -Infinity);
    if (isFinite(tpMax) && tpMax > -100) {
      r128TpMax.textContent = formatTruePeak(tpMax);
      // Colour coding: red if over limit
      const TP_LIMIT = appState.get('truePeakLimit') ?? -1;
      r128TpMax.style.color = tpMax > TP_LIMIT ? 'var(--hot)' : '';
    } else {
      r128TpMax.textContent = '--.- dBTP';
      r128TpMax.style.color = '';
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // METER STATE for bar meters and visualizers
  // ─────────────────────────────────────────────────────────────────────────
  // Update meterState so render-loop can draw the bars (uses remote* fields)
  if (truePeak) {
    const tpL = truePeak.left ?? -60;
    const tpR = truePeak.right ?? -60;
    meterState.remoteTpL = tpL;
    meterState.remoteTpR = tpR;

    // Update peak hold for remote TP (3s hold logic)
    const now = performance.now() / 1000;
    if (tpL > meterState.tpPeakHoldL) {
      meterState.tpPeakHoldL = tpL;
      meterState.tpPeakTimeL = now;
    } else if (now - meterState.tpPeakTimeL > TP_PEAK_HOLD_SEC) {
      meterState.tpPeakHoldL = tpL;
      meterState.tpPeakTimeL = now;
    }
    if (tpR > meterState.tpPeakHoldR) {
      meterState.tpPeakHoldR = tpR;
      meterState.tpPeakTimeR = now;
    } else if (now - meterState.tpPeakTimeR > TP_PEAK_HOLD_SEC) {
      meterState.tpPeakHoldR = tpR;
      meterState.tpPeakTimeR = now;
    }

    // Peak indicator for radar
    const currentTruePeak = Math.max(tpL, tpR);
    if (currentTruePeak >= TP_LIMIT) {
      meterState.peakIndicatorOn = true;
      meterState.peakIndicatorLastTrigger = performance.now();
    }
  }

  if (ppm) {
    const nordicPpmL = ppm.left ?? -60;
    const nordicPpmR = ppm.right ?? -60;
    meterState.remoteNordicPpmL = nordicPpmL;
    meterState.remoteNordicPpmR = nordicPpmR;

    // Update Nordic PPM peak hold (3s hold logic)
    const now = performance.now() / 1000;
    if (nordicPpmL > meterState.nordicPeakHoldL) {
      meterState.nordicPeakHoldL = nordicPpmL;
      meterState.nordicPeakTimeL = now;
    } else if (now - meterState.nordicPeakTimeL > NORDIC_PPM_PEAK_HOLD_SEC) {
      meterState.nordicPeakHoldL = nordicPpmL;
      meterState.nordicPeakTimeL = now;
    }
    if (nordicPpmR > meterState.nordicPeakHoldR) {
      meterState.nordicPeakHoldR = nordicPpmR;
      meterState.nordicPeakTimeR = now;
    } else if (now - meterState.nordicPeakTimeR > NORDIC_PPM_PEAK_HOLD_SEC) {
      meterState.nordicPeakHoldR = nordicPpmR;
      meterState.nordicPeakTimeR = now;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BBC PPM TYPE IIa STATE
  // ─────────────────────────────────────────────────────────────────────────
  // BBC PPM uses True Peak as approximation for remote (sample-level quasi-peak
  // processing not possible without raw audio buffers)
  if (truePeak) {
    const bbcPpmL = truePeak.left ?? -60;
    const bbcPpmR = truePeak.right ?? -60;
    meterState.remoteBbcPpmL = bbcPpmL;
    meterState.remoteBbcPpmR = bbcPpmR;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RMS STATE (for dBFS meter)
  // ─────────────────────────────────────────────────────────────────────────
  if (rms) {
    meterState.remoteRmsL = rms.left ?? -60;
    meterState.remoteRmsR = rms.right ?? -60;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEREO STATE (for correlation, balance, width, rotation, M/S meters)
  // ─────────────────────────────────────────────────────────────────────────
  if (stereo) {
    meterState.remoteCorrelation = stereo.correlation ?? 0;
    meterState.remoteBalance = stereo.balance ?? 0;
    meterState.remoteWidth = stereo.width ?? 0;
    meterState.remoteWidthPeak = stereo.widthPeak ?? 0;
    meterState.remoteMidLevel = stereo.midLevel ?? -60;
    meterState.remoteSideLevel = stereo.sideLevel ?? -60;
    meterState.remoteRotation = stereo.rotation ?? 0;

    // Maintain rotation history (keep last 25 entries like StereoAnalysisEngine)
    meterState.remoteRotationHistory.push(meterState.remoteRotation);
    if (meterState.remoteRotationHistory.length > 25) {
      meterState.remoteRotationHistory.shift();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // VISUALISATION DATA (for goniometer + spectrum analyser)
  // Pre-computed on probe, transmitted as compact arrays
  // ─────────────────────────────────────────────────────────────────────────
  if (visualization) {
    // Goniometer: M/S points for vectorscope display
    // Array of [M0,S0, M1,S1, ...] normalised ±1
    if (visualization.goniometer && Array.isArray(visualization.goniometer)) {
      meterState.remoteGoniometerPoints = new Float32Array(visualization.goniometer);
    }

    // Spectrum: 1/3-octave band dB values (31 bands, 20 Hz–20 kHz)
    if (visualization.spectrum && Array.isArray(visualization.spectrum)) {
      meterState.remoteSpectrumBands = new Float32Array(visualization.spectrum);
    }
  }
}

/**
 * Escape HTML entities for safe insertion.
 * @param {string} str - String to escape
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stopCapture() {
  stopActiveCaptureSync();
}

// ─────────────────────────────────────────────────────────────────────────────
// FULLSCREEN TOGGLE (cross-browser)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Toggle fullscreen mode.
 * Handles all browser variants including Safari/Chrome on Mac.
 */
function toggleFullscreen() {
  const doc = document;
  const elem = document.documentElement;

  // Check if currently in fullscreen
  const isFullscreen = doc.fullscreenElement ||
                       doc.webkitFullscreenElement ||
                       doc.mozFullScreenElement ||
                       doc.msFullscreenElement;

  if (isFullscreen) {
    // Exit fullscreen
    if (doc.exitFullscreen) doc.exitFullscreen();
    else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
    else if (doc.mozCancelFullScreen) doc.mozCancelFullScreen();
    else if (doc.msExitFullscreen) doc.msExitFullscreen();
  } else {
    // Enter fullscreen
    if (elem.requestFullscreen) elem.requestFullscreen();
    else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
    else if (elem.mozRequestFullScreen) elem.mozRequestFullScreen();
    else if (elem.msRequestFullscreen) elem.msRequestFullscreen();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EBU TECH 3341 §5.5 PLAY/PAUSE UI
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update pause button visual state.
 * @param {boolean} paused - Current pause state
 */
function updatePauseButtonState(paused) {
  if (!btnMeasurePause) return;
  // Toggle SVG icon: pause bars vs play triangle
  const pauseBars = btnMeasurePause.querySelectorAll('.pause-bars');
  const playTriangle = btnMeasurePause.querySelector('.play-triangle');
  pauseBars.forEach(bar => bar.style.display = paused ? 'none' : '');
  if (playTriangle) playTriangle.style.display = paused ? '' : 'none';
  btnMeasurePause.title = paused ? 'Resume (P / Space)' : 'Pause (P / Space)';
  // Persistent visual state: amber when paused
  btnMeasurePause.classList.toggle('paused', paused);
}

// ─────────────────────────────────────────────────────────────────────────────
// MEASUREMENT LOOP (20 Hz) - Extracted to measure-loop.js
// ─────────────────────────────────────────────────────────────────────────────

// EBU pulse state (shared with measure-loop via object reference)
const ebuStateRef = {
  get ebuModeActive() { return ebuModeActive; },
  set ebuModeActive(v) { ebuModeActive = v; },
  get ebuPrevState() { return ebuPrevState; },
  set ebuPrevState(v) { ebuPrevState = v; },
  get leftMuteTimer() { return leftMuteTimer; },
  set leftMuteTimer(v) { leftMuteTimer = v; }
};

// Initialise measure loop with dependencies
initMeasureLoop({
  dom: { lufsM, lufsS, lufsI, lraEl, r128TpMax, r128Crest, r128Time, peakLed },
  meters: { lufsMeter, truePeakMeter, bufL, bufR, kBufL, kBufR, sampleKWeightedAnalysers },
  captureState: { getActiveCapture: () => activeCapture },
  ebuState: ebuStateRef,
  config: {
    getTargetLufs: () => LOUDNESS_TARGET,
    getTpLimit: () => TP_LIMIT,
    getRadarMaxSeconds: () => radarMaxSeconds
  },
  sourceController,
  TransitionGuard,
  getPresetConfig,
  loudnessColour
});

// Start the 20 Hz measurement loop
startMeasureLoop();

// ─────────────────────────────────────────────────────────────────────────────
// RENDER LOOP (60 Hz) - Extracted to render-loop.js
// ─────────────────────────────────────────────────────────────────────────────

// NOTE: initRenderLoop() must be called AFTER initUIComponents() to ensure
// UI component references are properly initialised. This is done in init().

// ─────────────────────────────────────────────────────────────────────────────
// EVENT BINDINGS
// ─────────────────────────────────────────────────────────────────────────────

function bindEvents() {
  // Source mode buttons - use setInputMode for animated transitions
  if (btnModeBrowser) btnModeBrowser.onclick = () => setInputMode('browser');
  if (btnModeExternal) btnModeExternal.onclick = () => setInputMode('external');
  if (btnModeGenerator) btnModeGenerator.onclick = () => setInputMode('generator');
  if (btnModeRemote) btnModeRemote.onclick = () => setInputMode('remote');

  // Remote broker check/reconnect button
  if (btnRemoteCheck) btnRemoteCheck.onclick = connectRemoteBroker;

  // Remote broker URL change (debounced, reconnects to new broker)
  let remoteUrlTimer = null;
  if (remoteBrokerUrl) {
    remoteBrokerUrl.addEventListener('input', () => {
      clearTimeout(remoteUrlTimer);
      remoteUrlTimer = setTimeout(() => {
        isRemoteAvailable = false; // Reset availability
        // Disconnect old connection and connect to new URL
        if (remoteReceiver) {
          remoteReceiver.disconnect();
          remoteReceiver = null;
        }
        connectRemoteBroker();
      }, 800);
    });
  }

  // Start/Stop capture
  if (btnStartCapture) btnStartCapture.onclick = startCapture;
  if (btnStopCapture) btnStopCapture.onclick = stopCapture;

  // Reset R128 - EXACT from audio-meters-grid.html resetR128 (lines 3767-3787)
  if (r128Reset) {
    r128Reset.onclick = () => {
      // If paused, resume first (EBU: reset works from any state)
      if (isMeasurementPaused()) {
        resumeMeasurement();
        updatePauseButtonState(false);
      }
      lufsMeter.reset();
      truePeakMeter.reset();
      resetMeterState();
      // Reset history strip
      if (loudnessHistoryStrip) loudnessHistoryStrip.reset();
      // Update display with fixed-width placeholders
      if (lufsM) lufsM.textContent = ' --.- LUFS';
      if (lufsS) lufsS.textContent = ' --.- LUFS';
      if (lufsI) { lufsI.textContent = ' --.- LUFS'; lufsI.classList.remove('paused'); }
      if (lraEl) { lraEl.textContent = '--.- LU'; lraEl.classList.remove('paused'); }
      if (r128TpMax) r128TpMax.textContent = ' --.- dBTP';
      if (r128Crest) r128Crest.textContent = '--.- dB';
      if (r128Time) r128Time.textContent = '--:--:--';
      updatePauseButtonState(false);
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Pause/Resume measurement (EBU Tech 3341 §5.5)
  // Intercom-style dual function: tap = toggle, hold = momentary (PTT)
  // Timing based on Riedel Bolero / ClearCom professional intercom systems
  // ─────────────────────────────────────────────────────────────────────────
  const MOMENTARY_THRESHOLD_MS = 300; // <300ms = toggle, >=300ms = momentary

  // Shared state for keyboard
  const pauseKeyState = {
    isDown: false,
    downTime: 0,
    stateBeforePress: false
  };

  // Shared state for GUI button
  const pauseBtnState = {
    isDown: false,
    downTime: 0,
    stateBeforePress: false
  };

  // Keyboard: keydown - immediate response
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;

    // R = Reset (with visual feedback matching mouse click)
    // Only trigger on plain R, not Cmd+R/Ctrl+R (browser refresh)
    if (e.code === 'KeyR' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (r128Reset && !r128Reset.disabled) {
        r128Reset.classList.add('key-active');
        r128Reset.click();
        // Remove after brief delay to show press effect
        setTimeout(() => r128Reset.classList.remove('key-active'), 100);
      }
      return;
    }

    // C = Session capture toggle (when hotkey enabled)
    if (e.code === 'KeyC' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (isSessionHotkeyEnabled()) {
        e.preventDefault();
        toggleSessionCapture();
        if (sessionIndicator) sessionIndicator.update();
      }
      return;
    }

    // Tab = Toggle sidebar menu
    if (e.code === 'Tab' && !e.repeat) {
      e.preventDefault();
      if (sidebarToggle) sidebarToggle.click();
      return;
    }

    // F = Toggle fullscreen (cross-browser)
    if (e.code === 'KeyF' && !e.repeat) {
      e.preventDefault();
      toggleFullscreen();
      return;
    }

    // S/M/I/T = Toggle loudness history traces
    if (e.code === 'KeyS' && !e.repeat && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const btn = document.querySelector('.trace-toggle[data-trace="s"]');
      if (btn && loudnessHistoryStrip) {
        const nowVisible = loudnessHistoryStrip.setTraceVisible('s');
        btn.classList.toggle('active', nowVisible);
      }
      return;
    }
    if (e.code === 'KeyM' && !e.repeat) {
      e.preventDefault();
      const btn = document.querySelector('.trace-toggle[data-trace="m"]');
      if (btn && loudnessHistoryStrip) {
        const nowVisible = loudnessHistoryStrip.setTraceVisible('m');
        btn.classList.toggle('active', nowVisible);
      }
      return;
    }
    if (e.code === 'KeyI' && !e.repeat) {
      e.preventDefault();
      const btn = document.querySelector('.trace-toggle[data-trace="i"]');
      if (btn && loudnessHistoryStrip) {
        const nowVisible = loudnessHistoryStrip.setTraceVisible('i');
        btn.classList.toggle('active', nowVisible);
      }
      return;
    }
    if (e.code === 'KeyT' && !e.repeat) {
      e.preventDefault();
      const btn = document.querySelector('.trace-toggle[data-trace="tp"]');
      if (btn && loudnessHistoryStrip) {
        const nowVisible = loudnessHistoryStrip.setTraceVisible('tp');
        btn.classList.toggle('active', nowVisible);
      }
      return;
    }

    // K = Toggle K-weighting curve overlay
    if (e.code === 'KeyK' && !e.repeat) {
      e.preventDefault();
      if (kWeightToggle) kWeightToggle.click();
      return;
    }

    // 1/2/3/4/5 = Switch meter mode (TP/RMS/SP/Nordic/BBC)
    if (e.code === 'Digit1' && !e.repeat) {
      e.preventDefault();
      navigateToBargraph('tp');
      localStorage.setItem('tsg-meter-mode', 'tp');
      return;
    }
    if (e.code === 'Digit2' && !e.repeat) {
      e.preventDefault();
      navigateToBargraph('rms');
      localStorage.setItem('tsg-meter-mode', 'rms');
      return;
    }
    if (e.code === 'Digit3' && !e.repeat) {
      e.preventDefault();
      navigateToBargraph('sp');
      localStorage.setItem('tsg-meter-mode', 'sp');
      return;
    }
    if (e.code === 'Digit4' && !e.repeat) {
      e.preventDefault();
      navigateToBargraph('nordic');
      localStorage.setItem('tsg-meter-mode', 'nordic');
      return;
    }
    if (e.code === 'Digit5' && !e.repeat) {
      e.preventDefault();
      navigateToBargraph('bbc');
      localStorage.setItem('tsg-meter-mode', 'bbc');
      return;
    }

    // Space or P = Pause (toggle/momentary)
    if (e.code !== 'Space' && e.code !== 'KeyP') return;

    e.preventDefault();

    // Ignore key repeat (held down)
    if (e.repeat || pauseKeyState.isDown) return;
    if (!activeCapture) return;

    pauseKeyState.isDown = true;
    pauseKeyState.downTime = performance.now();
    pauseKeyState.stateBeforePress = isMeasurementPaused();

    // Visual feedback: show button as pressed (matching mouse click)
    if (btnMeasurePause && !btnMeasurePause.disabled) {
      btnMeasurePause.classList.add('key-active');
    }

    // Immediate toggle on keydown
    const paused = toggleMeasurementPause();
    updatePauseButtonState(paused);
  });

  // Keyboard: keyup - determine toggle vs momentary
  document.addEventListener('keyup', (e) => {
    if (e.code !== 'Space' && e.code !== 'KeyP') return;
    if (!pauseKeyState.isDown) return;

    pauseKeyState.isDown = false;
    const pressDuration = performance.now() - pauseKeyState.downTime;

    // Remove visual feedback on key release
    if (btnMeasurePause) {
      btnMeasurePause.classList.remove('key-active');
    }

    if (pressDuration >= MOMENTARY_THRESHOLD_MS) {
      // Long press = momentary (PTT), revert to original state
      if (isMeasurementPaused() !== pauseKeyState.stateBeforePress) {
        const paused = toggleMeasurementPause();
        updatePauseButtonState(paused);
      }
    }
    // Short press = toggle, keep current state (already set on keydown)
  });

  // GUI button: mousedown - immediate response
  if (btnMeasurePause) {
    btnMeasurePause.addEventListener('mousedown', (e) => {
      if (!activeCapture) return;

      pauseBtnState.isDown = true;
      pauseBtnState.downTime = performance.now();
      pauseBtnState.stateBeforePress = isMeasurementPaused();

      const paused = toggleMeasurementPause();
      updatePauseButtonState(paused);
    });

    // GUI button: mouseup - determine toggle vs momentary
    document.addEventListener('mouseup', (e) => {
      if (!pauseBtnState.isDown) return;

      pauseBtnState.isDown = false;
      const pressDuration = performance.now() - pauseBtnState.downTime;

      if (pressDuration >= MOMENTARY_THRESHOLD_MS) {
        // Long press = momentary, revert to original state
        if (isMeasurementPaused() !== pauseBtnState.stateBeforePress) {
          const paused = toggleMeasurementPause();
          updatePauseButtonState(paused);
        }
      }
    });

    // Touch support (mobile/tablet)
    btnMeasurePause.addEventListener('touchstart', (e) => {
      if (!activeCapture) return;
      e.preventDefault(); // Prevent mouse event firing

      pauseBtnState.isDown = true;
      pauseBtnState.downTime = performance.now();
      pauseBtnState.stateBeforePress = isMeasurementPaused();

      const paused = toggleMeasurementPause();
      updatePauseButtonState(paused);
    }, { passive: false });

    document.addEventListener('touchend', (e) => {
      if (!pauseBtnState.isDown) return;

      pauseBtnState.isDown = false;
      const pressDuration = performance.now() - pauseBtnState.downTime;

      if (pressDuration >= MOMENTARY_THRESHOLD_MS) {
        if (isMeasurementPaused() !== pauseBtnState.stateBeforePress) {
          const paused = toggleMeasurementPause();
          updatePauseButtonState(paused);
        }
      }
    });
  }

  // --- Browser Source Controls ---
  // Uses SourceController for unified monitor management
  if (btnSysMonMute) btnSysMonMute.onclick = toggleSysMonitorMute;

  if (sysMonGainEl) {
    sysMonGainEl.addEventListener('input', () => {
      if (sysMonVal) sysMonVal.value = Math.round(sysMonGainEl.value);
      if (!sysMonitorMuted) {
        sourceController.setBrowserMonitor(parseFloat(sysMonGainEl.value), false);
      }
    });
  }
  if (sysMonVal) {
    sysMonVal.addEventListener('change', e => {
      if (sysMonGainEl) sysMonGainEl.value = clamp(parseFloat(e.target.value) || 0, 0, 100);
      sysMonVal.value = Math.round(sysMonGainEl?.value || 0);
      if (!sysMonitorMuted) {
        sourceController.setBrowserMonitor(parseFloat(sysMonGainEl?.value || 0), false);
      }
    });
    sysMonVal.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        if (sysMonGainEl) sysMonGainEl.value = clamp(parseFloat(e.target.value) || 0, 0, 100);
        sysMonVal.value = Math.round(sysMonGainEl?.value || 0);
        if (!sysMonitorMuted) {
          sourceController.setBrowserMonitor(parseFloat(sysMonGainEl?.value || 0), false);
        }
        e.target.blur();
      }
    });
  }
  if (sysTrimRange) sysTrimRange.addEventListener('input', e => setSysTrim(e.target.value));
  if (sysTrimVal) {
    sysTrimVal.addEventListener('change', e => setSysTrim(e.target.value));
    sysTrimVal.addEventListener('keydown', e => { if (e.key === 'Enter') { setSysTrim(e.target.value); e.target.blur(); } });
  }
  if (sysTrimReset) sysTrimReset.addEventListener('click', () => setSysTrim(SYS_TRIM_DEFAULT));

  // --- External Source Controls ---
  // Uses SourceController for unified monitor management
  if (btnExtMonMute) btnExtMonMute.onclick = toggleExtMonitorMute;

  if (extMonGainEl) {
    extMonGainEl.addEventListener('input', () => {
      if (extMonVal) extMonVal.value = Math.round(extMonGainEl.value);
      if (!extMonitorMuted) {
        sourceController.setExternalMonitor(parseFloat(extMonGainEl.value), false);
      }
    });
  }
  if (extMonVal) {
    extMonVal.addEventListener('change', e => {
      if (extMonGainEl) extMonGainEl.value = clamp(parseFloat(e.target.value) || 0, 0, 100);
      extMonVal.value = Math.round(extMonGainEl?.value || 0);
      if (!extMonitorMuted) {
        sourceController.setExternalMonitor(parseFloat(extMonGainEl?.value || 0), false);
      }
    });
    extMonVal.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        if (extMonGainEl) extMonGainEl.value = clamp(parseFloat(e.target.value) || 0, 0, 100);
        extMonVal.value = Math.round(extMonGainEl?.value || 0);
        if (!extMonitorMuted) {
          sourceController.setExternalMonitor(parseFloat(extMonGainEl?.value || 0), false);
        }
        e.target.blur();
      }
    });
  }
  if (extTrimRange) extTrimRange.addEventListener('input', e => setExtTrim(e.target.value));
  if (extTrimVal) {
    extTrimVal.addEventListener('change', e => setExtTrim(e.target.value));
    extTrimVal.addEventListener('keydown', e => { if (e.key === 'Enter') { setExtTrim(e.target.value); e.target.blur(); } });
  }
  if (extTrimReset) extTrimReset.addEventListener('click', () => setExtTrim(EXT_TRIM_DEFAULT));

  // --- External Device Refresh ---
  if (btnExtRefresh) btnExtRefresh.onclick = enumerateAudioDevices;

  // Sidebar toggle
  if (sidebarToggle && wrap) {
    // Restore state
    if (localStorage.getItem('tsg-sidebar-collapsed') === 'true') {
      wrap.classList.add('sidebar-collapsed');
    }

    sidebarToggle.onclick = () => {
      // Remove initial collapsed class (prevents CSS conflict on first toggle)
      document.documentElement.classList.remove('sidebar-start-collapsed');
      // Enable transitions only during sidebar toggle (not window resize)
      document.documentElement.classList.add('sidebar-transitioning');
      wrap.classList.toggle('sidebar-collapsed');
      localStorage.setItem('tsg-sidebar-collapsed', wrap.classList.contains('sidebar-collapsed'));
      // Remove transition class after animation completes (longest is 0.4s)
      setTimeout(() => {
        document.documentElement.classList.remove('sidebar-transitioning');
      }, 450);
    };

    // Show toggle on mouse movement
    let hideTimeout = null;
    document.addEventListener('mousemove', () => {
      sidebarToggle.style.opacity = '1';
      clearTimeout(hideTimeout);
      hideTimeout = setTimeout(() => {
        sidebarToggle.style.opacity = '0';
      }, 2000);
    });
  }

  // Settings - EXACT from audio-meters-grid.html lines 5038-5057
  if (targetPreset) {
    targetPreset.onchange = () => {
      LOUDNESS_TARGET = parseInt(targetPreset.value, 10);
      appState.set({ targetLufs: LOUDNESS_TARGET });
      if (radar) radar.setTarget(LOUDNESS_TARGET);
      // Update history strip target and reset
      if (loudnessHistoryStrip) {
        loudnessHistoryStrip.setTarget(LOUDNESS_TARGET);
        loudnessHistoryStrip.reset();
      }
      // Reset R128 when target changes (like original resetR128)
      lufsMeter.reset();
      truePeakMeter.reset();
      resetMeterState();
      // Update display with fixed-width placeholders
      if (lufsM) lufsM.textContent = ' --.- LUFS';
      if (lufsS) lufsS.textContent = ' --.- LUFS';
      if (lufsI) lufsI.textContent = ' --.- LUFS';
      if (lraEl) lraEl.textContent = '--.- LU';
      if (r128TpMax) r128TpMax.textContent = ' --.- dBTP';
      if (r128Crest) r128Crest.textContent = '--.- dB';
      if (r128Time) r128Time.textContent = '--:--:--';
    };
  }

  if (tpLimitSelect) {
    tpLimitSelect.onchange = () => {
      TP_LIMIT = parseInt(tpLimitSelect.value, 10);
      appState.set({ truePeakLimit: TP_LIMIT });
      setTpLimit(TP_LIMIT);
      updateTpLimitDisplay();
      // Reset TP over flag when limit changes
      meterState.peakIndicatorOn = false;
      meterState.peakIndicatorLastTrigger = 0;
    };
  }

  if (radarSweep) {
    // Set initial value from persisted state
    radarSweep.value = String(radarMaxSeconds);
    radarSweep.onchange = () => {
      radarMaxSeconds = parseInt(radarSweep.value, 10);
      appState.set({ radarMaxSeconds });
      // Clear radar history when sweep time changes
      meterState.radarHistory = [];
    };
  }

  // Loudness history duration change
  if (loudnessHistoryDuration) {
    // Set initial value from persisted state
    loudnessHistoryDuration.value = String(historyDuration);
    loudnessHistoryDuration.onchange = () => {
      historyDuration = parseInt(loudnessHistoryDuration.value, 10);
      appState.set({ historyDuration });
      if (loudnessHistoryStrip) {
        loudnessHistoryStrip.setDuration(historyDuration);
      }
    };
  }

  // Generator monitor controls
  // Uses SourceController for unified monitor management
  function toggleGenMonitorMute() {
    monitorMuted = sourceController.toggleGeneratorMonitorMute();
    if (monVal) monVal.value = Math.round(monGainEl?.value || 0);
    // RED when muted, neutral when not muted
    if (monitorMuted) {
      if (btnMonMute) { btnMonMute.classList.add('btn-muted'); btnMonMute.classList.remove('btn-ghost'); }
    } else {
      if (btnMonMute) { btnMonMute.classList.remove('btn-muted'); btnMonMute.classList.add('btn-ghost'); }
    }
    updateStatusPanel();
  }

  if (btnMonMute) btnMonMute.onclick = toggleGenMonitorMute;

  if (monGainEl) {
    monGainEl.addEventListener('input', () => {
      if (monVal) monVal.value = Math.round(monGainEl.value);
      if (!monitorMuted) {
        sourceController.setGeneratorMonitor(parseFloat(monGainEl.value), false);
      }
    });
  }

  if (monVal) {
    monVal.addEventListener('change', e => {
      if (monGainEl) monGainEl.value = clamp(parseFloat(e.target.value) || 0, 0, 100);
      monVal.value = Math.round(monGainEl?.value || 0);
      if (!monitorMuted) {
        sourceController.setGeneratorMonitor(parseFloat(monGainEl?.value || 0), false);
      }
    });
    monVal.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        if (monGainEl) monGainEl.value = clamp(parseFloat(e.target.value) || 0, 0, 100);
        monVal.value = Math.round(monGainEl?.value || 0);
        if (!monitorMuted) {
          sourceController.setGeneratorMonitor(parseFloat(monGainEl?.value || 0), false);
        }
        e.target.blur();
      }
    });
  }

  // Generator preset change - switch signal live if running, update display
  if (genPreset) {
    genPreset.addEventListener('change', () => {
      // Update display
      updateGenModeDisplay();

      // If generator is running, switch to new preset without restart
      if (activeCapture === 'generator') {
        switchGeneratorPreset();
      }
    });
  }

  // Bargraph meter - physics-based 3D carousel (extracted to bargraph-meter.js)
  setupBargraphMeter(bargraphMeter, bargraphBadge);

  // Collapsible panels
  const sidebarContent = document.querySelector('.sidebar-content');
  document.querySelectorAll('.card.collapsible h2').forEach(h2 => {
    h2.onclick = () => {
      const card = h2.closest('.card');
      if (!card) return;

      const wasCollapsed = card.classList.contains('collapsed');
      card.classList.toggle('collapsed');

      // When expanding, scroll the panel into view after animation completes
      if (wasCollapsed && sidebarContent) {
        setTimeout(() => {
          const cardRect = card.getBoundingClientRect();
          const sidebarRect = sidebarContent.getBoundingClientRect();
          const cardBottom = cardRect.bottom;
          const sidebarBottom = sidebarRect.bottom;

          // If card bottom is below visible area, scroll to show it
          if (cardBottom > sidebarBottom) {
            const scrollAmount = cardBottom - sidebarBottom + 20;
            sidebarContent.scrollBy({ top: scrollAmount, behavior: 'smooth' });
          }
        }, 280); // Wait for 0.25s animation + small buffer
      }
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// RESIZE OBSERVERS
// ─────────────────────────────────────────────────────────────────────────────

function setupObservers() {
  const resizeObserver = new ResizeObserver(() => {
    // Layout updates immediately on resize (no drag freeze needed)
    layoutXY();
    layoutLoudness();
  });

  if (meters) resizeObserver.observe(meters);
  if (spatialMeter) resizeObserver.observe(spatialMeter);
  if (loudnessMeter) resizeObserver.observe(loudnessMeter);
}

// ─────────────────────────────────────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

function init() {
  const initStart = performance.now();
  console.log('[Bootstrap] Initializing VERO-BAAMBI modular version');

  // Initialise UI components first (creates goniometer etc.)
  initUIComponents();

  // Initialise layout with dependencies
  initLayout({
    dom: {
      wrap,
      spatialMeter,
      xy,
      corr,
      monoDev,
      loudnessModule,
      radarWrap,
      loudnessRadar
    },
    uiComponents: { goniometer },
    getLayoutFrozen: () => false  // Drag-and-drop removed; layout never frozen
  });

  // Size wrap
  sizeWrap();
  window.addEventListener('resize', sizeWrap);

  // Bind events
  bindEvents();

  // Setup observers
  setupObservers();

  // ───────────────────────────────────────────────────────────────────────────
  // CALIBRATION SYSTEM INITIALIZATION
  // Must be after bindEvents() so sysTrimDb/setSysTrim are available
  // ───────────────────────────────────────────────────────────────────────────
  calibrationEngine = new CalibrationEngine({
    sourceController,
    lufsMeter,
    truePeakMeter,
    resetMeters: () => {
      lufsMeter.reset();
      truePeakMeter.reset();
      resetMeterState();
    },
    getTrim: () => {
      const mode = appState.get('inputMode');
      if (mode === InputMode.BROWSER) return sysTrimDb;
      if (mode === InputMode.EXTERNAL) return extTrimDb;
      return 0;
    },
    setTrim: (dB) => {
      const mode = appState.get('inputMode');
      if (mode === InputMode.BROWSER) setSysTrim(dB);
      else if (mode === InputMode.EXTERNAL) setExtTrim(dB);
    }
  });

  // Calibration wizard (modal)
  if (calibrationWizardContainer) {
    calibrationWizard = new CalibrationWizard(calibrationWizardContainer, calibrationEngine);
    calibrationWizard.onComplete = (profile) => {
      console.log('[Bootstrap] Calibration complete:', profile.profileName);
      // Force badge and header indicator updates
      if (calibrationBadge) {
        calibrationBadge.update();
      }
      if (headerCalIndicatorInstance) {
        headerCalIndicatorInstance.update();
        syncBadgeWidths();
      }
    };
    calibrationWizard.onCancel = () => {
      console.log('[Bootstrap] Calibration cancelled');
    };
  }

  // Calibration status badge
  if (calibrationBadgeContainer) {
    calibrationBadge = new CalibrationStatusBadge(calibrationBadgeContainer);
    calibrationBadge.onCalibrationClick = () => {
      if (calibrationWizard) {
        calibrationWizard.open();
      }
    };
  }

  // Meter verification modal
  verificationModal = new VerificationModal({
    container: document.body,
    audioContext: ac,
    masterGain: sourceController.analysisGain,
    getMeterReadings: () => {
      // Sample fresh audio data from both analyser paths
      sampleAnalysers();
      sampleKWeightedAnalysers();

      // Update meters directly with current buffer data
      // (Bypasses measure-loop which requires activeCapture)
      // True Peak and PPM use unweighted samples
      truePeakMeter.update(bufL, bufR);
      ppmMeter.update(bufL, bufR);

      // LUFS uses K-weighted samples per ITU-R BS.1770-4
      const energy = lufsMeter.calculateBlockEnergy(kBufL, kBufR);
      lufsMeter.pushBlock(energy);

      // Get readings directly from meters (bypasses meterState delays)
      const lufsReadings = lufsMeter.getReadings();
      const tpState = truePeakMeter.getState();
      const ppmState = ppmMeter.getState();

      return {
        // LUFS: read directly, no 30-second display delay
        integratedLufs: lufsReadings.integrated,
        shortTermLufs: lufsReadings.shortTerm,
        // True Peak: read from meter, not meterState.tpMaxL/R
        truePeakL: tpState.dbtpHoldLeft,
        truePeakR: tpState.dbtpHoldRight,
        // Correlation: calculate directly from unweighted buffers
        correlation: calculateCorrelation(bufL, bufR),
        // PPM: return PPM scale value, not dBFS
        nordicPpm: ppmState.ppmScaleLeft
      };
    },
    resetMeters: () => {
      // Reset all meters between tests to ensure clean slate
      // Critical for tests like PPM where previous test (LUFS pink noise)
      // has high peak levels that persist due to slow decay (11.76 dB/s)
      lufsMeter.reset();
      truePeakMeter.reset();
      ppmMeter.reset();
    },
    onStart: () => {
      console.log('[Bootstrap] Meter verification started');
      // Mute all sources to prevent interference with verification signals
      sourceController.muteAllSources();
      // Switch True Peak to polyphase mode for accurate ISP detection
      // (Hermite interpolation doesn't detect ISP for Nyquist signals)
      truePeakMeter.setMode(TRUE_PEAK_MODE.POLYPHASE);
      // Reset all meters before verification
      lufsMeter.reset();
      truePeakMeter.reset();
      ppmMeter.reset();
      resetMeterState();
    },
    onComplete: (results) => {
      console.log('[Bootstrap] Meter verification complete:', results);
      // Save verification results to badge
      if (verificationBadge) {
        verificationBadge.saveResults(results);
      }
      // Restore source levels after verification
      sourceController.unmuteAllSources();
      // Restore True Peak mode to user preference
      truePeakMeter.setMode(appState.get('truePeakMode') || TRUE_PEAK_MODE.HERMITE);
    },
    onAbort: () => {
      console.log('[Bootstrap] Meter verification aborted');
      // Restore source levels after abort
      sourceController.unmuteAllSources();
      // Restore True Peak mode to user preference
      truePeakMeter.setMode(appState.get('truePeakMode') || TRUE_PEAK_MODE.HERMITE);
    }
  });

  // Verification status badge
  if (verificationBadgeContainer) {
    verificationBadge = new VerificationStatusBadge(verificationBadgeContainer);
    verificationBadge.onVerifyClick = () => {
      if (verificationModal) {
        verificationModal.open();
      }
    };
  }

  // Header calibration indicator (also manages sidebar status box)
  if (headerCalIndicator) {
    headerCalIndicatorInstance = new HeaderCalIndicator(headerCalIndicator, {
      statusBox: calStatusBox,
      statusProfile: calStatusProfile,
      statusStandard: calStatusStandard
    });
  }

  // Apply active calibration profiles to ensure trim values are synchronised
  // This handles upgrades to SSOT model and recovers from localStorage clears
  applyActiveProfilesOnStartup();

  // ─────────────────────────────────────────────────────────────────────────────
  // SESSION CAPTURE INITIALIZATION
  // ─────────────────────────────────────────────────────────────────────────────

  // Load saved session preferences
  loadSessionPreferences();

  // Session indicator (header badge)
  if (headerSessionIndicator) {
    sessionIndicator = new SessionIndicator(headerSessionIndicator, {
      onStateChange: ({ hotkeyEnabled, isCapturing }) => {
        updateSessionUI(isCapturing);
        updateSessionSummary(hotkeyEnabled, isCapturing);
        syncBadgeWidths();
      }
    });
  }

  // Session capture panel elements
  const sessionHotkeyToggle = document.getElementById('sessionHotkeyToggle');
  const sessionCaptureSummary = document.getElementById('sessionCaptureSummary');
  const btnSessionStart = document.getElementById('btnSessionStart');
  const btnSessionStop = document.getElementById('btnSessionStop');
  const btnExportJSON = document.getElementById('btnExportJSON');
  const btnExportXML = document.getElementById('btnExportXML');

  /**
   * Update session panel button states based on capture state.
   * @param {boolean} capturing - Whether session is capturing
   */
  function updateSessionUI(capturing) {
    if (btnSessionStart) btnSessionStart.disabled = capturing;
    if (btnSessionStop) btnSessionStop.disabled = !capturing;
  }

  /** Interval for updating summary duration */
  let summaryUpdateInterval = null;

  /**
   * Format duration as MM:SS or HH:MM:SS.
   * @param {number} seconds
   * @returns {string}
   */
  function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * Get elapsed capture seconds.
   * @returns {number}
   */
  function getElapsedSeconds() {
    const raw = performance.now() - meterState.startTs;
    let pausedTime = meterState.totalPausedMs;
    if (meterState.measurementPaused && meterState.pausedAt) {
      pausedTime += performance.now() - meterState.pausedAt;
    }
    return (raw - pausedTime) / 1000;
  }

  /**
   * Update summary with current duration.
   */
  function updateSummaryDuration() {
    if (!sessionCaptureSummary) return;
    sessionCaptureSummary.textContent = formatDuration(getElapsedSeconds());
  }

  /**
   * Update session panel summary text.
   * @param {boolean} hotkeyEnabled - Whether hotkey is enabled
   * @param {boolean} capturing - Whether session is capturing
   */
  function updateSessionSummary(hotkeyEnabled, capturing) {
    if (!sessionCaptureSummary) return;

    // Clear any existing interval
    if (summaryUpdateInterval) {
      clearInterval(summaryUpdateInterval);
      summaryUpdateInterval = null;
    }

    if (!hotkeyEnabled) {
      sessionCaptureSummary.textContent = 'Off';
    } else if (capturing) {
      updateSummaryDuration();
      summaryUpdateInterval = setInterval(updateSummaryDuration, 1000);
    } else {
      sessionCaptureSummary.textContent = 'Ready';
    }
  }

  // Initialise toggle from saved preference
  if (sessionHotkeyToggle) {
    sessionHotkeyToggle.checked = isSessionHotkeyEnabled();

    sessionHotkeyToggle.addEventListener('change', () => {
      setSessionHotkeyEnabled(sessionHotkeyToggle.checked);
      if (sessionIndicator) sessionIndicator.update();
      updateSessionUI(isSessionCapturing());
      updateSessionSummary(sessionHotkeyToggle.checked, isSessionCapturing());
    });
  }

  // Session start/stop buttons
  if (btnSessionStart) {
    btnSessionStart.addEventListener('click', () => {
      startSessionCapture();
      updateSessionUI(true);
      updateSessionSummary(true, true);
      if (sessionIndicator) sessionIndicator.update();
    });
  }

  if (btnSessionStop) {
    btnSessionStop.addEventListener('click', () => {
      stopSessionCapture();
      updateSessionUI(false);
      updateSessionSummary(true, false);
      if (sessionIndicator) sessionIndicator.update();
    });
  }

  // Export buttons
  if (btnExportJSON) {
    btnExportJSON.addEventListener('click', () => {
      exportSessionJSON(lufsMeter, LOUDNESS_TARGET);
    });
  }

  if (btnExportXML) {
    btnExportXML.addEventListener('click', () => {
      exportSessionXML(lufsMeter, LOUDNESS_TARGET);
    });
  }

  // Initialise UI state
  updateSessionUI(isSessionCapturing());
  updateSessionSummary(isSessionHotkeyEnabled(), isSessionCapturing());
  if (sessionIndicator) sessionIndicator.update();
  // Delay sync to ensure DOM is fully updated
  setTimeout(syncBadgeWidths, 50);

  // SSOT: Subscribe to appState changes to update UI
  appState.subscribe((state, changed) => {
    // Sync badge widths when calibration or input mode changes
    if (changed.calibrationRevision || changed.inputMode || changed.deviceId) {
      syncBadgeWidths();
    }
    // Update trim sliders
    if (changed.browserTrim) {
      const newTrim = state.browserTrim;
      sysTrimDb = newTrim;
      if (sysTrimRange) sysTrimRange.value = newTrim;
      if (sysTrimVal) sysTrimVal.value = Math.round(newTrim);
    }
    if (changed.externalTrim) {
      const newTrim = state.externalTrim;
      extTrimDb = newTrim;
      if (extTrimRange) extTrimRange.value = newTrim;
      if (extTrimVal) extTrimVal.value = Math.round(newTrim);
    }
    if (changed.truePeakMode) {
      truePeakMeter.setMode(state.truePeakMode);
    }
  });

  // Note: sidebar transitions now controlled via 'sidebar-transitioning' class
  // which is added/removed only during toggle click (see sidebarToggle.onclick)

  // Set initial source mode (directly set panels, don't animate on init)
  selectedInputMode = 'browser';
  appState.set({ inputMode: InputMode.BROWSER });
  if (browserSourcePanel) browserSourcePanel.classList.add('source-panel-active');
  if (btnModeBrowser) {
    btnModeBrowser.classList.add('btn-active');
    btnModeBrowser.classList.remove('btn-ghost');
  }
  updateInputSourceSummary();
  updateGenModeDisplay();

  // Drag-and-drop removed — fixed layout for broadcast consistency
  // See docs/PROJECT-A-DRAG-DROP-REMOVAL.md for rationale

  // Initialise render loop with dependencies (MUST be after initUIComponents)
  initRenderLoop({
    dom: {
      lufsM, spatialMeter, nordicCanvas, nordicLVal, nordicRVal,
      bbcCanvas, bbcLVal, bbcRVal,
      spCanvas, spLVal, spRVal,
      dbfs, dbL, dbR, tp, tpL, tpR,
      uptimeEl, statusSummary
    },
    meters: {
      bufL, bufR, ppmMeter, truePeakMeter, samplePeakMeter
    },
    uiComponents: {
      goniometer, correlationMeter, balanceMeterUI,
      spectrumAnalyserUI, msMeterUI, widthMeterUI,
      rotationMeterUI, radar, stereoAnalysis,
      loudnessHistoryStrip
    },
    config: {
      getSampleRate: () => ac.sampleRate,
      getRadarMaxSeconds: () => radarMaxSeconds,
      getTpLimit: () => TP_LIMIT
    },
    helpers: {
      layoutXY, layoutLoudness, sampleAnalysers,
      drawHBar_DBFS, drawDiodeBar_TP, drawHBar_Nordic_PPM, drawHBar_BBC_PPM, drawSamplePeakBar,
      updateRadarTooltip
    },
    captureState: { getActiveCapture: () => activeCapture },
    TransitionGuard
  });

  // Start render loop
  startRenderLoop();

  // Hide boot splash after first frames render (minimum 777ms visible)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const elapsed = performance.now() - initStart;
      const remaining = Math.max(0, 777 - elapsed);
      setTimeout(() => {
        const splash = document.getElementById('splash');
        if (splash) {
          splash.classList.add('hide');
          setTimeout(() => splash.remove(), 350);
        }
      }, remaining);
    });
  });

  console.log('[Bootstrap] Initialization complete');
}

// Run on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
