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
import { TruePeakMeter, formatTruePeak } from '../metering/true-peak.js';
import { PPMMeter, formatPPM } from '../metering/ppm.js';
import { StereoMeter, formatCorrelation } from '../metering/correlation.js';
// Centralised state management
import { appState, InputMode } from './state.js';
// Source controller (prepared for phased integration)
import { SourceController, SignalType, RoutingMode } from './sources.js';
// Stereo analysis widgets
import { StereoAnalysisEngine } from '../ui/stereo-analysis.js';
import { WidthMeter } from '../ui/width-meter.js';
import { RotationMeter } from '../ui/rotation-meter.js';
import { SpectrumAnalyzer } from '../ui/spectrum.js';
import { MSMeter } from '../ui/ms-meter.js';
import { BalanceMeter } from '../ui/balance-meter.js';
// Bar meters
import { drawHBar_DBFS, drawDiodeBar_TP, drawHBar_PPM, layoutDBFSScale, layoutTPScale, layoutPPMScale, setTpLimit, updateTpLimitDisplay } from '../ui/bar-meter.js';
// Signal generator preset configuration
// Signal generation itself handled by SourceController
import { getPresetConfig as getPresetConfigFromModule } from '../generators/index.js';
// Measure loop (20 Hz) - extracted from bootstrap
import { initMeasureLoop, startMeasureLoop, stopMeasureLoop } from './measure-loop.js';
// Render loop (60 Hz) - extracted from bootstrap
import { initRenderLoop, startRenderLoop, stopRenderLoop } from './render-loop.js';
// Shared meter state between measureLoop and renderLoop
import { meterState, resetMeterState, resetRemoteMeterState, MEASURE_INTERVAL_MS, TP_PEAK_HOLD_SEC, PPM_PEAK_HOLD_SEC, FRAME_HOLD_THRESHOLD } from './meter-state.js';
// Drag and drop system - extracted from bootstrap
import { initDragDrop, setupDragAndDrop } from './drag-drop.js';
// Glitch debug utility - extracted from bootstrap
import { GlitchDebug } from './glitch-debug.js';
// Transition guard for EBU pulse blanking - extracted from bootstrap
import { TransitionGuard } from './transition-guard.js';
// Helper functions - extracted from bootstrap
import { dbToGain, clamp, formatDb, formatDbu, formatTime, getCss, formatCorr, loudnessColour as loudnessColourBase } from './helpers.js';
// Layout functions - extracted from bootstrap
import { initLayout, sizeWrap, layoutXY, layoutLoudness } from './layout.js';
// Meter switcher (physics-based 3D carousel) - extracted from bootstrap
import { setupMeterSwitcher } from './meter-switcher.js';
// Remote metering client
import { MetricsReceiver } from '../remote/client/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURABLE PARAMETERS
// ─────────────────────────────────────────────────────────────────────────────

// Initialise from centralised state (persisted in localStorage via appState)
let LOUDNESS_TARGET = appState.get('targetLufs');
let TP_LIMIT = appState.get('truePeakLimit');
let radarMaxSeconds = 60;

const TP_SCALE_MIN = -60;
const TP_SCALE_MAX = 3;

// Peak indicator hold constant - state moved to meterState
const PEAK_INDICATOR_HOLD_MS = 500;

// ─────────────────────────────────────────────────────────────────────────────
// DOM ELEMENT REFERENCES
// ─────────────────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

// Layout containers
const wrap = $('wrap');
const meters = $('meters');

// Loudness section
const loudnessCard = $('loudnessCard');
const loudnessRadar = $('loudnessRadar');
const radarWrap = loudnessCard?.querySelector('.radarWrap');
const loudnessModule = loudnessCard?.querySelector('.loudnessModule');
const peakLed = $('peakLed');

// Goniometer/Vectorscope
const xyCard = $('xyCard');
const xyWrap = $('xyWrap');
const xy = $('xy');
const corr = $('corr');
const corrVal = $('corrVal');

// Stereo analysis widgets
const monoDev = $('monoDev');
const monoDevVal = $('monoDevVal');
const widthMeter = $('widthMeter');
const rotationCanvas = $('rotationCanvas');
const spectrumAnalyzer = $('spectrumAnalyzer');
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
const ppmCanvas = $('ppmCanvas');
const ppmScale = $('ppmScale');
const ppmLVal = $('ppmLVal');
const ppmRVal = $('ppmRVal');

// LUFS display
const lufsM = $('lufsM');
const lufsS = $('lufsS');
const lufsI = $('lufsI');
const lraEl = $('lra');
const r128TpMax = $('r128TpMax');
const r128Crest = $('r128Crest');
const r128Time = $('r128Time');
const r128Reset = $('r128Reset');

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
const extTrimReset = $('extTrimReset');
const extDevice = $('extDevice');
const extCc = $('extCc');
const extSr = $('extSr');
const extStatus = $('extStatus');

// Meter switcher
const meterSwitcher = $('meterSwitcher');
const meterBadge = $('meterBadge');

// Settings
const targetPreset = $('targetPreset');
const tpLimitSelect = $('tpLimit');
const radarSweep = $('radarSweep');

// Sidebar toggle
const sidebarToggle = $('sidebarToggle');

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

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE CONTROLLER (Phase 1: instantiation and connection)
// ─────────────────────────────────────────────────────────────────────────────
// The SourceController manages all audio input sources (browser, external, generator)
// in a unified way. During phased integration, it runs in parallel with legacy code.
const sourceController = new SourceController(ac);
sourceController.connectOutput(mixL, mixR);
console.log('%c[TSG] SourceController instantiated and connected to analysis bus', 'color: cyan');

// Shared sample buffers (sampled ONCE per frame)
const FFT_SIZE = 4096;
const bufL = new Float32Array(FFT_SIZE);
const bufR = new Float32Array(FFT_SIZE);

function sampleAnalysers() {
  analyserL.getFloatTimeDomainData(bufL);
  analyserR.getFloatTimeDomainData(bufR);
}

// ─────────────────────────────────────────────────────────────────────────────
// METERING INSTANCES
// ─────────────────────────────────────────────────────────────────────────────

const lufsMeter = new LUFSMeter({ sampleRate: ac.sampleRate, blockSize: FFT_SIZE });
const truePeakMeter = new TruePeakMeter();
const ppmMeter = new PPMMeter({ sampleRate: ac.sampleRate });
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
let spectrumAnalyzerUI = null;
let msMeterUI = null;
let balanceMeterUI = null;
// Remote metering receiver instance
let remoteReceiver = null;
let isRemoteAvailable = false;

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

  // Spectrum analyzer
  if (spectrumAnalyzer) {
    spectrumAnalyzerUI = new SpectrumAnalyzer(spectrumAnalyzer, analyserL, analyserR);
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
  layoutPPMScale(ppmScale);

  // Synchronise UI controls with persisted state values
  if (targetPreset) {
    targetPreset.value = String(LOUDNESS_TARGET);
  }
  if (tpLimitSelect) {
    tpLimitSelect.value = String(TP_LIMIT);
    setTpLimit(TP_LIMIT);
  }

}

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT STATE (shared with layout.js and drag-drop.js)
// ─────────────────────────────────────────────────────────────────────────────

let isDragLayoutFrozen = false;

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
let selectedRemoteProbeId = null; // Currently selected remote probe ID

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
  sysTrimDb = clamp(parseFloat(dB) || SYS_TRIM_DEFAULT, -48, 24);
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
  extTrimDb = clamp(parseFloat(dB) || EXT_TRIM_DEFAULT, -48, 24);
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
    if (btnStartCapture) btnStartCapture.disabled = true;
    if (btnStopCapture) btnStopCapture.disabled = false;
    // Blue when this mode is actively capturing
    if (btnStartCapture) btnStartCapture.classList.remove('btn-ghost');
  } else {
    if (btnStartCapture) btnStartCapture.disabled = false;
    if (btnStopCapture) btnStopCapture.disabled = !isAnyCapture || activeCapture !== selectedInputMode;
    // Ghost when not capturing
    if (btnStartCapture) btnStartCapture.classList.add('btn-ghost');
  }
  // If viewing a different mode than active, show stop as disabled
  if (activeCapture && activeCapture !== selectedInputMode) {
    if (btnStopCapture) btnStopCapture.disabled = true;
  }
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
    if (extDevice) extDevice.textContent = track.label || 'Unknown';
    if (extCc) extCc.textContent = settings.channelCount ?? 'Unknown';
    if (extSr) extSr.textContent = ac.sampleRate + ' Hz';
    if (extStatus) extStatus.textContent = (settings.channelCount >= 2 ? 'Stereo' : 'Active');

    // Default: muted (RED button)
    if (btnExtMonMute) { btnExtMonMute.classList.add('btn-muted'); btnExtMonMute.classList.remove('btn-ghost'); }
    extMonitorMuted = true;

    activeCapture = 'external';
    updateCaptureButtons();
    updateInputSourceSummary();
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
}

// Stop external device capture
function stopExternalCapture() {
  sourceController.stopExternalCapture();
  if (extStatus) extStatus.textContent = 'Stopped';
  extMonitorMuted = true;
  if (activeCapture === 'external') activeCapture = null;
  updateCaptureButtons();
  updateInputSourceSummary();
}

function stopGeneratorCapture() {
  sourceController.stopGenerator();
  // Reset EBU pulse state and visual transition guard
  ebuModeActive = false;
  TransitionGuard.reset();
  if (activeCapture === 'generator') activeCapture = null;
  updateCaptureButtons();
  updateInputSourceSummary();
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

  activeCapture = 'remote';
  updateCaptureButtons();
  updateInputSourceSummary();

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
  if (lufsM) { lufsM.textContent = '--.- LUFS'; lufsM.style.color = ''; }
  if (lufsS) { lufsS.textContent = '--.- LUFS'; lufsS.style.color = ''; }
  if (lufsI) { lufsI.textContent = '--.- LUFS'; lufsI.style.color = ''; }
  if (lraEl) { lraEl.textContent = '--.- LU'; }
  if (r128TpMax) { r128TpMax.textContent = '--.- dBTP'; r128TpMax.style.color = ''; }
  if (r128Crest) { r128Crest.textContent = '--.- dB'; }

  // PPM values
  if (ppmLVal) { ppmLVal.textContent = ''; }
  if (ppmRVal) { ppmRVal.textContent = ''; }

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

    // Reset meter state AND clear displays
    resetRemoteMeterState();
    clearRemoteDisplays();

    if (activeCapture === 'remote') activeCapture = null;
    updateCaptureButtons();
    updateInputSourceSummary();
  } catch (err) {
    console.error('[Bootstrap] stopRemoteCapture error:', err);
    if (activeCapture === 'remote') activeCapture = null;
  }
}

/**
 * Render available probes list in remote panel.
 * @param {Array} probes - Available probes from broker
 */
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
      } else {
        lufsS.textContent = '--.- LUFS';
        lufsS.style.color = '';
      }
    }

    // Integrated LUFS
    if (lufsI) {
      const i = lufs.integrated;
      if (isFinite(i) && i > -100) {
        lufsI.textContent = formatLUFS(i);
        lufsI.style.color = loudnessColourBase(i);
      } else {
        lufsI.textContent = '--.- LUFS';
        lufsI.style.color = '';
      }
    }

    // LRA
    if (lraEl) {
      const lra = lufs.lra;
      if (isFinite(lra) && lra >= 0) {
        lraEl.textContent = lra.toFixed(1) + ' LU';
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
    const ppmL = ppm.left ?? -60;
    const ppmR = ppm.right ?? -60;
    meterState.remotePpmL = ppmL;
    meterState.remotePpmR = ppmR;

    // Update PPM peak hold (3s hold logic)
    const now = performance.now() / 1000;
    if (ppmL > meterState.ppmPeakHoldL) {
      meterState.ppmPeakHoldL = ppmL;
      meterState.ppmPeakTimeL = now;
    } else if (now - meterState.ppmPeakTimeL > PPM_PEAK_HOLD_SEC) {
      meterState.ppmPeakHoldL = ppmL;
      meterState.ppmPeakTimeL = now;
    }
    if (ppmR > meterState.ppmPeakHoldR) {
      meterState.ppmPeakHoldR = ppmR;
      meterState.ppmPeakTimeR = now;
    } else if (now - meterState.ppmPeakTimeR > PPM_PEAK_HOLD_SEC) {
      meterState.ppmPeakHoldR = ppmR;
      meterState.ppmPeakTimeR = now;
    }
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
  // VISUALIZATION DATA (for goniometer + spectrum analyzer)
  // Pre-computed on probe, transmitted as compact arrays
  // ─────────────────────────────────────────────────────────────────────────
  if (visualization) {
    // Goniometer: M/S points for vectorscope display
    // Array of [M0,S0, M1,S1, ...] normalized ±1
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
  meters: { lufsMeter, truePeakMeter, bufL, bufR },
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
      lufsMeter.reset();
      truePeakMeter.reset();
      resetMeterState();
      // Update display with fixed-width placeholders (EXACT from original)
      if (lufsM) lufsM.textContent = '--.- LUFS';
      if (lufsS) lufsS.textContent = '--.- LUFS';
      if (lufsI) lufsI.textContent = '--.- LUFS';
      if (lraEl) lraEl.textContent = '--.- LU';
      if (r128TpMax) r128TpMax.textContent = '--.- dBTP';
      if (r128Crest) r128Crest.textContent = '--.- dB';
      if (r128Time) r128Time.textContent = '--:--:--';
    };
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
      wrap.classList.toggle('sidebar-collapsed');
      localStorage.setItem('tsg-sidebar-collapsed', wrap.classList.contains('sidebar-collapsed'));
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
      // Reset R128 when target changes (like original resetR128)
      lufsMeter.reset();
      truePeakMeter.reset();
      resetMeterState();
      // Update display with fixed-width placeholders
      if (lufsM) lufsM.textContent = '--.- LUFS';
      if (lufsS) lufsS.textContent = '--.- LUFS';
      if (lufsI) lufsI.textContent = '--.- LUFS';
      if (lraEl) lraEl.textContent = '--.- LU';
      if (r128TpMax) r128TpMax.textContent = '--.- dBTP';
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
    radarSweep.onchange = () => {
      radarMaxSeconds = parseInt(radarSweep.value, 10);
      // Clear radar history when sweep time changes
      meterState.radarHistory = [];
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

  // Meter tab switcher - physics-based 3D carousel (extracted to meter-switcher.js)
  setupMeterSwitcher(meterSwitcher, meterBadge);

  // Collapsible panels
  document.querySelectorAll('.card.collapsible h2').forEach(h2 => {
    h2.onclick = () => {
      const card = h2.closest('.card');
      if (card) card.classList.toggle('collapsed');
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// RESIZE OBSERVERS
// ─────────────────────────────────────────────────────────────────────────────

function setupObservers() {
  const resizeObserver = new ResizeObserver(() => {
    if (!isDragLayoutFrozen) {
      layoutXY();
      layoutLoudness();
    }
  });

  if (meters) resizeObserver.observe(meters);
  if (xyCard) resizeObserver.observe(xyCard);
  if (loudnessCard) resizeObserver.observe(loudnessCard);
}

// ─────────────────────────────────────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

function init() {
  console.log('[Bootstrap] Initializing VERO-BAAMBI modular version');

  // Initialize UI components first (creates goniometer etc.)
  initUIComponents();

  // Initialize layout with dependencies
  initLayout({
    dom: {
      wrap,
      xyCard,
      xy,
      corr,
      monoDev,
      loudnessModule,
      radarWrap,
      loudnessRadar
    },
    uiComponents: { goniometer },
    getLayoutFrozen: () => isDragLayoutFrozen
  });

  // Size wrap
  sizeWrap();
  window.addEventListener('resize', sizeWrap);

  // Bind events
  bindEvents();

  // Setup observers
  setupObservers();

  // Enable sidebar animations after initial render
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.documentElement.classList.add('sidebar-ready');
    });
  });

  // Set initial source mode (directly set panels, don't animate on init)
  selectedInputMode = 'browser';
  if (browserSourcePanel) browserSourcePanel.classList.add('source-panel-active');
  if (btnModeBrowser) {
    btnModeBrowser.classList.add('btn-active');
    btnModeBrowser.classList.remove('btn-ghost');
  }
  updateInputSourceSummary();
  updateGenModeDisplay();

  // Initialize drag and drop
  initDragDrop({
    dom: { xy, xyCard },
    layoutCallback: layoutXY,
    setLayoutFrozen: (v) => { isDragLayoutFrozen = v; }
  });
  setupDragAndDrop();

  // Initialize render loop with dependencies (MUST be after initUIComponents)
  initRenderLoop({
    dom: {
      lufsM, xyCard, ppmCanvas, ppmLVal, ppmRVal,
      dbfs, dbL, dbR, tp, tpL, tpR,
      uptimeEl, statusSummary
    },
    meters: {
      bufL, bufR, ppmMeter, truePeakMeter
    },
    uiComponents: {
      goniometer, correlationMeter, balanceMeterUI,
      spectrumAnalyzerUI, msMeterUI, widthMeterUI,
      rotationMeterUI, radar, stereoAnalysis
    },
    config: {
      getSampleRate: () => ac.sampleRate,
      getRadarMaxSeconds: () => radarMaxSeconds,
      getTpLimit: () => TP_LIMIT
    },
    helpers: {
      layoutXY, layoutLoudness, sampleAnalysers,
      drawHBar_DBFS, drawDiodeBar_TP, drawHBar_PPM
    },
    captureState: { getActiveCapture: () => activeCapture },
    TransitionGuard,
    GlitchDebug
  });

  // Start render loop
  startRenderLoop();

  console.log('[Bootstrap] Initialization complete');
}

// Run on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
