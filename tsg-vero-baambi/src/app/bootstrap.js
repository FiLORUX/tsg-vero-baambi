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

import { Goniometer } from '../ui/goniometer.js';
import { CorrelationMeter } from '../ui/correlation-meter.js';
import { LoudnessRadar } from '../ui/radar.js';
import { LUFSMeter, formatLUFS } from '../metering/lufs.js';
import { TruePeakMeter, formatTruePeak } from '../metering/true-peak.js';
import { PPMMeter, formatPPM } from '../metering/ppm.js';
import { StereoMeter, formatCorrelation } from '../stereo/correlation.js';

// Helper to get CSS custom property value (for correlation meter colors)
function getCss(prop) {
  return getComputedStyle(document.documentElement).getPropertyValue(prop).trim();
}

// Format correlation value for display (EXACT from original)
function formatCorr(v) {
  const sign = v >= 0 ? '+' : '';
  return sign + v.toFixed(2);
}
// Stereo analysis widgets
import { StereoAnalysisEngine } from '../ui/stereo-analysis.js';
import { WidthMeter } from '../ui/width-meter.js';
import { RotationMeter } from '../ui/rotation-meter.js';
import { SpectrumAnalyzer } from '../ui/spectrum.js';
import { MSMeter } from '../ui/ms-meter.js';
import { BalanceMeter } from '../ui/balance-meter.js';
// Bar meters
import { drawHBar_DBFS, drawDiodeBar_TP, drawHBar_PPM, layoutDBFSScale, layoutTPScale, layoutPPMScale, setTpLimit, updateTpLimitDisplay } from '../ui/bar-meter.js';

// ─────────────────────────────────────────────────────────────────────────────
// TRANSITIONGUARD - EXACT from audio-meters-grid.html lines 1848-1885
// ─────────────────────────────────────────────────────────────────────────────
// Blanking during EBU pulse transitions ONLY
// Prevents visual artifacts from gain-change transients
//
// NOTE: Automatic edge detection was REMOVED because RMS jitter
// caused false triggers → random blanking artifacts.
// Now only triggers explicitly from EBU pulse logic.
const TransitionGuard = (function() {
  'use strict';

  let blankUntil = 0;
  // Blanking: 60ms covers analyser buffer flush + 1 render frame
  const BLANK_DURATION_MS = 60;

  return {
    // Call when EBU pulse state changes
    trigger() {
      blankUntil = performance.now() + BLANK_DURATION_MS;
    },

    shouldRender() {
      return performance.now() >= blankUntil;
    },

    isBlanking() {
      return performance.now() < blankUntil;
    },

    reset() {
      blankUntil = 0;
    }
  };
})();

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURABLE PARAMETERS
// ─────────────────────────────────────────────────────────────────────────────

let LOUDNESS_TARGET = -23;
let TP_LIMIT = -1;
let radarMaxSeconds = 60;

const TP_SCALE_MIN = -60;
const TP_SCALE_MAX = 3;

// Radar history (external as in original)
let radarHistory = [];

// Peak indicator state - EXACT from audio-meters-grid.html lines 3583-3586
// Uses CURRENT True Peak with 500ms hold (not cumulative max)
const PEAK_INDICATOR_HOLD_MS = 500;
let peakIndicatorOn = false;
let peakIndicatorLastTrigger = 0;

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
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const dbToGain = dB => Math.pow(10, dB / 20);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function formatDb(value, decimals = 1, width = 5) {
  if (!isFinite(value) || value < -99) return '--.-'.padStart(width);
  return value.toFixed(decimals).padStart(width);
}

// EXACT from audio-meters-grid.html lines 2080-2086
// formatDbu: With snap-to-zero for PPM, always with +/- sign
function formatDbu(value, decimals = 1, snapWindow = 0.25, width = 5) {
  if (!isFinite(value) || value < -99) return '--.-'.padStart(width);
  const snapped = (Math.abs(value) < snapWindow) ? 0 : value;
  const sign = snapped >= 0 ? '+' : '';
  return (sign + snapped.toFixed(decimals)).padStart(width);
}

function formatTime(ms) {
  if (!isFinite(ms) || ms < 0) return '--:--:--';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// EXACT from audio-meters-grid.html lines 3691-3698
function loudnessColor(lufs) {
  if (!isFinite(lufs)) return 'var(--muted)';
  const offset = lufs - LOUDNESS_TARGET;
  if (offset >= -1 && offset <= 1) return getCss('--ok');      // −24 to −22: green (on target)
  if (offset < -1) return getCss('--cyan');                     // Below −24: cyan (too quiet)
  if (offset <= 3) return getCss('--warn');                     // −22 to −20: amber (bit loud)
  return getCss('--hot');                                        // Above −20: red (too loud)
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE MANAGEMENT - EXACT from audio-meters-grid.html lines 3835-3970
// ─────────────────────────────────────────────────────────────────────────────

// State: selectedMode = UI selection, activeCapture = currently running source
let selectedInputMode = 'browser'; // 'browser', 'external', 'generator'
let activeCapture = null; // null, 'browser', 'external', 'generator'

let currentSource = null;
let currentStream = null;

// Generator state
let genOsc = null;
let genGain = null;
let leftGain = null;
let rightGain = null;
let merger = null;
let genMonGain = null;
let genSplit = null;
let monitorMuted = false;
let ebuModeActive = false;
let ebuPrevState = true;
let leftMuteTimer = 0;

// Browser source state - EXACT from audio-meters-grid.html line 3777
let sysSrc = null;
let sysSplit = null;
let sysMonGain = null;
let sysMonitorMuted = true;
let sysTrimNode = null;
let sysTrimDb = 0;
const SYS_TRIM_DEFAULT = -12;
const SYS_TRIM_STORAGE_KEY = 'tsg_sysTrimDb';

// External source state - EXACT from audio-meters-grid.html lines 3840-3850
let extSrc = null;
let extSplit = null;
let extMonGainNode = null;
let extMonitorMuted = true;
let extTrimNode = null;
let extTrimDb = 0;
const EXT_TRIM_DEFAULT = 0;
const EXT_TRIM_STORAGE_KEY = 'tsg_extTrimDb';
const EXT_DEVICE_STORAGE_KEY = 'tsg_extDeviceId';

// Monitor nodes
const monitorGain = ac.createGain();
monitorGain.gain.value = 0;
monitorGain.connect(ac.destination);

// --- Sys (Browser) Trim Control - EXACT from audio-meters-grid.html lines 3780-3796 ---
function setSysTrim(dB, save = true) {
  sysTrimDb = clamp(parseFloat(dB) || SYS_TRIM_DEFAULT, -48, 24);
  if (sysTrimRange) sysTrimRange.value = sysTrimDb;
  if (sysTrimVal) sysTrimVal.value = Math.round(sysTrimDb);
  if (sysTrimNode) { sysTrimNode.gain.value = dbToGain(sysTrimDb); }
  if (save) { try { localStorage.setItem(SYS_TRIM_STORAGE_KEY, sysTrimDb.toFixed(1)); } catch(e) {} }
}

// Restore saved browser trim
const storedSysTrim = localStorage.getItem(SYS_TRIM_STORAGE_KEY);
setSysTrim(storedSysTrim !== null ? parseFloat(storedSysTrim) : SYS_TRIM_DEFAULT, false);

// --- Ext Trim Control - EXACT from audio-meters-grid.html lines 4070-4086 ---
function setExtTrim(dB, save = true) {
  extTrimDb = clamp(parseFloat(dB) || EXT_TRIM_DEFAULT, -48, 24);
  if (extTrimRange) extTrimRange.value = extTrimDb;
  if (extTrimVal) extTrimVal.value = Math.round(extTrimDb);
  if (extTrimNode) { extTrimNode.gain.value = dbToGain(extTrimDb); }
  if (save) try { localStorage.setItem(EXT_TRIM_STORAGE_KEY, extTrimDb.toFixed(1)); } catch (e) {}
}

// Restore saved external trim
const storedExtTrim = localStorage.getItem(EXT_TRIM_STORAGE_KEY);
setExtTrim(storedExtTrim !== null ? parseFloat(storedExtTrim) : EXT_TRIM_DEFAULT, false);

// --- Toggle Sys Monitor Mute - EXACT from audio-meters-grid.html lines 3819-3827 ---
function toggleSysMonitorMute() {
  if (!sysMonGain) return;
  sysMonitorMuted = !sysMonitorMuted;
  sysMonGain.gain.value = sysMonitorMuted ? 0 : parseFloat(sysMonGainEl?.value || 20) / 100;
  if (sysMonVal) sysMonVal.value = Math.round(sysMonGainEl?.value || 20);
  // RED when muted, neutral when not muted
  if (sysMonitorMuted) {
    if (btnSysMonMute) { btnSysMonMute.classList.add('btn-muted'); btnSysMonMute.classList.remove('btn-ghost'); }
  } else {
    if (btnSysMonMute) { btnSysMonMute.classList.remove('btn-muted'); btnSysMonMute.classList.add('btn-ghost'); }
  }
  updateStatusPanel();
}

// --- Toggle Ext Monitor Mute - EXACT from audio-meters-grid.html lines 4180-4195 ---
function toggleExtMonitorMute() {
  if (!extMonGainNode) return;
  extMonitorMuted = !extMonitorMuted;
  extMonGainNode.gain.value = extMonitorMuted ? 0 : parseFloat(extMonGainEl?.value || 20) / 100;
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

// Helper function EXACT from audio-meters-grid.html line 2272
function connectStereoToMix(node) {
  const split = ac.createChannelSplitter(2);
  node.connect(split);
  split.connect(mixL, 0);
  split.connect(mixR, 1);
  // Note: kHP_L/kHP_R for K-weighted LUFS would be connected here if available
  return split;
}

// EXACT from audio-meters-grid.html lines 3985-4025
async function startBrowserCapture() {
  try {
    await ac.resume();
    currentStream = await navigator.mediaDevices.getDisplayMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 },
      video: true
    });
    currentStream.getVideoTracks().forEach(t => t.stop());
    const track = currentStream.getAudioTracks()[0];
    if (!track) throw new Error('No audio track available.');

    // Force stereo if possible
    try { track.applyConstraints({ advanced: [{ channelCount: 2 }] }); } catch {}
    track.contentHint = 'music';

    sysSrc = ac.createMediaStreamSource(currentStream);

    // Trim node for input gain adjustment
    sysTrimNode = ac.createGain();
    sysTrimNode.gain.value = dbToGain(sysTrimDb);
    sysSrc.connect(sysTrimNode);

    // Connect to analysis bus via splitter
    sysSplit = connectStereoToMix(sysTrimNode);

    // Monitor output
    sysMonGain = ac.createGain();
    sysMonGain.gain.value = 0; // Muted by default
    sysTrimNode.connect(sysMonGain).connect(ac.destination);

    // Default: muted (RED button)
    if (btnSysMonMute) { btnSysMonMute.classList.add('btn-muted'); btnSysMonMute.classList.remove('btn-ghost'); }
    sysMonitorMuted = true;

    // Update info
    const set = track.getSettings ? track.getSettings() : {};
    if (srcKind) srcKind.textContent = (track.kind || 'audio').charAt(0).toUpperCase() + (track.kind || 'audio').slice(1);
    if (cc) cc.textContent = set.channelCount ?? 'Unknown';
    if (sr) sr.textContent = ac.sampleRate + ' Hz';
    if (stOK) stOK.textContent = (set.channelCount >= 2 ? 'Yes' : 'Uncertain/Mono?');

    activeCapture = 'browser';
    updateCaptureButtons();
    updateInputSourceSummary();
  } catch (e) {
    console.error('[Bootstrap] Browser capture failed:', e);
    alert(e.message || e);
  }
}

// EXACT from audio-meters-grid.html lines 4120-4170
async function startExternalCapture() {
  try {
    await ac.resume();
    const deviceId = extDeviceSelect?.value;
    // Save device selection
    if (deviceId) try { localStorage.setItem(EXT_DEVICE_STORAGE_KEY, deviceId); } catch {}

    currentStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2
      }
    });

    const track = currentStream.getAudioTracks()[0];
    if (!track) throw new Error('No audio track available.');

    // Force stereo if possible
    try { track.applyConstraints({ advanced: [{ channelCount: 2 }] }); } catch {}
    track.contentHint = 'music';

    extSrc = ac.createMediaStreamSource(currentStream);

    // Trim node for input gain adjustment
    extTrimNode = ac.createGain();
    extTrimNode.gain.value = dbToGain(extTrimDb);
    extSrc.connect(extTrimNode);

    // Connect to analysis bus via splitter
    extSplit = connectStereoToMix(extTrimNode);

    // Monitor output
    extMonGainNode = ac.createGain();
    extMonGainNode.gain.value = 0; // Muted by default
    extTrimNode.connect(extMonGainNode).connect(ac.destination);

    // Default: muted (RED button)
    if (btnExtMonMute) { btnExtMonMute.classList.add('btn-muted'); btnExtMonMute.classList.remove('btn-ghost'); }
    extMonitorMuted = true;

    const set = track.getSettings ? track.getSettings() : {};
    if (extDevice) extDevice.textContent = track.label || 'Unknown';
    if (extCc) extCc.textContent = set.channelCount ?? 'Unknown';
    if (extSr) extSr.textContent = ac.sampleRate + ' Hz';
    if (extStatus) extStatus.textContent = (set.channelCount >= 2 ? 'Stereo' : 'Active');

    activeCapture = 'external';
    updateCaptureButtons();
    updateInputSourceSummary();
  } catch (e) {
    console.error('[Bootstrap] External capture failed:', e);
    alert(e.message || e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADVANCED SIGNAL GENERATOR
// Supports: sine, pink/white/brown noise, sweep, GLITS, Lissajous patterns
// ═══════════════════════════════════════════════════════════════════════════════

// Generator state
let genSourceNodes = [];  // Array of source nodes (oscillators, noise sources)
let genFilterNodes = [];  // Array of filter nodes
let sweepInterval = null;
let glitsInterval = null;
let glitsPhase = 0;

// dB to linear amplitude
const dbToLinear = db => Math.pow(10, db / 20);

// Create white noise buffer (reusable, with crossfade for seamless looping)
let whiteNoiseBuffer = null;
function getWhiteNoiseBuffer() {
  if (whiteNoiseBuffer && whiteNoiseBuffer.sampleRate === ac.sampleRate) {
    return whiteNoiseBuffer;
  }
  const bufferSize = 10 * ac.sampleRate; // 10 seconds for less frequent looping
  const crossfadeSize = Math.floor(0.05 * ac.sampleRate); // 50ms crossfade
  whiteNoiseBuffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
  const data = whiteNoiseBuffer.getChannelData(0);

  // Fill with white noise
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  // Apply crossfade at loop point for seamless transition
  for (let i = 0; i < crossfadeSize; i++) {
    const fadeIn = i / crossfadeSize;
    const fadeOut = 1 - fadeIn;
    // Blend end with beginning
    const endIdx = bufferSize - crossfadeSize + i;
    data[endIdx] = data[endIdx] * fadeOut + data[i] * fadeIn;
  }

  return whiteNoiseBuffer;
}

// Create noise source with optional filtering
function createNoiseSource(type, loFreq, hiFreq) {
  const noise = ac.createBufferSource();
  noise.buffer = getWhiteNoiseBuffer();
  noise.loop = true;

  // For pink/brown noise, we need filtering
  if (type === 'white') {
    // Bandpass filter for bandwidth limiting
    if (loFreq > 20 || hiFreq < 20000) {
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = Math.sqrt(loFreq * hiFreq);
      bp.Q.value = bp.frequency.value / (hiFreq - loFreq);
      noise.connect(bp);
      genFilterNodes.push(bp);
      return { source: noise, output: bp };
    }
    return { source: noise, output: noise };
  }

  if (type === 'pink') {
    // Pink noise: -3dB/octave slope using multiple filters
    // Approximate with cascaded lowpass filters
    const lp1 = ac.createBiquadFilter();
    lp1.type = 'lowpass';
    lp1.frequency.value = hiFreq;

    const hp1 = ac.createBiquadFilter();
    hp1.type = 'highpass';
    hp1.frequency.value = loFreq;

    // Pink filter approximation: gentle lowpass rolloff
    const pinkFilter = ac.createBiquadFilter();
    pinkFilter.type = 'lowshelf';
    pinkFilter.frequency.value = 1000;
    pinkFilter.gain.value = -3;

    noise.connect(hp1);
    hp1.connect(lp1);
    lp1.connect(pinkFilter);
    genFilterNodes.push(hp1, lp1, pinkFilter);
    return { source: noise, output: pinkFilter };
  }

  if (type === 'brown') {
    // Brown noise: -6dB/octave (integrate white noise)
    const lp1 = ac.createBiquadFilter();
    lp1.type = 'lowpass';
    lp1.frequency.value = hiFreq;
    lp1.Q.value = 0.5;

    const hp1 = ac.createBiquadFilter();
    hp1.type = 'highpass';
    hp1.frequency.value = loFreq;

    // Strong lowpass for brown characteristic
    const brownFilter = ac.createBiquadFilter();
    brownFilter.type = 'lowpass';
    brownFilter.frequency.value = 200;
    brownFilter.Q.value = 0.7;

    noise.connect(brownFilter);
    brownFilter.connect(hp1);
    hp1.connect(lp1);
    genFilterNodes.push(brownFilter, hp1, lp1);
    return { source: noise, output: lp1 };
  }

  return { source: noise, output: noise };
}

// Get preset configuration from selected option
function getPresetConfig() {
  if (!genPreset) return null;
  const opt = genPreset.options[genPreset.selectedIndex];
  if (!opt) return null;

  return {
    type: opt.dataset.type || 'sine',
    freq: parseFloat(opt.dataset.freq) || 1000,
    db: parseFloat(opt.dataset.db) || -18,
    lo: parseFloat(opt.dataset.lo) || 20,
    hi: parseFloat(opt.dataset.hi) || 20000,
    routing: opt.dataset.routing || 'stereo',
    phase: parseFloat(opt.dataset.phase) || 0,
    ratio: opt.dataset.ratio || '1:1',
    duration: parseFloat(opt.dataset.duration) || 20,
    pulsed: opt.dataset.pulsed === 'true'
  };
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

// Clean up generator nodes
function cleanupGeneratorNodes() {
  if (sweepInterval) { clearInterval(sweepInterval); sweepInterval = null; }
  if (glitsInterval) { clearInterval(glitsInterval); glitsInterval = null; }

  // Cancel any scheduled automation events before disconnecting
  [genGain, leftGain, rightGain, genMonGain].forEach(n => {
    try { n && n.gain && n.gain.cancelScheduledValues(0); } catch {}
  });

  genSourceNodes.forEach(n => { try { n.stop && n.stop(); n.disconnect(); } catch {} });
  genFilterNodes.forEach(n => { try { n.disconnect(); } catch {} });
  [genGain, leftGain, rightGain, merger, genMonGain, genSplit].forEach(n => {
    try { n && n.disconnect(); } catch {}
  });

  genSourceNodes = [];
  genFilterNodes = [];
  genOsc = null;
  genGain = null;
  leftGain = null;
  rightGain = null;

  // Reset EBU state to prevent stale timing affecting new generators
  ebuModeActive = false;
  ebuPrevState = true;
  leftMuteTimer = 0;
}

// Create and connect generator based on preset
async function startGeneratorCapture() {
  if (activeCapture === 'generator' && genMonGain) {
    // Already running - just switch preset
    switchGeneratorPreset();
    return;
  }

  await createGeneratorSignal();

  activeCapture = 'generator';
  updateCaptureButtons();
  updateInputSourceSummary();
  updateGenModeDisplay();
}

// Switch preset without full restart
function switchGeneratorPreset() {
  if (activeCapture !== 'generator') return;

  // Store monitor state
  const currentMonitorGain = genMonGain ? genMonGain.gain.value : 0;
  const wasRunning = genSourceNodes.length > 0;

  // Clean up current signal
  cleanupGeneratorNodes();

  // Create new signal
  createGeneratorSignal(currentMonitorGain);
  updateGenModeDisplay();
}

// Main signal creation function
async function createGeneratorSignal(existingMonitorGain = null) {
  const config = getPresetConfig();
  if (!config) return;

  const amplitude = dbToLinear(config.db);

  // Create output chain
  genGain = ac.createGain();
  genGain.gain.value = amplitude;

  leftGain = ac.createGain();
  rightGain = ac.createGain();
  merger = ac.createChannelMerger(2);

  // Apply routing
  switch (config.routing) {
    case 'left-only':
      leftGain.gain.value = 1;
      rightGain.gain.value = 0;
      break;
    case 'right-only':
      leftGain.gain.value = 0;
      rightGain.gain.value = 1;
      break;
    case 'anti-phase':
      leftGain.gain.value = 1;
      rightGain.gain.value = -1;
      break;
    default:
      leftGain.gain.value = 1;
      rightGain.gain.value = 1;
  }

  // Create signal based on type
  if (config.type === 'sine') {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = config.freq;
    osc.connect(genGain);
    osc.start();
    genOsc = osc;
    genSourceNodes.push(osc);

    genGain.connect(leftGain);
    genGain.connect(rightGain);

  } else if (config.type === 'pink' || config.type === 'white' || config.type === 'brown') {
    if (config.routing === 'stereo-uncorr') {
      // Uncorrelated: separate noise for L and R
      const noiseL = createNoiseSource(config.type, config.lo, config.hi);
      const noiseR = createNoiseSource(config.type, config.lo, config.hi);

      const gainL = ac.createGain();
      const gainR = ac.createGain();
      gainL.gain.value = amplitude;
      gainR.gain.value = amplitude;

      noiseL.output.connect(gainL);
      noiseR.output.connect(gainR);
      gainL.connect(leftGain);
      gainR.connect(rightGain);

      noiseL.source.start();
      noiseR.source.start();
      genSourceNodes.push(noiseL.source, noiseR.source);
      genFilterNodes.push(gainL, gainR);
    } else {
      // Correlated: same noise to both channels
      const noise = createNoiseSource(config.type, config.lo, config.hi);
      noise.output.connect(genGain);
      genGain.connect(leftGain);
      genGain.connect(rightGain);
      noise.source.start();
      genSourceNodes.push(noise.source);
    }

  } else if (config.type === 'sweep') {
    // AES17-compliant continuous logarithmic sine sweep
    // Uses Web Audio API automation for glitch-free, sample-accurate frequency change
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.connect(genGain);
    genOsc = osc;
    genSourceNodes.push(osc);

    genGain.connect(leftGain);
    genGain.connect(rightGain);

    const startFreq = config.lo;
    const endFreq = config.hi;
    const durationSec = config.duration;

    // Schedule continuous logarithmic sweep using exponentialRampToValueAtTime
    // This creates a true logarithmic sweep (constant octaves per second)
    function scheduleSweepCycle(startTime) {
      // Set start frequency
      osc.frequency.setValueAtTime(startFreq, startTime);
      // Exponential ramp to end frequency (logarithmic in frequency domain)
      osc.frequency.exponentialRampToValueAtTime(endFreq, startTime + durationSec);
    }

    // Start first sweep
    const now = ac.currentTime;
    scheduleSweepCycle(now);
    osc.start(now);

    // Schedule repeating sweeps (lookahead scheduling)
    let nextSweepTime = now + durationSec;
    sweepInterval = setInterval(() => {
      // Schedule next sweep when we're within 1 second of it
      const currentTime = ac.currentTime;
      if (nextSweepTime - currentTime < 1.0) {
        scheduleSweepCycle(nextSweepTime);
        nextSweepTime += durationSec;
      }
    }, 200);

  } else if (config.type === 'glits') {
    // GLITS (EBU Tech 3304): 1kHz tone with channel identification pattern
    // Uses pre-scheduled Web Audio automation for glitch-free operation
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 1000;
    osc.connect(genGain);
    genOsc = osc;
    genSourceNodes.push(osc);

    genGain.connect(leftGain);
    genGain.connect(rightGain);

    // GLITS pattern timing (4 second cycle):
    // Left:  mute at 0-250ms
    // Right: mute at 500-750ms and 1000-1250ms
    const CYCLE_SEC = 4.0;
    const RAMP_SEC = 0.002; // 2ms ramp to avoid clicks

    function scheduleGlitsCycle(cycleStart) {
      // Left channel: mute 0-250ms
      leftGain.gain.setValueAtTime(1, cycleStart);
      leftGain.gain.linearRampToValueAtTime(0, cycleStart + RAMP_SEC);
      leftGain.gain.setValueAtTime(0, cycleStart + 0.250 - RAMP_SEC);
      leftGain.gain.linearRampToValueAtTime(1, cycleStart + 0.250);

      // Right channel: mute 500-750ms
      rightGain.gain.setValueAtTime(1, cycleStart + 0.500);
      rightGain.gain.linearRampToValueAtTime(0, cycleStart + 0.500 + RAMP_SEC);
      rightGain.gain.setValueAtTime(0, cycleStart + 0.750 - RAMP_SEC);
      rightGain.gain.linearRampToValueAtTime(1, cycleStart + 0.750);

      // Right channel: mute 1000-1250ms
      rightGain.gain.setValueAtTime(1, cycleStart + 1.000);
      rightGain.gain.linearRampToValueAtTime(0, cycleStart + 1.000 + RAMP_SEC);
      rightGain.gain.setValueAtTime(0, cycleStart + 1.250 - RAMP_SEC);
      rightGain.gain.linearRampToValueAtTime(1, cycleStart + 1.250);
    }

    // Initialize gains
    leftGain.gain.setValueAtTime(1, ac.currentTime);
    rightGain.gain.setValueAtTime(1, ac.currentTime);

    // Start oscillator and first cycle
    const now = ac.currentTime;
    osc.start(now);
    scheduleGlitsCycle(now);

    // Lookahead scheduling for seamless cycles
    let nextCycleTime = now + CYCLE_SEC;
    glitsInterval = setInterval(() => {
      const currentTime = ac.currentTime;
      // Schedule next cycle when within 1 second
      if (nextCycleTime - currentTime < 1.0) {
        scheduleGlitsCycle(nextCycleTime);
        nextCycleTime += CYCLE_SEC;
      }
    }, 200);

  } else if (config.type === 'lissajous') {
    // Lissajous patterns: precise phase relationships for goniometer testing
    // Uses DelayNode for sample-accurate, drift-free phase offset
    let freqL = config.freq;
    let freqR = config.freq;

    // Parse frequency ratio if present (for complex Lissajous figures)
    if (config.ratio && config.ratio !== '1:1') {
      const [ratioL, ratioR] = config.ratio.split(':').map(Number);
      freqL = config.freq;
      freqR = config.freq * (ratioR / ratioL);
    }

    // For same-frequency Lissajous (phase offset patterns), use single oscillator + delay
    // This ensures zero drift between channels
    if (freqL === freqR && config.phase !== 0) {
      const osc = ac.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freqL;

      const gainL = ac.createGain();
      const gainR = ac.createGain();
      gainL.gain.value = amplitude;
      gainR.gain.value = amplitude;

      // DelayNode for precise phase offset (phase in degrees -> delay in seconds)
      const phaseDelaySec = (config.phase / 360) * (1 / freqR);
      const delayNode = ac.createDelay(1.0); // Max 1 second delay
      delayNode.delayTime.value = phaseDelaySec;

      // Left: direct from oscillator
      osc.connect(gainL);
      gainL.connect(leftGain);

      // Right: through delay for phase offset
      osc.connect(delayNode);
      delayNode.connect(gainR);
      gainR.connect(rightGain);

      osc.start();
      genSourceNodes.push(osc);
      genFilterNodes.push(gainL, gainR, delayNode);

    } else {
      // Different frequencies (complex Lissajous) - use two oscillators
      // Start synchronized for consistent pattern
      const oscL = ac.createOscillator();
      const oscR = ac.createOscillator();
      oscL.type = 'sine';
      oscR.type = 'sine';
      oscL.frequency.value = freqL;
      oscR.frequency.value = freqR;

      const gainL = ac.createGain();
      const gainR = ac.createGain();
      gainL.gain.value = amplitude;
      gainR.gain.value = amplitude;

      oscL.connect(gainL);
      oscR.connect(gainR);
      gainL.connect(leftGain);
      gainR.connect(rightGain);

      // Start both at exact same time for synchronized pattern
      const startTime = ac.currentTime + 0.01;
      oscL.start(startTime);
      oscR.start(startTime);

      genSourceNodes.push(oscL, oscR);
      genFilterNodes.push(gainL, gainR);
    }
  }

  // Connect to merger
  leftGain.connect(merger, 0, 0);
  rightGain.connect(merger, 0, 1);

  // Monitor output
  genMonGain = ac.createGain();
  // Use existing monitor gain or read from slider (NOT muted by default)
  if (existingMonitorGain !== null) {
    genMonGain.gain.value = existingMonitorGain;
  } else if (monGainEl && !monitorMuted) {
    genMonGain.gain.value = parseFloat(monGainEl.value) / 100;
  } else {
    genMonGain.gain.value = 0;
  }
  merger.connect(genMonGain).connect(ac.destination);

  // Analysis output
  genSplit = ac.createChannelSplitter(2);
  merger.connect(genSplit);
  genSplit.connect(mixL, 0);
  genSplit.connect(mixR, 1);

  ebuModeActive = false;
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

// EXACT from audio-meters-grid.html lines 4025-4040
function stopBrowserCapture() {
  [sysSrc, sysTrimNode, sysSplit, sysMonGain].forEach(n => {
    try { n && n.disconnect && n.disconnect(); } catch {}
  });
  sysSrc = null; sysTrimNode = null; sysSplit = null; sysMonGain = null;
  if (currentStream) {
    currentStream.getTracks().forEach(track => track.stop());
    currentStream = null;
  }
  sysMonitorMuted = true;
  if (activeCapture === 'browser') activeCapture = null;
  updateCaptureButtons();
  updateInputSourceSummary();
}

// EXACT from audio-meters-grid.html lines 4170-4185
function stopExternalCapture() {
  [extSrc, extTrimNode, extSplit, extMonGainNode].forEach(n => {
    try { n && n.disconnect && n.disconnect(); } catch {}
  });
  extSrc = null; extTrimNode = null; extSplit = null; extMonGainNode = null;
  if (currentStream) {
    currentStream.getTracks().forEach(track => track.stop());
    currentStream = null;
  }
  if (extStatus) extStatus.textContent = 'Stopped';
  extMonitorMuted = true;
  if (activeCapture === 'external') activeCapture = null;
  updateCaptureButtons();
  updateInputSourceSummary();
}

function stopGeneratorCapture() {
  cleanupGeneratorNodes();
  merger = null; genMonGain = null; genSplit = null;
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
// MEASUREMENT LOOP (20 Hz) - EXACT from audio-meters-grid.html lines 4840-4920
// ─────────────────────────────────────────────────────────────────────────────

const MEASURE_INTERVAL_MS = 50;
let startTs = performance.now();
let lastMeasureTime = performance.now();
let tpMaxL = -Infinity;
let tpMaxR = -Infinity;
let crestPeak = -Infinity;

function measureLoop() {
  const now = performance.now();
  const dt = now - lastMeasureTime;
  lastMeasureTime = now;

  // EBU Stereo-ID pulse timing - only for pulsed presets (data-pulsed="true")
  const config = activeCapture === 'generator' ? getPresetConfig() : null;
  const isPulsedPreset = config && config.pulsed && config.type === 'sine' && !glitsInterval && !sweepInterval;

  if (isPulsedPreset && leftGain) {
    ebuModeActive = true;
    leftMuteTimer += dt;
    const EBU_PERIOD_MS = 3000;
    const EBU_MUTE_MS = 250;
    const shouldBeOn = (leftMuteTimer % EBU_PERIOD_MS) >= EBU_MUTE_MS;

    // Detect state transition and trigger blanking
    if (shouldBeOn !== ebuPrevState) {
      TransitionGuard.trigger();
      // Use linearRamp for smooth transition (avoids clicks/glitches)
      const target = shouldBeOn ? 1 : 0;
      const rampTime = 0.002; // 2ms ramp
      const now = ac.currentTime;
      leftGain.gain.setValueAtTime(leftGain.gain.value, now);
      leftGain.gain.linearRampToValueAtTime(target, now + rampTime);
      ebuPrevState = shouldBeOn;
    }
  } else if (ebuModeActive && !isPulsedPreset) {
    // Pulsed mode was just disabled (switched to non-pulsed preset) - ensure L is full volume
    ebuModeActive = false;
    if (leftGain) {
      const now = ac.currentTime;
      leftGain.gain.setValueAtTime(leftGain.gain.value, now);
      leftGain.gain.linearRampToValueAtTime(1, now + 0.002);
    }
  }

  if (!activeCapture) return;

  // Update LUFS meter
  const energy = lufsMeter.calculateBlockEnergy(bufL, bufR);
  lufsMeter.pushBlock(energy);
  const readings = lufsMeter.getReadings();

  // Time since reset - for gated display of accumulated values
  const elapsedSec = (performance.now() - startTs) / 1000;

  // Display delays for accumulated values (need time for meaningful data):
  // M (Momentary): 400ms window → show after 1s
  // S (Short-term): 3s window → show after 10s
  // I (Integrated): gated → show after 30s
  const DELAY_M = 1;
  const DELAY_S = 10;
  const DELAY_I = 30;

  // Update displays with color and time-gating
  if (lufsM) {
    const mDisp = readings.momentary;
    if (elapsedSec >= DELAY_M && isFinite(mDisp)) {
      lufsM.textContent = formatLUFS(mDisp);
      lufsM.style.color = loudnessColor(mDisp);
    } else {
      lufsM.textContent = '--.- LUFS';
      lufsM.style.color = '';
    }
    lufsM.dataset.v = mDisp;
  }
  if (lufsS) {
    const sDisp = readings.shortTerm;
    if (elapsedSec >= DELAY_S && isFinite(sDisp)) {
      lufsS.textContent = formatLUFS(sDisp);
      lufsS.style.color = loudnessColor(sDisp);
    } else {
      lufsS.textContent = '--.- LUFS';
      lufsS.style.color = '';
    }
  }
  if (lufsI) {
    const iDisp = readings.integrated;
    if (elapsedSec >= DELAY_I && isFinite(iDisp)) {
      lufsI.textContent = formatLUFS(iDisp);
      lufsI.style.color = loudnessColor(iDisp);
    } else {
      lufsI.textContent = '--.- LUFS';
      lufsI.style.color = '';
    }
  }
  // LRA also needs accumulation time (same as I)
  if (lraEl) {
    if (elapsedSec >= DELAY_I && isFinite(readings.lra)) {
      lraEl.textContent = readings.lra.toFixed(1) + ' LU';
    } else {
      lraEl.textContent = '--.- LU';
    }
  }

  // True Peak - ONLY read cached state here, DO NOT update()
  // EXACT from audio-meters-grid.html: updateR128() reads tpPeakHoldL/R
  // that were SET by drawTruePeak() in renderLoop. No recalculation here.
  const tpState = truePeakMeter.getState();

  // Use peakHoldL/R (not smoothed left/right) for TPmax tracking
  // EXACT from original lines 3744-3746: const currentTpMax = Math.max(tpPeakHoldL, tpPeakHoldR);
  if (tpState.peakHoldL > tpMaxL) tpMaxL = tpState.peakHoldL;
  if (tpState.peakHoldR > tpMaxR) tpMaxR = tpState.peakHoldR;
  const tpMax = Math.max(tpMaxL, tpMaxR);

  // TPmax: cumulative max, show after 1s (like M)
  if (r128TpMax) {
    if (elapsedSec >= DELAY_M && isFinite(tpMax) && tpMax > -60) {
      r128TpMax.textContent = tpMax.toFixed(1) + ' dBTP';
    } else {
      r128TpMax.textContent = '--.- dBTP';
    }
  }

  // Crest factor: TP(dBTP) - RMS(dBFS) using 300ms smoothed values
  // Needs RMS to stabilize, show after 10s (like S)
  const currentTp = Math.max(tpState.left, tpState.right);
  const rmsDbL = 20 * Math.log10(rmsHoldL + 1e-12);
  const rmsDbR = 20 * Math.log10(rmsHoldR + 1e-12);
  const currentRms = Math.max(rmsDbL, rmsDbR);
  const crest = currentTp - currentRms;
  if (r128Crest) {
    if (elapsedSec >= DELAY_S && isFinite(crest) && currentTp > -60 && currentRms > -60) {
      r128Crest.textContent = crest.toFixed(1) + ' dB';
    } else {
      r128Crest.textContent = '--.- dB';
    }
  }

  // Peak LED
  if (peakLed) {
    peakLed.classList.toggle('on', tpMax > TP_LIMIT);
  }

  // Push to radar history (external as in original)
  if (isFinite(readings.shortTerm)) {
    const now = Date.now();
    const maxAge = radarMaxSeconds * 1000;
    // Remove old entries
    while (radarHistory.length > 0 && now - radarHistory[0].t > maxAge) {
      radarHistory.shift();
    }
    // Add new entry
    radarHistory.push({ t: now, v: readings.shortTerm });
  }

  // NOTE: peakIndicatorOn is updated in renderLoop (line ~1130) using CURRENT TP values
  // NOT here with cumulative max - EXACT from audio-meters-grid.html lines 3605-3612

  // Elapsed time
  const elapsed = performance.now() - startTs;
  if (r128Time) r128Time.textContent = formatTime(elapsed);
}

setInterval(measureLoop, MEASURE_INTERVAL_MS);

// ─────────────────────────────────────────────────────────────────────────────
// RENDER LOOP (60 Hz)
// ─────────────────────────────────────────────────────────────────────────────

// Peak-hold state for True Peak bar meter
let tpPeakHoldL = -60, tpPeakHoldR = -60, tpPeakTimeL = 0, tpPeakTimeR = 0;
const TP_PEAK_HOLD_SEC = 3;

// Peak-hold state for PPM bar meter
let ppmPeakHoldL = -60, ppmPeakHoldR = -60, ppmPeakTimeL = 0, ppmPeakTimeR = 0;
const PPM_PEAK_HOLD_SEC = 3;

// RMS smoothing
let rmsHoldL = 0, rmsHoldR = 0;
let lastRmsTs = performance.now();

// ═══════════════════════════════════════════════════════════════════════════
// DEBUG: Glitch detector - monitors for anomalies
// ═══════════════════════════════════════════════════════════════════════════
const GlitchDebug = {
  enabled: false,  // Disabled by default. Enable in console: GlitchDebug.enabled = true
  lastFrameTime: performance.now(),
  lastCorrelation: 1,
  lastRmsL: 0,
  lastRmsR: 0,
  frameCount: 0,
  startTime: performance.now(),
  glitchLog: [], // Store detected glitches

  analyze(bufL, bufR, frameTime) {
    if (!this.enabled) return;

    const frameDelta = frameTime - this.lastFrameTime;
    this.frameCount++;
    const elapsed = (frameTime - this.startTime) / 1000;

    // Calculate current frame metrics
    let sumL = 0, sumR = 0, sumLR = 0;
    let maxL = 0, maxR = 0;
    for (let i = 0; i < bufL.length; i++) {
      sumL += bufL[i] * bufL[i];
      sumR += bufR[i] * bufR[i];
      sumLR += bufL[i] * bufR[i];
      maxL = Math.max(maxL, Math.abs(bufL[i]));
      maxR = Math.max(maxR, Math.abs(bufR[i]));
    }
    const rmsL = Math.sqrt(sumL / bufL.length);
    const rmsR = Math.sqrt(sumR / bufR.length);
    const correlation = sumLR / (Math.sqrt(sumL * sumR) + 1e-10);

    // Only analyze when we have signal (not silence)
    const hasSignal = rmsL > 0.005 || rmsR > 0.005;

    const anomalies = [];

    // 1. Long frame (>100ms = definitely browser throttling)
    if (frameDelta > 100) {
      anomalies.push(`LONG_FRAME: ${frameDelta.toFixed(0)}ms`);
    }

    // Signal-dependent checks (only when generator is active)
    if (hasSignal) {
      // 2. Correlation drop (only if previous frame also had signal)
      if (this.lastRmsL > 0.01 && this.lastCorrelation > 0.9 && correlation < 0.5) {
        anomalies.push(`CORR_DROP: ${this.lastCorrelation.toFixed(2)} → ${correlation.toFixed(2)}`);
      }

      // 3. Sudden amplitude drop on one channel only
      if (this.lastRmsL > 0.01 && this.lastRmsR > 0.01) {
        const ratioL = rmsL / this.lastRmsL;
        const ratioR = rmsR / this.lastRmsR;
        if (ratioL < 0.5 && ratioR > 0.8) {
          anomalies.push(`L_DROP: ${this.lastRmsL.toFixed(4)} → ${rmsL.toFixed(4)}`);
        }
        if (ratioR < 0.5 && ratioL > 0.8) {
          anomalies.push(`R_DROP: ${this.lastRmsR.toFixed(4)} → ${rmsR.toFixed(4)}`);
        }
      }

      // 4. Channel imbalance
      const balance = rmsL / (rmsR + 1e-10);
      if (rmsL > 0.01 && rmsR > 0.01 && (balance < 0.7 || balance > 1.4)) {
        anomalies.push(`IMBALANCE: L/R=${balance.toFixed(2)}`);
      }

      // 5. Sample discontinuity - look for very large jumps (near full-scale)
      // This would indicate a true glitch, not normal audio
      let maxJump = 0, maxJumpIdx = 0;
      for (let i = 1; i < bufL.length; i++) {
        const jump = Math.abs(bufL[i] - bufL[i - 1]);
        if (jump > maxJump) { maxJump = jump; maxJumpIdx = i; }
      }
      // Flag only extreme discontinuities (>80% of full scale)
      if (maxJump > 0.8 && maxL > 0.1) {
        anomalies.push(`DISCONTINUITY: ${maxJump.toFixed(3)} @${maxJumpIdx}`);
      }
    }

    // Log if anomalies detected
    if (anomalies.length > 0) {
      this.glitchLog.push({ time: elapsed, anomalies: anomalies.join(' | ') });
      console.warn(
        `%c[GLITCH @${elapsed.toFixed(2)}s]%c ${anomalies.join(' | ')}`,
        'color: #ff6b6b; font-weight: bold',
        'color: #ffd93d'
      );
    }

    // Update state
    this.lastFrameTime = frameTime;
    this.lastCorrelation = hasSignal ? correlation : this.lastCorrelation;
    this.lastRmsL = rmsL;
    this.lastRmsR = rmsR;
  },

  reset() {
    this.startTime = performance.now();
    this.lastFrameTime = performance.now();
    this.frameCount = 0;
    this.lastCorrelation = 1;
    this.lastRmsL = 0;
    this.lastRmsR = 0;
    this.glitchLog = [];
    console.log('%c[GLITCH DEBUG] Reset - watching for anomalies...', 'color: #4ecdc4; font-weight: bold');
  },

  summary() {
    const longFrames = this.glitchLog.filter(g => g.anomalies.includes('LONG_FRAME')).length;
    const disc = this.glitchLog.filter(g => g.anomalies.includes('DISCONTINUITY')).length;
    console.log(`%c[SUMMARY] ${this.glitchLog.length} events: ${longFrames} long frames, ${disc} discontinuities`, 'color: #4ecdc4; font-weight: bold');
    return this.glitchLog;
  }
};

// Expose to window for console access
window.GlitchDebug = GlitchDebug;
console.log('%c[GLITCH DEBUG] Active - use GlitchDebug.reset() after starting generator', 'color: #4ecdc4; font-weight: bold');

function renderLoop() {
  const now = performance.now();

  // Layout
  layoutXY();
  layoutLoudness();

  // Sample analysers ONCE
  sampleAnalysers();

  // DEBUG: Analyze for glitches
  GlitchDebug.analyze(bufL, bufR, now);

  // Stereo analysis engine - update metrics from buffers
  if (stereoAnalysis) {
    stereoAnalysis.analyze(bufL, bufR);
  }

  // Goniometer - pass TransitionGuard.shouldRender() for blanking
  if (goniometer) {
    goniometer.draw(bufL, bufR, TransitionGuard.shouldRender());
  }

  // Correlation meter - pass TransitionGuard.shouldRender() for blanking
  if (correlationMeter) {
    correlationMeter.draw(bufL, bufR, TransitionGuard.shouldRender());
  }

  // Balance meter
  if (balanceMeterUI) {
    balanceMeterUI.draw(bufL, bufR);
  }

  // Spectrum analyzer
  if (spectrumAnalyzerUI) {
    spectrumAnalyzerUI.draw(xyCard, ac.sampleRate);
  }

  // M/S meter
  if (msMeterUI && stereoAnalysis) {
    msMeterUI.update(stereoAnalysis.getMidLevel(), stereoAnalysis.getSideLevel());
  }

  // Width meter
  if (widthMeterUI && stereoAnalysis) {
    widthMeterUI.draw(stereoAnalysis.getWidth(), stereoAnalysis.getWidthPeak());
  }

  // Rotation meter
  if (rotationMeterUI && stereoAnalysis) {
    rotationMeterUI.draw(stereoAnalysis.getRotation(), stereoAnalysis.getRotationHistory(), xyCard);
  }

  // Radar - render with history, momentary, maxSeconds, peakFlag (EXACT signature from original)
  if (radar) {
    const mVal = lufsM ? parseFloat(lufsM.dataset.v) : undefined;
    radar.render(radarHistory, isFinite(mVal) ? mVal : undefined, radarMaxSeconds, peakIndicatorOn);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PPM - MUST run BEFORE fresh buffer reads (uses sampleAnalysers() buffer)
  // EXACT order from audio-meters-grid.html: sampleAnalysers → updatePPM → ... → drawDBFS → drawTruePeak
  // ═══════════════════════════════════════════════════════════════════════════
  const nowSec = now / 1000;

  // PPM - EXACT from audio-meters-grid.html lines 2316-2360
  // Uses bufL/bufR from sampleAnalysers() - do NOT read fresh buffers here!
  ppmMeter.update(bufL, bufR);
  const ppmState = ppmMeter.getState();

  // Text display uses PPM values (dBu scale) - EXACT from audio-meters-grid.html lines 2357-2358
  if (ppmLVal) ppmLVal.textContent = ppmState.isSilentL ? '--.-' : formatDbu(ppmState.ppmL);
  if (ppmRVal) ppmRVal.textContent = ppmState.isSilentR ? '--.-' : formatDbu(ppmState.ppmR);

  // PPM peak-hold uses dBFS values (for bar drawing)
  if (ppmState.displayL > ppmPeakHoldL) {
    ppmPeakHoldL = ppmState.displayL;
    ppmPeakTimeL = nowSec;
  } else if (nowSec - ppmPeakTimeL > PPM_PEAK_HOLD_SEC) {
    ppmPeakHoldL = ppmState.displayL;
    ppmPeakTimeL = nowSec;
  }
  if (ppmState.displayR > ppmPeakHoldR) {
    ppmPeakHoldR = ppmState.displayR;
    ppmPeakTimeR = nowSec;
  } else if (nowSec - ppmPeakTimeR > PPM_PEAK_HOLD_SEC) {
    ppmPeakHoldR = ppmState.displayR;
    ppmPeakTimeR = nowSec;
  }

  // Draw PPM bar with dBFS values (-54 to -9 range)
  if (ppmCanvas) {
    drawHBar_PPM(ppmCanvas, ppmState.displayL, ppmState.displayR, ppmPeakHoldL, ppmPeakHoldR);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RMS/dBFS - uses SAME buffers sampled at start of frame
  // (previously re-sampled here causing potential timing issues)
  // ═══════════════════════════════════════════════════════════════════════════
  // Buffers already filled by sampleAnalysers() at frame start
  let rmsL = 0, rmsR = 0;
  for (let i = 0; i < bufL.length; i++) {
    rmsL += bufL[i] * bufL[i];
    rmsR += bufR[i] * bufR[i];
  }
  rmsL = Math.sqrt(rmsL / bufL.length);
  rmsR = Math.sqrt(rmsR / bufR.length);

  // Smoothing
  const dt = Math.max(0.001, (now - lastRmsTs) / 1000);
  lastRmsTs = now;
  const tau = 0.3;
  const a = 1 - Math.exp(-dt / tau);
  rmsHoldL += a * (rmsL - rmsHoldL);
  rmsHoldR += a * (rmsR - rmsHoldR);

  // EXACT from audio-meters-grid.html line 3554 - use + not ||
  const dbfsL = 20 * Math.log10(rmsHoldL + 1e-12);
  const dbfsR = 20 * Math.log10(rmsHoldR + 1e-12);

  // Show "--.-" if signal is below bottom of scale (-60 dBFS)
  const dbfsLStr = (dbfsL <= -59) ? '--.-' : formatDb(dbfsL, 1);
  const dbfsRStr = (dbfsR <= -59) ? '--.-' : formatDb(dbfsR, 1);
  if (dbL) dbL.textContent = dbfsLStr;
  if (dbR) dbR.textContent = dbfsRStr;

  // Draw dBFS bar
  if (dbfs) {
    drawHBar_DBFS(dbfs, dbfsL, dbfsR);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // True Peak - uses SAME buffers sampled at start of frame
  // (previously re-sampled here causing potential timing issues)
  // ═══════════════════════════════════════════════════════════════════════════
  // Buffers already filled by sampleAnalysers() at frame start
  truePeakMeter.update(bufL, bufR);
  const tpState = truePeakMeter.getState();
  if (tpL) tpL.textContent = formatDb(tpState.left, 1);
  if (tpR) tpR.textContent = formatDb(tpState.right, 1);

  // True Peak peak-hold
  if (tpState.left > tpPeakHoldL) {
    tpPeakHoldL = tpState.left;
    tpPeakTimeL = nowSec;
  } else if (nowSec - tpPeakTimeL > TP_PEAK_HOLD_SEC) {
    tpPeakHoldL = tpState.left;
    tpPeakTimeL = nowSec;
  }
  if (tpState.right > tpPeakHoldR) {
    tpPeakHoldR = tpState.right;
    tpPeakTimeR = nowSec;
  } else if (nowSec - tpPeakTimeR > TP_PEAK_HOLD_SEC) {
    tpPeakHoldR = tpState.right;
    tpPeakTimeR = nowSec;
  }

  // Peak indicator for radar - EXACT from audio-meters-grid.html lines 3605-3612
  const currentTruePeak = Math.max(tpState.left, tpState.right);
  if (currentTruePeak >= TP_LIMIT) {
    peakIndicatorOn = true;
    peakIndicatorLastTrigger = now;
  } else if (now - peakIndicatorLastTrigger > PEAK_INDICATOR_HOLD_MS) {
    peakIndicatorOn = false;
  }

  // Draw True Peak bar
  if (tp) {
    drawDiodeBar_TP(tp, tpState.left, tpState.right, tpPeakHoldL, tpPeakHoldR);
  }

  // Uptime
  const uptimeSec = (performance.now() - startTs) / 1000;
  const h = Math.floor(uptimeSec / 3600);
  const m = Math.floor((uptimeSec % 3600) / 60);
  const s = Math.floor(uptimeSec % 60);
  const ms = Math.floor((uptimeSec * 10) % 10);
  if (uptimeEl) uptimeEl.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ms}`;
  if (statusSummary) statusSummary.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

  requestAnimationFrame(renderLoop);
}

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
      tpMaxL = -Infinity;
      tpMaxR = -Infinity;
      tpPeakHoldL = -60;
      tpPeakHoldR = -60;
      ppmPeakHoldL = -60;
      ppmPeakHoldR = -60;
      rmsHoldL = 0;
      rmsHoldR = 0;
      startTs = performance.now();
      radarHistory = [];  // Clear radar history
      peakIndicatorOn = false;
      peakIndicatorLastTrigger = 0;
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

  // --- Browser Source Controls - EXACT from audio-meters-grid.html lines 3793-3831 ---
  if (btnSysMonMute) btnSysMonMute.onclick = toggleSysMonitorMute;

  if (sysMonGainEl) {
    sysMonGainEl.addEventListener('input', () => {
      if (sysMonVal) sysMonVal.value = Math.round(sysMonGainEl.value);
      if (sysMonGain && !sysMonitorMuted) {
        sysMonGain.gain.value = parseFloat(sysMonGainEl.value) / 100;
      }
    });
  }
  if (sysMonVal) {
    sysMonVal.addEventListener('change', e => {
      if (sysMonGainEl) sysMonGainEl.value = clamp(parseFloat(e.target.value) || 0, 0, 100);
      sysMonVal.value = Math.round(sysMonGainEl?.value || 0);
      if (sysMonGain && !sysMonitorMuted) {
        sysMonGain.gain.value = parseFloat(sysMonGainEl?.value || 0) / 100;
      }
    });
    sysMonVal.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        if (sysMonGainEl) sysMonGainEl.value = clamp(parseFloat(e.target.value) || 0, 0, 100);
        sysMonVal.value = Math.round(sysMonGainEl?.value || 0);
        if (sysMonGain && !sysMonitorMuted) {
          sysMonGain.gain.value = parseFloat(sysMonGainEl?.value || 0) / 100;
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

  // --- External Source Controls - EXACT from audio-meters-grid.html lines 4080-4200 ---
  if (btnExtMonMute) btnExtMonMute.onclick = toggleExtMonitorMute;

  if (extMonGainEl) {
    extMonGainEl.addEventListener('input', () => {
      if (extMonVal) extMonVal.value = Math.round(extMonGainEl.value);
      if (extMonGainNode && !extMonitorMuted) {
        extMonGainNode.gain.value = parseFloat(extMonGainEl.value) / 100;
      }
    });
  }
  if (extMonVal) {
    extMonVal.addEventListener('change', e => {
      if (extMonGainEl) extMonGainEl.value = clamp(parseFloat(e.target.value) || 0, 0, 100);
      extMonVal.value = Math.round(extMonGainEl?.value || 0);
      if (extMonGainNode && !extMonitorMuted) {
        extMonGainNode.gain.value = parseFloat(extMonGainEl?.value || 0) / 100;
      }
    });
    extMonVal.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        if (extMonGainEl) extMonGainEl.value = clamp(parseFloat(e.target.value) || 0, 0, 100);
        extMonVal.value = Math.round(extMonGainEl?.value || 0);
        if (extMonGainNode && !extMonitorMuted) {
          extMonGainNode.gain.value = parseFloat(extMonGainEl?.value || 0) / 100;
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
      if (radar) radar.setTarget(LOUDNESS_TARGET);
      // Reset R128 when target changes (like original resetR128)
      lufsMeter.reset();
      truePeakMeter.reset();
      tpMaxL = -Infinity;
      tpMaxR = -Infinity;
      tpPeakHoldL = -60;
      tpPeakHoldR = -60;
      ppmPeakHoldL = -60;
      ppmPeakHoldR = -60;
      rmsHoldL = 0;
      rmsHoldR = 0;
      startTs = performance.now();
      radarHistory = [];
      peakIndicatorOn = false;
      peakIndicatorLastTrigger = 0;
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
      setTpLimit(TP_LIMIT);
      updateTpLimitDisplay();
      // Reset TP over flag when limit changes
      peakIndicatorOn = false;
      peakIndicatorLastTrigger = 0;
    };
  }

  if (radarSweep) {
    radarSweep.onchange = () => {
      radarMaxSeconds = parseInt(radarSweep.value, 10);
      // Clear radar history when sweep time changes
      radarHistory = [];
    };
  }

  // Generator monitor controls - EXACT from audio-meters-grid.html lines 4374-4386
  function toggleGenMonitorMute() {
    if (!genMonGain) return;
    monitorMuted = !monitorMuted;
    genMonGain.gain.value = monitorMuted ? 0 : parseFloat(monGainEl.value) / 100;
    if (monVal) monVal.value = Math.round(monGainEl.value);
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
      if (genMonGain && !monitorMuted) {
        genMonGain.gain.value = parseFloat(monGainEl.value) / 100;
      }
    });
  }

  if (monVal) {
    monVal.addEventListener('change', e => {
      if (monGainEl) monGainEl.value = clamp(parseFloat(e.target.value) || 0, 0, 100);
      monVal.value = Math.round(monGainEl?.value || 0);
      if (genMonGain && !monitorMuted) {
        genMonGain.gain.value = parseFloat(monGainEl?.value || 0) / 100;
      }
    });
    monVal.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        if (monGainEl) monGainEl.value = clamp(parseFloat(e.target.value) || 0, 0, 100);
        monVal.value = Math.round(monGainEl?.value || 0);
        if (genMonGain && !monitorMuted) {
          genMonGain.gain.value = parseFloat(monGainEl?.value || 0) / 100;
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
// DRAG AND DROP SYSTEM - EXACT from audio-meters-grid.html lines 4506-4840
// ─────────────────────────────────────────────────────────────────────────────

// Drag state
let draggedElement = null;
let isDragging = false;
const dragOffset = { x: 0, y: 0 };

// ResizeObserver debouncer
const resizeDebouncer = new Map();

function scheduleLayoutUpdate(element, callback) {
  if (resizeDebouncer.has(element)) {
    cancelAnimationFrame(resizeDebouncer.get(element));
  }
  const rafId = requestAnimationFrame(() => {
    try {
      resizeDebouncer.delete(element);
      callback();
    } catch (error) {
      console.error('Layout update failed:', error);
      resizeDebouncer.delete(element);
    }
  });
  resizeDebouncer.set(element, rafId);
}

// Canvas state preservation for vectorscope
function preserveCanvasState() {
  if (!xy || !xy.width || !xy.height) {
    return () => {};
  }
  try {
    const ctx = xy.getContext('2d');
    const canvasState = {
      width: xy.width,
      height: xy.height,
      imageData: ctx.getImageData(0, 0, xy.width, xy.height)
    };
    return () => {
      try {
        if (xy.width === canvasState.width && xy.height === canvasState.height) {
          ctx.putImageData(canvasState.imageData, 0, 0);
        }
      } catch (error) {
        console.warn('Canvas restoration failed:', error);
      }
    };
  } catch (error) {
    return () => {};
  }
}

function initDragAndDrop() {
  const meterPanels = document.querySelectorAll('.meter');

  meterPanels.forEach(panel => {
    panel.addEventListener('mousedown', handleDragStart);
    panel.addEventListener('dragover', handleDragOver);
    panel.addEventListener('drop', handleDrop);
    panel.addEventListener('touchstart', handleTouchStart);
    panel.draggable = true;
    panel.addEventListener('dragstart', handleDragStartNative);
  });

  document.addEventListener('mousemove', handleDragMove);
  document.addEventListener('mouseup', handleDragEnd);
  document.addEventListener('touchmove', handleTouchMove);
  document.addEventListener('touchend', handleTouchEnd);
}

function handleDragStart(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  dragOffset.x = e.clientX - rect.left;
  dragOffset.y = e.clientY - rect.top;
  draggedElement = e.currentTarget;
}

function handleDragStartNative(e) {
  document.querySelectorAll('.meter.dragging').forEach(el => {
    el.classList.remove('dragging');
  });

  draggedElement = e.currentTarget;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/html', e.currentTarget.outerHTML);

  const restoreCanvas = preserveCanvasState();
  isDragLayoutFrozen = true;
  isDragging = true;

  setTimeout(() => {
    if (draggedElement) {
      draggedElement.classList.add('dragging');
      restoreCanvas();
    }
  }, 0);
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  document.querySelectorAll('.meter').forEach(el => {
    el.classList.remove('drag-over');
  });

  if (e.currentTarget !== draggedElement && e.currentTarget.classList.contains('meter')) {
    e.currentTarget.classList.add('drag-over');
  }
}

function handleDrop(e) {
  e.preventDefault();

  const dropTarget = e.currentTarget;
  dropTarget.classList.remove('drag-over');

  if (draggedElement && dropTarget !== draggedElement && dropTarget.classList.contains('meter')) {
    swapElements(draggedElement, dropTarget);
  }

  isDragLayoutFrozen = false;

  if (draggedElement) {
    draggedElement.classList.remove('dragging');
    draggedElement = null;
  }

  isDragging = false;

  document.querySelectorAll('.meter').forEach(el => {
    el.classList.remove('drag-over');
  });

  scheduleLayoutUpdate(xyCard, layoutXY);
}

function handleTouchStart(e) {
  const touch = e.touches[0];
  const rect = e.currentTarget.getBoundingClientRect();
  dragOffset.x = touch.clientX - rect.left;
  dragOffset.y = touch.clientY - rect.top;

  draggedElement = e.currentTarget;
  draggedElement.classList.add('dragging');
  isDragging = true;
  isDragLayoutFrozen = true;

  e.preventDefault();
}

function handleDragMove(e) {
  if (!draggedElement) return;

  const rect = draggedElement.getBoundingClientRect();
  const currentX = e.clientX;
  const currentY = e.clientY;
  const initialX = rect.left + dragOffset.x;
  const initialY = rect.top + dragOffset.y;

  const distance = Math.sqrt(
    Math.pow(currentX - initialX, 2) + Math.pow(currentY - initialY, 2)
  );

  if (distance > 5 && !isDragging) {
    isDragging = true;
    isDragLayoutFrozen = true;

    document.querySelectorAll('.meter.dragging').forEach(el => {
      if (el !== draggedElement) {
        el.classList.remove('dragging');
      }
    });

    draggedElement.classList.add('dragging');
  }
}

function handleTouchMove(e) {
  if (!isDragging || !draggedElement) return;

  const touch = e.touches[0];
  const elementUnderTouch = document.elementFromPoint(touch.clientX, touch.clientY);

  document.querySelectorAll('.meter').forEach(el => {
    el.classList.remove('drag-over');
  });

  if (elementUnderTouch && elementUnderTouch.classList.contains('meter') && elementUnderTouch !== draggedElement) {
    elementUnderTouch.classList.add('drag-over');
  }

  e.preventDefault();
}

function handleDragEnd(e) {
  if (draggedElement) {
    draggedElement.classList.remove('dragging');
  }

  draggedElement = null;
  isDragging = false;
  isDragLayoutFrozen = false;
  scheduleLayoutUpdate(xyCard, layoutXY);
}

function handleTouchEnd(e) {
  if (!isDragging || !draggedElement) return;

  const touch = e.changedTouches[0];
  const elementUnderTouch = document.elementFromPoint(touch.clientX, touch.clientY);

  if (elementUnderTouch && elementUnderTouch.classList.contains('meter') && elementUnderTouch !== draggedElement) {
    swapElements(draggedElement, elementUnderTouch);
  }

  draggedElement.classList.remove('dragging');
  document.querySelectorAll('.meter').forEach(el => {
    el.classList.remove('drag-over');
  });

  draggedElement = null;
  isDragging = false;
  isDragLayoutFrozen = false;
  scheduleLayoutUpdate(xyCard, layoutXY);
}

function swapElements(el1, el2) {
  el1.classList.add('transitioning');
  el2.classList.add('transitioning');

  const temp = document.createElement('div');
  temp.style.display = 'none';

  el1.parentNode.insertBefore(temp, el1);
  el2.parentNode.insertBefore(el1, el2);
  temp.parentNode.insertBefore(el2, temp);
  temp.remove();

  setTimeout(() => {
    el1.classList.remove('transitioning');
    el2.classList.remove('transitioning');
  }, 400);
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
  initDragAndDrop();

  // Start render loop
  requestAnimationFrame(renderLoop);

  console.log('[Bootstrap] Initialization complete');
}

// Run on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
