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
import { meterState, resetMeterState, MEASURE_INTERVAL_MS, TP_PEAK_HOLD_SEC, PPM_PEAK_HOLD_SEC, FRAME_HOLD_THRESHOLD } from './meter-state.js';
// Drag and drop system - extracted from bootstrap
import { initDragDrop, setupDragAndDrop } from './drag-drop.js';
// Glitch debug utility - extracted from bootstrap
import { GlitchDebug } from './glitch-debug.js';
// Transition guard for EBU pulse blanking - extracted from bootstrap
import { TransitionGuard } from './transition-guard.js';
// Helper functions - extracted from bootstrap
import { dbToGain, clamp, formatDb, formatDbu, formatTime, getCss, formatCorr, loudnessColour as loudnessColourBase } from './helpers.js';

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
const btnStartCapture = $('btnStartCapture');
const btnStopCapture = $('btnStopCapture');
const browserSourcePanel = $('browserSourcePanel');
const externalSourcePanel = $('externalSourcePanel');
const generatorSourcePanel = $('generatorSourcePanel');
const sourcePanelsContainer = $('sourcePanelsContainer');
const inputSourceSummary = $('inputSourceSummary');

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

const ac = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });

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
// LAYOUT FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

let isDragLayoutFrozen = false;

function sizeWrap() {
  const headerH = document.querySelector('header')?.offsetHeight || 56;
  if (wrap) wrap.style.height = `calc(100dvh - ${headerH}px)`;
}

function layoutXY() {
  if (isDragLayoutFrozen || !xyCard) return;

  const dpr = window.devicePixelRatio || 1;
  const stereoContainer = xyCard.querySelector('.stereoContainer');
  if (!stereoContainer) return;

  const availH = stereoContainer.clientHeight;
  const availW = stereoContainer.clientWidth;
  const gonioSize = Math.min(availH * 0.85, availW * 0.55);

  // Goniometer
  const gonioSquare = xyCard.querySelector('.gonioSquare');
  if (gonioSquare && xy) {
    gonioSquare.style.width = gonioSize + 'px';
    gonioSquare.style.height = gonioSize + 'px';
    const w = Math.floor(gonioSize * dpr);
    if (xy.width !== w || xy.height !== w) {
      xy.width = w;
      xy.height = w;
    }
  }

  // Left column width
  const leftCol = xyCard.querySelector('.stereoLeftCol');
  if (leftCol) {
    leftCol.style.width = gonioSize + 'px';
  }

  // Phase correlation canvas
  const corrWrapEl = xyCard.querySelector('.corrWrap');
  if (corrWrapEl && corr) {
    const rect = corrWrapEl.getBoundingClientRect();
    const cw = Math.floor(rect.width * dpr);
    const ch = Math.floor(rect.height * dpr);
    if (corr.width !== cw || corr.height !== ch) {
      corr.width = Math.max(10, cw);
      corr.height = Math.max(10, ch);
    }
  }

  // Balance meter
  const monoDevWrapEl = xyCard.querySelector('.monoDevWrap');
  if (monoDevWrapEl && monoDev) {
    const rect = monoDevWrapEl.getBoundingClientRect();
    const mdw = Math.floor(rect.width * dpr);
    const mdh = Math.floor(rect.height * dpr);
    if (monoDev.width !== mdw || monoDev.height !== mdh) {
      monoDev.width = Math.max(10, mdw);
      monoDev.height = Math.max(10, mdh);
    }
  }

  // Trigger resize on goniometer
  if (goniometer) goniometer.resize();
  // Correlation meter handles its own sizing in draw()
}

function layoutLoudness() {
  if (isDragLayoutFrozen || !loudnessModule || !radarWrap || !loudnessRadar) return;

  const dpr = window.devicePixelRatio || 1;
  const r128MinHeight = 180;
  const gap = 12;

  const availH = loudnessModule.clientHeight;
  const availW = loudnessModule.clientWidth;

  const maxRadarH = availH - r128MinHeight - gap;
  const radarSize = Math.max(100, Math.min(maxRadarH, availW));

  radarWrap.style.width = radarSize + 'px';
  radarWrap.style.height = radarSize + 'px';

  const canvasSize = Math.floor(radarSize * dpr);
  if (loudnessRadar.width !== canvasSize || loudnessRadar.height !== canvasSize) {
    loudnessRadar.width = canvasSize;
    loudnessRadar.height = canvasSize;
  }
  // Radar handles its own sizing in render() via offsetWidth/Height
}

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
  sysTrimDb = clamp(parseFloat(dB) || SYS_TRIM_DEFAULT, -48, 24);
  if (sysTrimRange) sysTrimRange.value = sysTrimDb;
  if (sysTrimVal) sysTrimVal.value = Math.round(sysTrimDb);
  sourceController.setBrowserTrim(sysTrimDb);
  if (save) { try { localStorage.setItem(SYS_TRIM_STORAGE_KEY, sysTrimDb.toFixed(1)); } catch(e) {} }
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
  if (save) try { localStorage.setItem(EXT_TRIM_STORAGE_KEY, extTrimDb.toFixed(1)); } catch (e) {}
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
  [btnModeBrowser, btnModeExternal, btnModeGenerator].forEach(btn => {
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

    // Show the new panel
    if (mode === 'browser' && browserSourcePanel) browserSourcePanel.classList.add('source-panel-active');
    else if (mode === 'external' && externalSourcePanel) externalSourcePanel.classList.add('source-panel-active');
    else if (mode === 'generator' && generatorSourcePanel) generatorSourcePanel.classList.add('source-panel-active');

    // Step 3: Expand to new height
    if (sourcePanelsContainer) sourcePanelsContainer.classList.remove('collapsed');

    // Enumerate devices when switching to external mode
    if (mode === 'external') enumerateAudioDevices();

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
  }
  updateStatusPanel();
}

// Update status panel with capture and monitor states
function updateStatusPanel() {
  // Capture status
  if (dbgTab) dbgTab.textContent = activeCapture === 'browser' ? 'Running' : 'Stopped';
  if (dbgExt) dbgExt.textContent = activeCapture === 'external' ? 'Running' : 'Stopped';
  if (dbgGen) dbgGen.textContent = activeCapture === 'generator' ? 'Running' : 'Stopped';

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
  await ac.resume();

  // Stop any existing capture from OTHER sources first
  if (activeCapture && activeCapture !== selectedInputMode) {
    await stopActiveCapture();
  }

  try {
    if (selectedInputMode === 'browser') {
      await startBrowserCapture();
    } else if (selectedInputMode === 'external') {
      await startExternalCapture();
    } else if (selectedInputMode === 'generator') {
      await startGeneratorCapture();
    }
  } catch (error) {
    console.error('[Bootstrap] Capture failed:', error);
  }
}

// Browser tab capture via SourceController
// Captures audio from browser tabs using getDisplayMedia API
async function startBrowserCapture() {
  try {
    await ac.resume();

    // Initialise trim from persisted state before capture
    sourceController.setBrowserTrim(sysTrimDb);

    const track = await sourceController.startBrowserCapture();

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
    if (deviceId) try { localStorage.setItem(EXT_DEVICE_STORAGE_KEY, deviceId); } catch {}

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

async function stopActiveCapture() {
  if (activeCapture === 'browser') {
    stopBrowserCapture();
  } else if (activeCapture === 'external') {
    stopExternalCapture();
  } else if (activeCapture === 'generator') {
    stopGeneratorCapture();
  }
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

function stopCapture() {
  stopActiveCapture();
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

// Initialise render loop with dependencies
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
  TransitionGuard,
  GlitchDebug
});

// Start the 60 Hz render loop
startRenderLoop();

// ─────────────────────────────────────────────────────────────────────────────
// EVENT BINDINGS
// ─────────────────────────────────────────────────────────────────────────────

function bindEvents() {
  // Source mode buttons - use setInputMode for animated transitions
  if (btnModeBrowser) btnModeBrowser.onclick = () => setInputMode('browser');
  if (btnModeExternal) btnModeExternal.onclick = () => setInputMode('external');
  if (btnModeGenerator) btnModeGenerator.onclick = () => setInputMode('generator');

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

  // Meter tab switcher - EXACT from audio-meters-grid.html lines 4397-4430
  const METER_MODE_KEY = 'tsg-meter-mode';
  const METER_BADGES = {
    tp: 'True Peak Level (dBTP)',
    rms: 'RMS Level (dBFS)',
    ppm: 'Nordic PPM (IEC 60268-10)'
  };

  if (meterSwitcher) {
    const tabs = meterSwitcher.querySelectorAll('.meter-tab');
    const panels = meterSwitcher.querySelectorAll('.meter-panel');
    const panelsContainer = meterSwitcher.querySelector('.meter-panels');
    const cylinder = meterSwitcher.querySelector('.meter-cylinder');

    // ═══════════════════════════════════════════════════════════════════════
    // CONTINUOUS CIRCULAR POSITION MODEL WITH INERTIA
    // ═══════════════════════════════════════════════════════════════════════
    // N = 3 states on a circular topology (mod 3)
    // Position is continuous in ℝ, integrated from velocity
    // Velocity responds to target error, decays via damping
    // Microscopic overshoot allowed before settling
    // ═══════════════════════════════════════════════════════════════════════

    const N = 3;                           // Number of states
    const STEP_DEGREES = 360 / N;          // 120° between states
    const STATE_TO_INDEX = { tp: 0, rms: 1, ppm: 2 };
    const INDEX_TO_STATE = ['tp', 'rms', 'ppm'];

    // ─────────────────────────────────────────────────────────────────────────
    // PHYSICS CONSTANTS
    // ─────────────────────────────────────────────────────────────────────────
    const STIFFNESS = 0.15;      // Spring force coefficient (toward target)
    const DAMPING = 0.65;        // Velocity retained per frame (lower = more friction = less bounce)
    const EPSILON = 0.01;        // Settling threshold (degrees)
    const V_EPSILON = 0.001;     // Velocity settling threshold

    // ─────────────────────────────────────────────────────────────────────────
    // STATE VARIABLES
    // ─────────────────────────────────────────────────────────────────────────
    let position = 0;            // Continuous position (degrees, ℝ)
    let velocity = 0;            // Angular velocity (degrees/frame)
    let targetPosition = 0;      // Target position (degrees)
    let animationId = null;      // RAF handle

    /**
     * Derive logical state index from continuous position
     * logicalIndex = floor(mod(position / STEP_DEGREES, N))
     */
    function getLogicalIndex() {
      const normalized = ((position / STEP_DEGREES) % N + N) % N;
      return Math.floor(normalized);
    }

    /**
     * Physics integration step
     * Called every frame via requestAnimationFrame
     */
    function physicsStep() {
      // Compute error (signed distance to target)
      const error = targetPosition - position;

      // Apply spring force to velocity
      velocity += error * STIFFNESS;

      // Apply damping (friction)
      velocity *= DAMPING;

      // Integrate position from velocity
      position += velocity;

      // Update CSS (no transition - we handle animation)
      if (cylinder) {
        cylinder.style.setProperty('--cylinder-angle', position);
      }

      // Check if settled (both position and velocity near zero error)
      const settled = Math.abs(error) < EPSILON && Math.abs(velocity) < V_EPSILON;

      if (!settled) {
        // Continue animation
        animationId = requestAnimationFrame(physicsStep);
      } else {
        // Settled - snap to exact target (imperceptible)
        position = targetPosition;
        velocity = 0;
        if (cylinder) {
          cylinder.style.setProperty('--cylinder-angle', position);
        }
        animationId = null;
      }
    }

    /**
     * Start or redirect physics simulation toward target
     */
    function startPhysics() {
      if (animationId === null) {
        animationId = requestAnimationFrame(physicsStep);
      }
      // If already running, physics will naturally redirect
      // due to changed targetPosition (no explicit handling needed)
    }

    /**
     * Navigate to target state using shortest circular path
     * Computes both directions, chooses minimum distance
     * Sets target and starts physics simulation
     */
    function navigateTo(targetState) {
      const targetIndex = STATE_TO_INDEX[targetState];
      const currentNorm = ((position / STEP_DEGREES) % N + N) % N;

      // Compute forward and backward distances on the circle
      const forwardDist = ((targetIndex - currentNorm) % N + N) % N;
      const backwardDist = N - forwardDist;

      // Choose direction with minimum absolute distance
      let delta;
      if (forwardDist <= backwardDist) {
        delta = forwardDist;
      } else {
        delta = -backwardDist;
      }

      // Set target position (velocity will carry us there)
      targetPosition = position + delta * STEP_DEGREES;

      // Start physics (or let it continue with new target)
      startPhysics();

      // Update which panel is facing (for pointer-events and opacity)
      updateFacingPanel(targetIndex);

      // Update tabs (visual + ARIA)
      tabs.forEach(tab => {
        const isActive = tab.dataset.meter === targetState;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
        tab.setAttribute('tabindex', isActive ? '0' : '-1');
      });

      // Update badge
      if (meterBadge && METER_BADGES[targetState]) {
        meterBadge.textContent = METER_BADGES[targetState];
      }
    }

    /**
     * Update .facing class based on which panel is at front
     */
    function updateFacingPanel(index) {
      const state = INDEX_TO_STATE[index];
      panels.forEach(panel => {
        panel.classList.toggle('facing', panel.dataset.meter === state);
      });
    }

    // Restore saved mode (default: tp)
    const savedMode = localStorage.getItem(METER_MODE_KEY) || 'tp';
    const savedIndex = STATE_TO_INDEX[savedMode] || 0;

    // Set initial position without animation
    position = savedIndex * STEP_DEGREES;
    if (cylinder) {
      cylinder.style.setProperty('--cylinder-angle', position);
    }
    updateFacingPanel(savedIndex);
    tabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.meter === savedMode);
    });
    if (meterBadge && METER_BADGES[savedMode]) {
      meterBadge.textContent = METER_BADGES[savedMode];
    }

    // Enable transitions after initial render
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (panelsContainer) panelsContainer.classList.add('meter-carousel-ready');
      });
    });

    // Tab click handlers - navigate via continuous position
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const mode = tab.dataset.meter;
        navigateTo(mode);
        localStorage.setItem(METER_MODE_KEY, mode);
      });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // KEYBOARD NAVIGATION (a11y)
    // ─────────────────────────────────────────────────────────────────────────
    // Left/Right arrows navigate between tabs, Enter/Space activates
    const tabsContainer = meterSwitcher.querySelector('.meter-tabs');
    if (tabsContainer) {
      tabsContainer.addEventListener('keydown', (e) => {
        const tabsArray = Array.from(tabs);
        const currentIndex = tabsArray.findIndex(t => t === document.activeElement);
        if (currentIndex === -1) return;

        let newIndex = currentIndex;

        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          newIndex = (currentIndex + 1) % tabsArray.length;
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          newIndex = (currentIndex - 1 + tabsArray.length) % tabsArray.length;
        } else if (e.key === 'Home') {
          e.preventDefault();
          newIndex = 0;
        } else if (e.key === 'End') {
          e.preventDefault();
          newIndex = tabsArray.length - 1;
        }

        if (newIndex !== currentIndex) {
          const newTab = tabsArray[newIndex];
          newTab.focus();
          // Activate on arrow key (common pattern for tabs)
          const mode = newTab.dataset.meter;
          navigateTo(mode);
          localStorage.setItem(METER_MODE_KEY, mode);
        }
      });
    }
  }

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

  // Size wrap
  sizeWrap();
  window.addEventListener('resize', sizeWrap);

  // Initialize UI components
  initUIComponents();

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
