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
 * BAR METER DRAWING – RTW GASPLASMA VISUAL FORM
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Contains horizontal bar meter drawing functions with authentic RTW-style
 * "segmented strip" form language:
 *
 * - drawHBar_DBFS: Digital RMS level (-60 to 0 dBFS)
 * - drawDiodeBar_TP: True Peak LED bar (-60 to +3 dBTP)
 * - drawHBar_Nordic_PPM: Nordic PPM bar (-58 to 0 dBFS / -40 to +18 PPM)
 * - drawHBar_BBC_PPM: BBC PPM Type IIa (-30 to -6 dBFS / PPM 1-7)
 *
 * VISUAL FORM PRINCIPLES (RTW gasplasma / early LED bargraph):
 * ─────────────────────────────────────────────────────────────
 * - Segments ALWAYS visible, even when OFF ("light behind milky plastic")
 * - Slender rectangular strips, consistent geometry
 * - Proportional segment/gap ratio: ~68% segment, ~32% gap
 * - ON state: crisp, solid, hard edges
 * - OFF state: low luminance, same geometry, visible silhouette
 * - Peak/hold: same size, increased luminance, very subtle tight glow
 *
 * @module ui/bar-meter
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  RESOLUTION_PROFILE_DBFS,
  RESOLUTION_PROFILE_TP,
  RESOLUTION_PROFILE_PPM_EXTENDED,
  RESOLUTION_PROFILE_BBC_PPM,
  RESOLUTION_PROFILE_SAMPLE_PEAK,
  getResolutionMultiplier
} from './resolution-zones.js';

// ─────────────────────────────────────────────────────────────────────────────
// RTW VISUAL FORM CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Segment-to-total ratio (segment width as fraction of cell width)
 * RTW-style: ~65-70% segment, ~30-35% gap
 */
const SEGMENT_RATIO = 0.68;

/**
 * OFF-state alpha (visible silhouette, "milky plastic" backlight effect)
 * Higher than typical UI dim (0.14) for always-visible segments
 */
const ALPHA_OFF = 0.22;

/**
 * ON-state alpha (crisp, solid, decisive)
 */
const ALPHA_ON = 0.92;

/**
 * Peak/hold glow blur radius multiplier (subtle, tight glow)
 */
const PEAK_GLOW_MULT = 2.5;

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT PROPORTIONS (stereo bar positioning)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bar height as fraction of canvas height.
 * 12% gives a slender strip with room for two channels plus scale.
 */
const BAR_HEIGHT_RATIO = 0.12;

/**
 * Left/top channel Y position as fraction of canvas height.
 * 35% positions the first bar in the upper third.
 */
const CHANNEL_L_Y_RATIO = 0.35;

/**
 * Right/bottom channel Y position as fraction of canvas height.
 * 55% positions the second bar below the first with visual balance.
 */
const CHANNEL_R_Y_RATIO = 0.55;

/**
 * Scale marker vertical position (start) as fraction of canvas height.
 * Used for reference marks (e.g., 0 dB line on True Peak).
 */
const SCALE_MARKER_Y_RATIO = 0.25;

/**
 * Scale marker height as fraction of canvas height.
 * Spans from 25% to 75% of canvas (0.5 = 50% height).
 */
const SCALE_MARKER_HEIGHT_RATIO = 0.5;

// ─────────────────────────────────────────────────────────────────────────────
// BARGRAPH PANEL MARGINS
// ─────────────────────────────────────────────────────────────────────────────

/** Horizontal margin for bargraph LED bars (0.03 = 3%) */
const BARGRAPH_H_MARGIN = 0.03;

/** Vertical margin for bargraph LED bars (0.03 = 3%) */
const BARGRAPH_V_MARGIN = 0.03;

// ─────────────────────────────────────────────────────────────────────────────
// SCALE LABEL POSITIONING (all five meters)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gap between tick marks and labels ABOVE (in % of panel height).
 * Positive = labels further above tick marks.
 */
const SCALE_LABEL_ABOVE_GAP = 3;

/**
 * Gap between tick marks and labels BELOW (in % of panel height).
 * Positive = labels further below tick marks.
 */
const SCALE_LABEL_BELOW_GAP = 3;

/**
 * Extra offset for larger tags below (PML, CLIP markers).
 */
const SCALE_LABEL_BELOW_GAP_LG = 3;

/**
 * Get vertical layout for scale elements in bargraph panels.
 * @param {HTMLElement} el - Element to check context
 * @returns {{top: string, height: string, labelBottom: string, tagTop: string, tagTopLg: string}}
 */
function getScaleVerticalLayout(el) {
  if (el && el.closest('.bargraph-panel')) {
    const vPct = BARGRAPH_V_MARGIN * 100;
    const drawableH = 100 - 2 * vPct;
    const tickTop = vPct + drawableH * 0.25;
    const tickBottom = tickTop + drawableH * 0.5;
    return {
      top: `${tickTop}%`,
      height: `${drawableH * 0.5}%`,
      labelBottom: `${100 - tickTop + SCALE_LABEL_ABOVE_GAP}%`,
      tagTop: `${tickBottom + SCALE_LABEL_BELOW_GAP}%`,
      tagTopLg: `${tickBottom + SCALE_LABEL_BELOW_GAP_LG}%`
    };
  }
  // Fallback for non-panel contexts
  const tickTop = 25;
  const tickBottom = 75;
  return {
    top: '25%',
    height: '50%',
    labelBottom: `${100 - tickTop + SCALE_LABEL_ABOVE_GAP}%`,
    tagTop: `${tickBottom + SCALE_LABEL_BELOW_GAP}%`,
    tagTopLg: `${tickBottom + SCALE_LABEL_BELOW_GAP_LG}%`
  };
}

// Get CSS custom property value
function getCss(v) {
  return getComputedStyle(document.documentElement).getPropertyValue(v).trim();
}

/**
 * Get bar inset ratio from CSS custom property.
 * Single source of truth: --bar-inset in CSS defines edge padding.
 * Bargraph panels use 5% margin for LED bar content.
 * @param {HTMLElement} [el] - Optional element to check context
 * @returns {number} Inset as decimal (e.g., 0.05 for 5%)
 */
function getBarInset(el) {
  if (el && el.closest('.bargraph-panel')) {
    return BARGRAPH_H_MARGIN;
  }
  const val = getCss('--bar-inset');
  return parseFloat(val) / 100 || 0;
}

/**
 * Get vertical inset ratio for bargraph panels.
 * @param {HTMLElement} [el] - Element to check context
 * @returns {number} Vertical inset as decimal (0.01 for 1%)
 */
function getVerticalInset(el) {
  if (el && el.closest('.bargraph-panel')) {
    return BARGRAPH_V_MARGIN;
  }
  return 0;
}

/**
 * Create position calculator with inset applied.
 * Maps dB value to canvas x-coordinate, respecting edge padding.
 * @param {number} dbMin - Minimum dB value
 * @param {number} dbMax - Maximum dB value
 * @param {number} canvasWidth - Canvas width in pixels
 * @param {HTMLElement} [el] - Optional element for context-aware inset
 * @returns {Function} xFromDb(db) → pixel x-coordinate
 */
function createXFromDb(dbMin, dbMax, canvasWidth, el) {
  const inset = getBarInset(el);
  const startX = canvasWidth * inset;
  const drawableWidth = canvasWidth * (1 - 2 * inset);
  const dbSpan = dbMax - dbMin;

  return function xFromDb(db) {
    const c = Math.max(dbMin, Math.min(dbMax, db));
    return startX + (c - dbMin) / dbSpan * drawableWidth;
  };
}

/**
 * Create percentage position calculator for scale layouts.
 * Maps dB value to percentage position (0-100%), respecting edge inset.
 * @param {number} dbMin - Minimum dB value
 * @param {number} dbMax - Maximum dB value
 * @param {HTMLElement} [el] - Optional element for context-aware inset
 * @returns {Function} xPercent(db) → percentage (0-100)
 */
function createXPercent(dbMin, dbMax, el) {
  const insetPct = (el && el.closest('.bargraph-panel')) ? BARGRAPH_H_MARGIN * 100 : (parseFloat(getCss('--bar-inset')) || 0);
  const usableSpan = 100 - 2 * insetPct;
  const dbSpan = dbMax - dbMin;

  return function xPercent(db) {
    const c = Math.max(dbMin, Math.min(dbMax, db));
    return insetPct + (c - dbMin) / dbSpan * usableSpan;
  };
}

/**
 * Format a number for centered display where the sign (+/-) doesn't affect centering.
 * The sign is positioned absolutely to the left of the digits.
 * @param {number|string} val - The value to format
 * @returns {string} HTML string with sign positioned outside centered digits
 */
function formatCenteredNumber(val) {
  const str = String(val);
  const match = str.match(/^([+\-−])?(.*)$/);
  if (!match) return str;
  const sign = match[1] || '';
  const digits = match[2];
  if (!sign) return digits;
  // Sign positioned absolutely to the left of the digits
  return `<span style="position:relative;display:inline-block"><span style="position:absolute;right:100%">${sign}</span>${digits}</span>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// RMS dBFS BAR METER (-60 to 0 dBFS)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Draw RMS/dBFS horizontal bar meter with RTW visual form.
 * Range: -60 to 0 dBFS, base step 0.5 dB
 */
export function drawHBar_DBFS(canvas, valueL, valueR) {
  const dpr = window.devicePixelRatio || 1;
  // Use clientWidth/clientHeight to exclude border from dimensions
  const w = Math.floor(canvas.clientWidth * dpr), h = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');

  // Range constants
  const dbMin = -60, dbMax = 0, dbSpan = dbMax - dbMin;
  const baseStep = 0.5;

  // Vertical inset for bargraph panels
  const vInset = getVerticalInset(canvas);
  const startY = h * vInset;
  const drawableH = h * (1 - 2 * vInset);
  const barH = Math.round(drawableH * BAR_HEIGHT_RATIO);

  // Position calculation with inset from CSS
  const xFromDb = createXFromDb(dbMin, dbMax, w, canvas);

  // Clear canvas with dark background
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0e151a';
  ctx.fillRect(0, 0, w, h);

  // Colour: Cyan/blue for RMS (distinct from peak meters)
  // Industry convention: cool colours for integrated/RMS, warm for peak
  function segColour() {
    return '#00aacc';  // Cyan - visual separation from amber peak meters
  }

  // Draw a single channel with RTW segment form
  function drawChannel(yTop, val) {
    const displayVal = Math.max(dbMin, Math.min(dbMax, val));
    const col = segColour();

    // Draw segments for each base step with sub-resolution
    for (let d = dbMin; d < dbMax; d += baseStep) {
      const mult = getResolutionMultiplier(d, RESOLUTION_PROFILE_DBFS);
      const subStep = baseStep / mult;
      const x0Base = xFromDb(d);
      const x1Base = xFromDb(d + baseStep);
      const baseWidth = x1Base - x0Base;

      if (baseWidth <= 1) continue;

      // Calculate sub-segment dimensions with RTW proportions
      const subCellWidth = baseWidth / mult;
      const segmentWidth = Math.max(1, subCellWidth * SEGMENT_RATIO);
      const gapWidth = subCellWidth - segmentWidth;

      for (let sub = 0; sub < mult; sub++) {
        const subDb = d + sub * subStep;
        const subX = x0Base + sub * subCellWidth;

        // OFF state: always visible silhouette ("milky plastic" backlight)
        ctx.globalAlpha = ALPHA_OFF;
        ctx.fillStyle = col;
        ctx.fillRect(subX, yTop, segmentWidth, barH);

        // ON state: crisp, solid segment
        if (subDb < displayVal) {
          ctx.globalAlpha = ALPHA_ON;
          ctx.fillStyle = col;
          ctx.fillRect(subX, yTop, segmentWidth, barH);
        }
      }
    }
  }

  drawChannel(startY + drawableH * CHANNEL_L_Y_RATIO, valueL);
  drawChannel(startY + drawableH * CHANNEL_R_Y_RATIO, valueR);

  // ─────────────────────────────────────────────────────────────────────────
  // Scale Limit Fence (0 dBFS)
  // ─────────────────────────────────────────────────────────────────────────
  // Vertical marker at digital full scale (0 dBFS). In digital systems,
  // 0 dBFS represents the maximum representable sample value; exceeding
  // this causes hard clipping. The fence provides a visual boundary at the
  // Permitted Maximum Level (PML) per EBU R 128 operational practice.
  // Currently disabled as scale markings provide sufficient indication.
  // ─────────────────────────────────────────────────────────────────────────
  // const fenceX = xFromDb(dbMax);
  // ctx.globalAlpha = 1;
  // ctx.fillStyle = '#2a3642';
  // ctx.fillRect(Math.round(fenceX) - 1, 0, 2, h);
}

// ─────────────────────────────────────────────────────────────────────────────
// TRUE PEAK LED BAR (-60 to +3 dBTP)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Draw True Peak LED-style bar meter with RTW visual form.
 * Range: -60 to +3 dBTP (126 base cells at 0.5 dB resolution)
 * EBU R128 / ITU BS.1770-4 compliant
 */
export function drawDiodeBar_TP(canvas, valueL, valueR, peakHoldL, peakHoldR) {
  const dpr = window.devicePixelRatio || 1;
  // Use clientWidth/clientHeight to exclude border from dimensions
  const w = Math.floor(canvas.clientWidth * dpr), h = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');

  // Range constants
  const dbMin = -60, dbMax = 3, dbSpan = dbMax - dbMin; // 63 dB
  const baseStep = 0.5;

  // Vertical inset for bargraph panels
  const vInset = getVerticalInset(canvas);
  const startY = h * vInset;
  const drawableH = h * (1 - 2 * vInset);
  const barH = Math.round(drawableH * BAR_HEIGHT_RATIO);

  // Clear canvas with dark background
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0e151a';
  ctx.fillRect(0, 0, w, h);

  // Position calculation with inset from CSS
  const xFromDb = createXFromDb(dbMin, dbMax, w, canvas);

  // Colour zones (unchanged from original)
  function segColour(db) {
    if (db >= 0) return '#ff2020';   // Above 0 dBTP: aggressive bright red
    if (db >= -1) return getCss('--hot');
    if (db >= -3) return getCss('--caution');
    if (db >= -6) return getCss('--warn');
    return getCss('--ok');
  }

  // Draw a single channel with RTW segment form
  function drawChannel(yTop, val, peakHold) {
    const displayDb = Math.max(dbMin, Math.min(dbMax, val));
    const peakDbRaw = (peakHold !== undefined) ? peakHold : dbMin - 1;
    const peakDb = Math.max(dbMin, Math.min(dbMax, peakDbRaw));

    // Track peak-hold position for drawing
    let peakSubX = -1;
    let peakSegmentWidth = 0;
    let peakSubDb = dbMin;

    // Draw segments for each base step with sub-resolution
    for (let d = dbMin; d < dbMax; d += baseStep) {
      const mult = getResolutionMultiplier(d, RESOLUTION_PROFILE_TP);
      const subStep = baseStep / mult;
      const x0Base = xFromDb(d);
      const x1Base = xFromDb(d + baseStep);
      const baseWidth = x1Base - x0Base;

      if (baseWidth <= 1) continue;

      // Calculate sub-segment dimensions with RTW proportions
      const subCellWidth = baseWidth / mult;
      const segmentWidth = Math.max(1, subCellWidth * SEGMENT_RATIO);

      for (let sub = 0; sub < mult; sub++) {
        const subDb = d + sub * subStep;
        const subX = x0Base + sub * subCellWidth;
        const col = segColour(subDb + subStep / 2); // Colour at sub-cell centre

        // Check if this sub-cell contains the peak-hold position
        if (peakDb >= subDb && peakDb < subDb + subStep) {
          peakSubX = subX;
          peakSegmentWidth = segmentWidth;
          peakSubDb = subDb;
        }

        // OFF state: always visible silhouette
        ctx.globalAlpha = ALPHA_OFF;
        ctx.fillStyle = col;
        ctx.fillRect(subX, yTop, segmentWidth, barH);

        // ON state: crisp, solid segment
        if (subDb < displayDb) {
          // Extra intensity for cells above 0 dBTP
          if (subDb >= 0) {
            ctx.globalAlpha = 1.0;
            ctx.shadowColor = '#ff2020';
            ctx.shadowBlur = PEAK_GLOW_MULT * dpr;
          } else {
            ctx.globalAlpha = ALPHA_ON;
            ctx.shadowBlur = 0;
          }
          ctx.fillStyle = col;
          ctx.fillRect(subX, yTop, segmentWidth, barH);
          ctx.shadowBlur = 0;
        }
      }
    }

    // Peak-hold segment: same geometry, increased luminance, subtle tight glow
    if (peakSubX >= 0 && peakHold > dbMin) {
      const pCol = segColour(peakSubDb + 0.25);
      ctx.globalAlpha = 1;
      ctx.shadowColor = pCol;
      ctx.shadowBlur = (peakSubDb >= 0) ? PEAK_GLOW_MULT * 1.5 * dpr : PEAK_GLOW_MULT * dpr;
      ctx.fillStyle = pCol;
      ctx.fillRect(peakSubX, yTop, peakSegmentWidth, barH);
      ctx.shadowBlur = 0;
    }
  }

  drawChannel(startY + drawableH * CHANNEL_L_Y_RATIO, valueL, peakHoldL);
  drawChannel(startY + drawableH * CHANNEL_R_Y_RATIO, valueR, peakHoldR);

  // 0 dBTP fence (red line, positioned with inset)
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = getCss('--hot');
  const zeroX = xFromDb(0);
  ctx.fillRect(Math.round(zeroX) - 1, startY + drawableH * SCALE_MARKER_Y_RATIO, 2, drawableH * SCALE_MARKER_HEIGHT_RATIO);
}

// ─────────────────────────────────────────────────────────────────────────────
// NORDIC PPM BAR – NTP 177-800 STYLE WITH COMPRESSED OVERLOAD DISPLAY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply Nordic PPM display compression to dBFS value.
 * Compresses the overload zone (+6 to +18 PPM) to fit traditional +6 to +12 display.
 *
 * Math (EBU R68): PPM = dBFS + 18
 * Compression: +6 to +18 PPM (real) → +6 to +12 PPM (display)
 *
 * @param {number} dbfs - Real dBFS value
 * @returns {number} Display-compressed dBFS value
 */
function compressNordicDisplay(dbfs) {
  const realPpm = dbfs + 18;
  if (realPpm <= 6) {
    return dbfs; // Linear below +6 PPM
  }
  // Compress: +6...+18 PPM (12 dB) → +6...+12 PPM (6 dB display)
  const overAmount = realPpm - 6;
  const displayPpm = 6 + overAmount * 0.5;
  return displayPpm - 18; // Convert back to dBFS
}

/**
 * Draw Nordic PPM horizontal bar meter simulating NTP 177-800.
 *
 * NTP 177-800 SPECIFICATIONS:
 *   - 208 uniform LEDs per channel (0.25 PPM per LED on display scale)
 *   - Real range: -40 to +18 PPM = -58 to 0 dBFS (EBU R68)
 *   - Display range: -40 to +12 PPM (compressed overload zone)
 *   - Overload indicator: two red lines above/below bars from +6 to +12 display
 *
 * DISPLAY COMPRESSION (above +6 PPM):
 *   Real +6 PPM  (-12 dBFS) → Display +6
 *   Real +9 PPM  (-9 dBFS)  → Display +7.5 (PML)
 *   Real +12 PPM (-6 dBFS)  → Display +9
 *   Real +18 PPM (0 dBFS)   → Display +12 (clip)
 *
 * COLOR ZONES (based on DISPLAY PPM):
 *   -40 to 0 (TEST): Amber
 *   0 to +6: Amber with bloom/glow effect
 *   +6 to +12: Red with bloom/glow effect
 */
export function drawHBar_Nordic_PPM(canvas, dBfsL, dBfsR, peakHoldL, peakHoldR) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.floor(canvas.clientWidth * dpr), h = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');

  // Display scale: -40 to +12 PPM = -58 to -6 dBFS (display)
  // 52 PPM display range = 208 LEDs at 0.25 PPM per LED
  const dbMinDisplay = -58;  // -40 PPM display
  const dbMaxDisplay = -6;   // +12 PPM display
  const LED_COUNT = 208;
  const dbPerLed = (dbMaxDisplay - dbMinDisplay) / LED_COUNT; // 0.25 dB per LED

  // Apply compression to input values
  const displayL = compressNordicDisplay(dBfsL);
  const displayR = compressNordicDisplay(dBfsR);
  const displayPeakL = peakHoldL !== undefined ? compressNordicDisplay(peakHoldL) : dbMinDisplay - 1;
  const displayPeakR = peakHoldR !== undefined ? compressNordicDisplay(peakHoldR) : dbMinDisplay - 1;

  // Vertical inset for bargraph panels
  const vInset = getVerticalInset(canvas);
  const startY = h * vInset;
  const drawableH = h * (1 - 2 * vInset);
  const barH = Math.round(drawableH * BAR_HEIGHT_RATIO);

  // Horizontal inset
  const hInset = getBarInset(canvas);
  const barStartX = w * hInset;
  const barWidth = w * (1 - 2 * hInset);

  // Uniform LED dimensions
  const cellWidth = barWidth / LED_COUNT;
  const segWidth = Math.max(1, cellWidth * SEGMENT_RATIO);

  // Clear canvas
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0e151a';
  ctx.fillRect(0, 0, w, h);

  // Colours
  const amberColor = getCss('--caution');
  const redColor = getCss('--hot');

  // Colour based on display PPM (threshold at +6 display = -12 dBFS display)
  function segColour(displayDb) {
    const displayPpm = displayDb + 18;
    return (displayPpm >= 6) ? redColor : amberColor;
  }

  // Draw a single channel
  function drawChannel(yTop, val, peakHold) {
    const displayVal = Math.max(dbMinDisplay, Math.min(dbMaxDisplay, val));
    const peakDb = Math.max(dbMinDisplay, Math.min(dbMaxDisplay, peakHold));

    let peakSegX = -1, peakSegW = 0, peakSegDb = dbMinDisplay;

    // Draw 208 uniform LED segments
    for (let i = 0; i < LED_COUNT; i++) {
      const segDb = dbMinDisplay + i * dbPerLed;
      const segX = barStartX + i * cellWidth;
      const col = segColour(segDb);
      const displayPpm = segDb + 18;

      if (peakDb >= segDb && peakDb < segDb + dbPerLed) {
        peakSegX = segX;
        peakSegW = segWidth;
        peakSegDb = segDb;
      }

      // OFF state: visible silhouette
      ctx.globalAlpha = ALPHA_OFF;
      ctx.fillStyle = col;
      ctx.fillRect(segX, yTop, segWidth, barH);

      // ON state
      if (displayVal > segDb) {
        // Bloom for amber LEDs between TEST (0) and +6 PPM display
        if (displayPpm >= 0 && displayPpm < 6) {
          ctx.save();
          ctx.shadowColor = col;
          ctx.shadowBlur = 8 * dpr;
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = col;
          ctx.fillRect(segX - 1, yTop - 1, segWidth + 2, barH + 2);
          ctx.restore();
        }
        // Bloom for RED LEDs from +6 to +12 PPM display
        if (displayPpm >= 6) {
          ctx.save();
          ctx.shadowColor = col;
          ctx.shadowBlur = 10 * dpr;
          ctx.globalAlpha = 0.6;
          ctx.fillStyle = col;
          ctx.fillRect(segX - 1, yTop - 1, segWidth + 2, barH + 2);
          ctx.restore();
        }
        ctx.globalAlpha = ALPHA_ON;
        ctx.fillStyle = col;
        ctx.fillRect(segX, yTop, segWidth, barH);
      }
    }

    // Peak-hold marker with glow
    if (peakSegX >= 0 && peakHold > dbMinDisplay) {
      const peakCol = segColour(peakSegDb);
      const peakDisplayPpm = peakSegDb + 18;
      ctx.globalAlpha = 1;
      ctx.shadowColor = peakCol;
      // Stronger glow for red zone peaks
      ctx.shadowBlur = (peakDisplayPpm >= 6) ? PEAK_GLOW_MULT * 1.5 * dpr : PEAK_GLOW_MULT * dpr;
      ctx.fillStyle = peakCol;
      ctx.fillRect(peakSegX, yTop, peakSegW, barH);
      ctx.shadowBlur = 0;
    }

    return yTop;
  }

  const yL = startY + drawableH * CHANNEL_L_Y_RATIO;
  const yR = startY + drawableH * CHANNEL_R_Y_RATIO;

  drawChannel(yL, displayL, displayPeakL);
  drawChannel(yR, displayR, displayPeakR);

  // ─────────────────────────────────────────────────────────────────────────
  // NTP 177-800 OVERLOAD INDICATOR (+6 to +12 PPM display)
  // Two parallel red lines: one above L bar, one below R bar
  // Subtle 3D effect: darker at edges, slightly lighter in middle
  // +6 PPM display = -12 dBFS display
  // ─────────────────────────────────────────────────────────────────────────
  const overloadLineH = Math.round(barH / 3);
  const gap = Math.max(2, Math.round(barH * 0.35));
  const overloadStartDb = -12; // +6 PPM display
  const overloadStartX = barStartX + ((overloadStartDb - dbMinDisplay) / (dbMaxDisplay - dbMinDisplay)) * barWidth;
  const overloadWidth = barStartX + barWidth - overloadStartX;

  ctx.globalAlpha = 0.85;

  // Dark red with subtle 3D gradient (darker edges, lighter middle)
  const darkRed = '#8a1a1a';
  const midRed = '#a82828';

  // Helper to draw overload line with vertical 3D gradient
  function drawOverloadLine(y) {
    const grad = ctx.createLinearGradient(0, y, 0, y + overloadLineH);
    grad.addColorStop(0, darkRed);
    grad.addColorStop(0.5, midRed);
    grad.addColorStop(1, darkRed);
    ctx.fillStyle = grad;
    ctx.fillRect(overloadStartX, y, overloadWidth, overloadLineH);
  }

  // One line above L channel, one line below R channel
  drawOverloadLine(yL - gap - overloadLineH);
  drawOverloadLine(yR + barH + gap);
}

// ─────────────────────────────────────────────────────────────────────────────
// BBC PPM TYPE IIa BAR (-30 to -6 dBFS / PPM 1-7)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Draw BBC PPM Type IIa horizontal bar meter with RTW visual form.
 * Scale: PPM 1 to 7 (4 dB per division), mapped to -30 to -6 dBFS
 * Purist monochrome design per BBC/EBU visual principles (no traffic-light colours)
 * TEST at PPM 4 (-18 dBFS), PML at PPM 6 (-10 dBFS)
 * IEC 60268-10 Type IIa ballistics (10ms attack, 2.8s return)
 */
export function drawHBar_BBC_PPM(canvas, dBfsL, dBfsR, peakHoldL, peakHoldR) {
  const dpr = window.devicePixelRatio || 1;
  // Use clientWidth/clientHeight to exclude border from dimensions
  const w = Math.floor(canvas.clientWidth * dpr), h = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');

  // Range constants: PPM 1 = -30 dBFS, PPM 7 = -6 dBFS (24 dB span)
  const dbMin = -30, dbMax = -6, dbSpan = dbMax - dbMin;
  const baseStep = 0.5;

  // Vertical inset for bargraph panels
  const vInset = getVerticalInset(canvas);
  const startY = h * vInset;
  const drawableH = h * (1 - 2 * vInset);
  const barH = Math.round(drawableH * BAR_HEIGHT_RATIO);

  // Position calculation with inset from CSS
  const xFromDb = createXFromDb(dbMin, dbMax, w, canvas);

  // Clear canvas with dark background
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0e151a';
  ctx.fillRect(0, 0, w, h);

  // BBC PPM purist colour: monochrome white/grey, no traffic-light zoning
  // Per BBC/EBU visual design principles: high contrast, neutral presentation
  // PPM 6 (-10 dBFS) is PML - segments above get subtle emphasis
  const segColour = '#e8e8e8';      // Off-white for authentic CRT/LED appearance
  const segColourPml = '#ffffff';   // Brighter white above PPM 6 (PML)
  const pmlThreshold = -10;         // PPM 6 = -10 dBFS (Permitted Maximum Level)

  // Draw a single channel with RTW segment form
  function drawChannel(yTop, val, peakHold) {
    const displayVal = Math.max(dbMin, Math.min(dbMax, val));
    const peakDbRaw = (peakHold !== undefined) ? peakHold : dbMin - 1;
    const peakDb = Math.max(dbMin, Math.min(dbMax, peakDbRaw));

    // Track peak-hold position for drawing
    let peakSubX = -1;
    let peakSegmentWidth = 0;

    // Draw segments for each base step with sub-resolution
    for (let d = dbMin; d < dbMax; d += baseStep) {
      const mult = getResolutionMultiplier(d, RESOLUTION_PROFILE_BBC_PPM);
      const subStep = baseStep / mult;
      const x0Base = xFromDb(d);
      const x1Base = xFromDb(d + baseStep);
      const baseWidth = x1Base - x0Base;

      if (baseWidth <= 1) continue;

      // Calculate sub-segment dimensions - BBC PPM uses slimmer segments
      const subCellWidth = baseWidth / mult;
      const segmentWidth = Math.max(1, subCellWidth * 0.5);  // Slimmer than default 0.68

      for (let sub = 0; sub < mult; sub++) {
        const subDb = d + sub * subStep;
        const subX = x0Base + sub * subCellWidth;
        const isAbovePml = subDb >= pmlThreshold;
        const col = isAbovePml ? segColourPml : segColour;

        // Check if this sub-cell contains the peak-hold position
        if (peakDb >= subDb && peakDb < subDb + subStep) {
          peakSubX = subX;
          peakSegmentWidth = segmentWidth;
        }

        // OFF state: always visible silhouette
        ctx.globalAlpha = ALPHA_OFF;
        ctx.fillStyle = col;
        ctx.fillRect(subX, yTop, segmentWidth, barH);

        // ON state: crisp, solid segment
        if (subDb < displayVal) {
          ctx.globalAlpha = ALPHA_ON;
          ctx.fillStyle = col;
          ctx.fillRect(subX, yTop, segmentWidth, barH);

          // Subtle glow for segments above PML (PPM 6)
          if (isAbovePml) {
            ctx.shadowColor = segColourPml;
            ctx.shadowBlur = PEAK_GLOW_MULT * 0.8 * dpr;
            ctx.fillRect(subX, yTop, segmentWidth, barH);
            ctx.shadowBlur = 0;
          }
        }
      }
    }

    // Peak-hold marker (RTW-style: same geometry, increased luminance, subtle glow)
    if (peakSubX >= 0 && peakHold > dbMin) {
      ctx.globalAlpha = 1;
      ctx.shadowColor = segColour;
      ctx.shadowBlur = PEAK_GLOW_MULT * dpr;
      ctx.fillStyle = segColour;
      ctx.fillRect(peakSubX, yTop, peakSegmentWidth, barH);
      ctx.shadowBlur = 0;
    }
  }

  drawChannel(startY + drawableH * CHANNEL_L_Y_RATIO, dBfsL, peakHoldL);
  drawChannel(startY + drawableH * CHANNEL_R_Y_RATIO, dBfsR, peakHoldR);

  // ─────────────────────────────────────────────────────────────────────────
  // Scale Limit Fence (PPM 7 / −6 dBFS)
  // ─────────────────────────────────────────────────────────────────────────
  // Vertical marker at the BBC PPM Type IIa scale maximum (PPM 7, equivalent
  // to −6 dBFS). Per IEC 60268-10 Type IIa and BBC operational practice,
  // PPM 6 is the Permitted Maximum Level (PML); PPM 7 represents headroom
  // for transients. Programme peaks should not routinely exceed PPM 6.
  // Currently disabled as scale markings provide sufficient indication.
  // ─────────────────────────────────────────────────────────────────────────
  // const fenceX = xFromDb(dbMax);
  // ctx.globalAlpha = 1;
  // ctx.fillStyle = '#2a3642';
  // ctx.fillRect(Math.round(fenceX) - 1, 0, 2, h);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCALE LAYOUT FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

// ------- Digital RMS (dBFS) scale -------
const dbfsMarks = [-60, -50, -40, -30, -24, -18, -12, -6, -3, 0];
export function layoutDBFSScale(el) {
  if (!el) return;
  el.innerHTML = '';
  const dbMin = -60, dbMax = 0;
  const xPercent = createXPercent(dbMin, dbMax, el);
  const vLayout = getScaleVerticalLayout(el);

  dbfsMarks.forEach(m => {
    const x = xPercent(m);
    const t = document.createElement('div');
    t.style.position = 'absolute';
    t.style.left = `calc(${x}% - 0.5px)`;
    t.style.top = vLayout.top;
    t.style.height = vLayout.height;
    t.style.width = '1px';
    t.style.background = '#2a3642';
    el.appendChild(t);
    const lab = document.createElement('div');
    lab.innerHTML = formatCenteredNumber(m);
    lab.style.position = 'absolute';
    lab.style.left = `calc(${x}% - 20px)`;
    lab.style.bottom = vLayout.labelBottom;
    lab.style.width = '40px';
    lab.style.textAlign = 'center';
    lab.style.fontSize = '10px';
    lab.style.color = '#88a3bf';
    el.appendChild(lab);
  });
  // TEST -21 dBFS RMS
  const xTest = xPercent(-21);
  const ref = document.createElement('div');
  ref.style.position = 'absolute';
  ref.style.left = `calc(${xTest}% - 0.5px)`;
  ref.style.top = '25%';
  ref.style.height = '50%';
  ref.style.width = '1px';
  ref.style.background = getCss('--cyan');
  ref.style.opacity = '0.95';
  el.appendChild(ref);
  const tag = document.createElement('div');
  tag.innerHTML = '<div>TEST</div><div>−21 dBFS RMS</div><div>−18 dBFS peak</div>';
  tag.style.position = 'absolute';
  tag.style.left = `calc(${xTest}% - 40px)`;
  tag.style.top = vLayout.tagTop;
  tag.style.width = '80px';
  tag.style.textAlign = 'center';
  tag.style.fontSize = '9px';
  tag.style.color = getCss('--cyan');
  tag.style.fontWeight = 'bold';
  tag.style.lineHeight = '1.15';
  el.appendChild(tag);
}

// ------- True Peak (dBTP) scale -------
const TP_SCALE_MIN = -60;
const TP_SCALE_MAX = 3;
const TP_SCALE_SPAN = TP_SCALE_MAX - TP_SCALE_MIN;
let TP_LIMIT = -1;

export function setTpLimit(val) {
  TP_LIMIT = val;
}

export function layoutTPScale(el) {
  if (!el) return;
  el.innerHTML = '';
  const xPercent = createXPercent(TP_SCALE_MIN, TP_SCALE_MAX, el);
  const vLayout = getScaleVerticalLayout(el);

  const marks = [-60, -50, -40, -30, -24, -18, -12, -6, -3, 0, 3];
  marks.forEach(m => {
    const x = xPercent(m);
    if (m !== 0) {
      const t = document.createElement('div');
      t.style.position = 'absolute';
      t.style.left = `calc(${x}% - 1px)`;
      t.style.top = vLayout.top;
      t.style.height = vLayout.height;
      t.style.width = '2px';
      t.style.background = '#2a3642';
      el.appendChild(t);
    }
    const lab = document.createElement('div');
    lab.innerHTML = formatCenteredNumber((m > 0 ? '+' : '') + m);
    lab.style.position = 'absolute';
    lab.style.left = `calc(${x}% - 20px)`;
    lab.style.bottom = vLayout.labelBottom;
    lab.style.width = '40px';
    lab.style.textAlign = 'center';
    lab.style.fontSize = '10px';
    lab.style.color = '#88a3bf';
    el.appendChild(lab);
  });
  // Warn zones
  const warn = [
    { v: -6, c: 'var(--warn)', w: 1, color: getCss('--warn') },
    { v: -3, c: 'var(--caution)', w: 1, color: getCss('--caution') }
  ];
  for (const mk of warn) {
    const x = xPercent(mk.v);
    const col = document.createElement('div');
    col.style.position = 'absolute';
    col.style.left = `calc(${x}% - 0.5px)`;
    col.style.top = vLayout.top;
    col.style.height = vLayout.height;
    col.style.width = mk.w + 'px';
    col.style.background = mk.c;
    col.style.opacity = '0.95';
    el.appendChild(col);
  }
  // 0 dBTP label (text removed, element kept for future use)
  const xZero = xPercent(0);
  const zeroTag = document.createElement('div');
  zeroTag.innerHTML = '';
  zeroTag.style.position = 'absolute';
  zeroTag.style.left = `calc(${xZero}% - 32px)`;
  zeroTag.style.top = vLayout.tagTopLg;
  zeroTag.style.width = '64px';
  zeroTag.style.textAlign = 'center';
  zeroTag.style.fontSize = '10px';
  zeroTag.style.color = getCss('--hot');
  zeroTag.style.fontWeight = 'bold';
  zeroTag.style.lineHeight = '1.2';
  el.appendChild(zeroTag);
  // TEST -18 dBTP
  const xRef = xPercent(-18);
  const ref = document.createElement('div');
  ref.style.position = 'absolute';
  ref.style.left = `calc(${xRef}% - 1px)`;
  ref.style.top = '25%';
  ref.style.height = '50%';
  ref.style.width = '2px';
  ref.style.background = getCss('--cyan');
  ref.style.opacity = '0.95';
  el.appendChild(ref);
  const tag = document.createElement('div');
  tag.innerHTML = '<div>TEST</div><div>−18 dBTP</div><div>−18 dBFS peak</div>';
  tag.style.position = 'absolute';
  tag.style.left = `calc(${xRef}% - 40px)`;
  tag.style.top = vLayout.tagTop;
  tag.style.width = '80px';
  tag.style.textAlign = 'center';
  tag.style.fontSize = '9px';
  tag.style.color = getCss('--cyan');
  tag.style.fontWeight = 'bold';
  tag.style.lineHeight = '1.2';
  el.appendChild(tag);
  // TP LIMIT
  const xLimit = xPercent(TP_LIMIT);
  const limitRef = document.createElement('div');
  limitRef.id = 'tpLimitLine';
  limitRef.style.position = 'absolute';
  limitRef.style.left = `calc(${xLimit}% - 1px)`;
  limitRef.style.top = '25%';
  limitRef.style.height = '50%';
  limitRef.style.width = '2px';
  limitRef.style.background = getCss('--cyan');
  limitRef.style.opacity = '0.95';
  limitRef.style.transition = 'left 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
  el.appendChild(limitRef);
  const limitTag = document.createElement('div');
  limitTag.id = 'tpLimitTag';
  limitTag.innerHTML = `<div>LIMIT</div><div>${TP_LIMIT} dBTP</div>`;
  limitTag.style.position = 'absolute';
  limitTag.style.left = `calc(${xLimit}% - 40px)`;
  limitTag.style.top = vLayout.tagTop;
  limitTag.style.width = '80px';
  limitTag.style.textAlign = 'center';
  limitTag.style.fontSize = '9px';
  limitTag.style.color = getCss('--cyan');
  limitTag.style.fontWeight = 'bold';
  limitTag.style.lineHeight = '1.2';
  limitTag.style.transition = 'left 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
  el.appendChild(limitTag);
}

export function updateTpLimitDisplay() {
  const limitLine = document.getElementById('tpLimitLine');
  const limitTag = document.getElementById('tpLimitTag');
  const xPercent = createXPercent(TP_SCALE_MIN, TP_SCALE_MAX, limitLine);
  const xLimit = xPercent(TP_LIMIT);
  if (limitLine) {
    limitLine.style.left = `calc(${xLimit}% - 1px)`;
  }
  if (limitTag) {
    limitTag.style.left = `calc(${xLimit}% - 40px)`;
    limitTag.innerHTML = `<div>LIMIT</div><div>${TP_LIMIT} dBTP</div>`;
  }
}

// ------- Nordic PPM scale (compressed display) -------
// Display range: -40 to +12 PPM (compressed above +6)
// Real range: -40 to +18 PPM = -58 to 0 dBFS (EBU R68)
// Compression: +6 to +18 PPM (real) → +6 to +12 PPM (display)
//
// Scale ticks use DISPLAY positions. Ticks above +6 are compressed.
const nordicPpmMarks = [
  { ppm: -40, label: null },    // Display = Real (tick only, no label)
  { ppm: -36, label: '−36' },
  { ppm: -30, label: '−30' },
  { ppm: -24, label: '−24' },
  { ppm: -18, label: '−18' },
  { ppm: -12, label: '−12' },
  { ppm: -6, label: '−6' },
  { ppm: 0, label: 'TEST' },
  { ppm: 6, label: '+6' },      // Display = Real (compression starts here)
  { ppm: 9, label: null },      // Real +9 → display +7.5 (tick only, interpolated)
  { ppm: 12, label: null }      // Real +18 → display +12 (tick only, interpolated)
];

/**
 * Convert real PPM to display PPM for scale positioning.
 * @param {number} realPpm - Real PPM value (EBU R68)
 * @returns {number} Display PPM value
 */
function nordicPpmToDisplayForScale(realPpm) {
  if (realPpm <= 6) return realPpm;
  return 6 + (realPpm - 6) * 0.5;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECONDARY TICKS (gap-filling marks between primary scale marks)
// ─────────────────────────────────────────────────────────────────────────────
// These shorter ticks appear in the gaps above the L bar and below the R bar,
// providing finer visual reference without cluttering the main scale area.
// Positions are CSS-controlled for easy adjustment.

/**
 * Secondary tick positions for Nordic PPM (midpoints between labeled marks).
 * These get tick lines only, no labels.
 */
const nordicPpmSecondaryMarks = [
  -33,  // Between -36 and -30
  -27,  // Between -30 and -24
  -21,  // Between -24 and -18
  -15,  // Between -18 and -12
  -9,   // Between -12 and -6
  -3,   // Between -6 and 0 (TEST)
  3,    // Between 0 (TEST) and +6
  12    // Real +12 PPM (-6 dBFS) → display +9
];

/**
 * Render secondary ticks for a scale.
 * Creates shorter tick marks in the gap regions above L bar and below R bar.
 *
 * @param {HTMLElement} el - Container element for the scale
 * @param {number[]} ppmPositions - Array of PPM values for secondary ticks
 * @param {Function} xPercentFn - Function to convert dBFS to x percentage
 * @param {Function} ppmToDisplayFn - Function to convert real PPM to display PPM
 * @param {string} tickColour - CSS colour for tick marks
 */
function renderSecondaryTicks(el, ppmPositions, xPercentFn, ppmToDisplayFn, tickColour) {
  // Get CSS variable values for heights
  const topHeight = getCss('--secondary-tick-top-height') || '8%';
  const bottomHeight = getCss('--secondary-tick-bottom-height') || '8%';

  // Get vertical layout for reference
  const vLayout = getScaleVerticalLayout(el);

  ppmPositions.forEach(ppm => {
    const displayPpm = ppmToDisplayFn ? ppmToDisplayFn(ppm) : ppm;
    const displayDbfs = displayPpm - 18;
    const x = xPercentFn(displayDbfs);

    // Upper secondary tick (anchored to top, extends down into gap above L bar)
    const tickTop = document.createElement('div');
    tickTop.className = 'secondary-tick secondary-tick-top';
    tickTop.style.position = 'absolute';
    tickTop.style.left = `calc(${x}% - 0.5px)`;
    tickTop.style.top = vLayout.top;
    tickTop.style.height = topHeight;
    tickTop.style.width = '1px';
    tickTop.style.background = tickColour;
    tickTop.style.opacity = '0.6';
    el.appendChild(tickTop);

    // Lower secondary tick (anchored to bottom of scale area, extends up into gap below R bar)
    const tickBottom = document.createElement('div');
    tickBottom.className = 'secondary-tick secondary-tick-bottom';
    tickBottom.style.position = 'absolute';
    tickBottom.style.left = `calc(${x}% - 0.5px)`;
    // Position from bottom of primary tick area
    const primaryBottom = parseFloat(vLayout.top) + parseFloat(vLayout.height);
    tickBottom.style.top = `calc(${primaryBottom}% - ${bottomHeight})`;
    tickBottom.style.height = bottomHeight;
    tickBottom.style.width = '1px';
    tickBottom.style.background = tickColour;
    tickBottom.style.opacity = '0.6';
    el.appendChild(tickBottom);
  });
}

export function layoutNordicPPMScale(el) {
  if (!el) return;
  el.innerHTML = '';
  // Display scale: -40 to +12 PPM = -58 to -6 dBFS (display)
  const dbMinDisplay = -58, dbMaxDisplay = -6;
  const xPercent = createXPercent(dbMinDisplay, dbMaxDisplay, el);
  const vLayout = getScaleVerticalLayout(el);

  nordicPpmMarks.forEach(m => {
    // Special handling for compressed zone labels
    let displayPpm = m.ppm;
    let realPpm = m.ppm;

    // For +9 and +12 labels, we need special mapping:
    // +9 label represents real +9 PPM (PML), positioned at display +7.5
    // +12 label represents real +18 PPM (0 dBFS), positioned at display +12
    if (m.ppm === 9) {
      displayPpm = 7.5;  // Real +9 → display +7.5
    } else if (m.ppm === 12) {
      displayPpm = 12;   // Real +18 → display +12 (label shows "+12" but means clip/0dBFS)
      realPpm = 18;      // This is actually real +18 PPM
    }

    const displayDbfs = displayPpm - 18;
    const x = xPercent(displayDbfs);

    const t = document.createElement('div');
    t.style.position = 'absolute';
    t.style.left = `calc(${x}% - 0.5px)`;
    t.style.top = vLayout.top;
    t.style.height = vLayout.height;
    t.style.width = '1px';
    t.style.background = '#5a6a7a';
    el.appendChild(t);

    if (m.label) {
      const lab = document.createElement('div');
      lab.innerHTML = formatCenteredNumber(m.label);
      lab.style.position = 'absolute';
      lab.style.left = `calc(${x}% - 20px)`;
      lab.style.bottom = vLayout.labelBottom;
      lab.style.width = '40px';
      lab.style.textAlign = 'center';
      lab.style.fontSize = '10px';
      lab.style.color = '#a0b8d0';
      el.appendChild(lab);
    }
  });

  // TEST = 0 PPM (real) = -18 dBFS = -18 display dBFS
  // Tick line spans only from top of L bar to bottom of R bar
  // Same grey as other ticks but slightly wider
  const xTest = xPercent(-18);
  const ref = document.createElement('div');
  ref.style.position = 'absolute';
  ref.style.left = `calc(${xTest}% - 1px)`;
  ref.style.top = '35%';      // Top of L bar
  ref.style.height = '32%';   // To bottom of R bar (35% + 12% + gap + 12% ≈ 67%)
  ref.style.width = '2px';
  ref.style.background = '#5a6a7a';  // Same grey as other ticks
  ref.style.opacity = '1';
  el.appendChild(ref);
  const tag = document.createElement('div');
  tag.innerHTML = '<div>TEST</div><div>0 PPM (0 dBu)</div><div>−18 dBFS peak</div>';
  tag.style.position = 'absolute';
  tag.style.left = `calc(${xTest}% - 44px)`;
  tag.style.top = vLayout.tagTop;
  tag.style.width = '88px';
  tag.style.textAlign = 'center';
  tag.style.fontSize = '9px';
  tag.style.color = '#a0b8d0';
  tag.style.fontWeight = 'bold';
  tag.style.lineHeight = '1.15';
  el.appendChild(tag);

  // TEST indicator triangles - red arrows pointing at LED bars (2x size)
  // Aligned with top/bottom of primary tick area (with font metric compensation)
  // Upper triangle (▼) pointing down at L bar - top aligned with tick top
  const testArrowUp = document.createElement('div');
  testArrowUp.textContent = '▼';
  testArrowUp.style.position = 'absolute';
  testArrowUp.style.left = `calc(${xTest}% - 10px)`;
  testArrowUp.style.top = `calc(${vLayout.top} - 3px)`;  // Compensate for font top padding
  testArrowUp.style.width = '20px';
  testArrowUp.style.textAlign = 'center';
  testArrowUp.style.fontSize = '20px';
  testArrowUp.style.color = getCss('--hot');
  testArrowUp.style.lineHeight = '1';
  el.appendChild(testArrowUp);

  // Lower triangle (▲) pointing up at R bar - bottom aligned with tick bottom
  const testArrowDown = document.createElement('div');
  testArrowDown.textContent = '▲';
  testArrowDown.style.position = 'absolute';
  testArrowDown.style.left = `calc(${xTest}% - 10px)`;
  testArrowDown.style.bottom = `calc(100% - ${parseFloat(vLayout.top) + parseFloat(vLayout.height)}% - 3px)`;  // Compensate for font bottom padding
  testArrowDown.style.width = '20px';
  testArrowDown.style.textAlign = 'center';
  testArrowDown.style.fontSize = '20px';
  testArrowDown.style.color = getCss('--hot');
  testArrowDown.style.lineHeight = '1';
  el.appendChild(testArrowDown);

  // PML = +9 PPM (real) = -9 dBFS (real)
  // Display position: +7.5 PPM display = -10.5 dBFS display
  const pmlDisplayDbfs = -10.5;
  const xPML = xPercent(pmlDisplayDbfs);
  const pmlLine = document.createElement('div');
  pmlLine.style.position = 'absolute';
  pmlLine.style.left = `calc(${xPML}% - 1px)`;
  pmlLine.style.top = vLayout.top;
  pmlLine.style.height = vLayout.height;
  pmlLine.style.width = '2px';
  pmlLine.style.background = getCss('--hot');
  pmlLine.style.opacity = '0.95';
  el.appendChild(pmlLine);

  // +9 label ABOVE (monochrome, same style as other tick labels)
  const pmlLabelAbove = document.createElement('div');
  pmlLabelAbove.innerHTML = formatCenteredNumber('+9');
  pmlLabelAbove.style.position = 'absolute';
  pmlLabelAbove.style.left = `calc(${xPML}% - 20px)`;
  pmlLabelAbove.style.bottom = vLayout.labelBottom;
  pmlLabelAbove.style.width = '40px';
  pmlLabelAbove.style.textAlign = 'center';
  pmlLabelAbove.style.fontSize = '10px';
  pmlLabelAbove.style.color = '#a0b8d0';
  el.appendChild(pmlLabelAbove);

  // PML tag BELOW (red, unchanged)
  const pmlTag = document.createElement('div');
  pmlTag.innerHTML = '<div>PML</div><div>+9 PPM</div><div>−9 dBFS</div>';
  pmlTag.style.position = 'absolute';
  pmlTag.style.left = `calc(${xPML}% - 36px)`;
  pmlTag.style.top = vLayout.tagTopLg;
  pmlTag.style.width = '72px';
  pmlTag.style.textAlign = 'center';
  pmlTag.style.fontSize = '9px';
  pmlTag.style.color = getCss('--hot');
  pmlTag.style.fontWeight = 'bold';
  pmlTag.style.lineHeight = '1.15';
  el.appendChild(pmlTag);

  // Render secondary ticks (gap-filling marks between primary marks)
  renderSecondaryTicks(el, nordicPpmSecondaryMarks, xPercent, nordicPpmToDisplayForScale, '#5a6a7a');
}

// ------- BBC PPM Type IIa scale -------
// PPM 1-7, 4 dB per division
// PPM 1 = -30 dBFS, PPM 4 = -18 dBFS (TEST), PPM 6 = -10 dBFS (PML), PPM 7 = -6 dBFS
const bbcPpmMarks = [
  { ppm: 1, db: -30, label: '1' },
  { ppm: 2, db: -26, label: '2' },
  { ppm: 3, db: -22, label: '3' },
  { ppm: 4, db: -18, label: '4' },
  { ppm: 5, db: -14, label: '5' },
  { ppm: 6, db: -10, label: '6' },
  { ppm: 7, db: -6,  label: '7' }
];

export function layoutBBCPPMScale(el) {
  if (!el) return;
  el.innerHTML = '';
  const dbMin = -30, dbMax = -6;
  const xPercent = createXPercent(dbMin, dbMax, el);
  const vLayout = getScaleVerticalLayout(el);

  // BBC/EBU purist monochrome palette
  const tickColour = '#c0c0c0';      // Standard tick marks
  const tickBoldColour = '#e8e8e8';  // Emphasis ticks (PPM 4, PPM 6)
  const labelColour = '#d0d0d0';     // Scale numerals
  const tagColour = '#e8e8e8';       // Annotation tags

  // Draw PPM markers (1-7)
  bbcPpmMarks.forEach(m => {
    const x = xPercent(m.db);
    const isBold = m.ppm === 4 || m.ppm === 6;

    const t = document.createElement('div');
    t.style.position = 'absolute';
    t.style.left = `calc(${x}% - ${isBold ? 1 : 0.5}px)`;
    t.style.top = vLayout.top;
    t.style.height = vLayout.height;
    t.style.width = isBold ? '2px' : '1px';
    t.style.background = isBold ? tickBoldColour : tickColour;
    el.appendChild(t);

    const lab = document.createElement('div');
    lab.textContent = m.label;
    lab.style.position = 'absolute';
    lab.style.left = `calc(${x}% - 20px)`;
    lab.style.bottom = vLayout.labelBottom;
    lab.style.width = '40px';
    lab.style.textAlign = 'center';
    lab.style.fontSize = '10px';
    lab.style.fontWeight = isBold ? 'bold' : 'normal';
    lab.style.color = labelColour;
    el.appendChild(lab);
  });

  // TEST = PPM 4 (alignment level, -18 dBFS)
  // Per BBC practice: primary operator reference, bolder tick, no colour change
  const xTest = xPercent(-18);
  const tag = document.createElement('div');
  tag.innerHTML = '<div>TEST</div><div>PPM 4</div><div>−18 dBFS</div>';
  tag.style.position = 'absolute';
  tag.style.left = `calc(${xTest}% - 44px)`;
  tag.style.top = vLayout.tagTop;
  tag.style.width = '88px';
  tag.style.textAlign = 'center';
  tag.style.fontSize = '9px';
  tag.style.color = tagColour;
  tag.style.fontWeight = 'bold';
  tag.style.lineHeight = '1.15';
  el.appendChild(tag);

  // PML = PPM 6 (Permitted Maximum Level, -10 dBFS)
  // Per BBC practice: maximum permitted level, bolder tick, remains monochrome
  const xPML = xPercent(-10);
  const pmlTag = document.createElement('div');
  pmlTag.innerHTML = '<div>PML</div><div>PPM 6</div>';
  pmlTag.style.position = 'absolute';
  pmlTag.style.left = `calc(${xPML}% - 32px)`;
  pmlTag.style.top = vLayout.tagTopLg;
  pmlTag.style.width = '64px';
  pmlTag.style.textAlign = 'center';
  pmlTag.style.fontSize = '10px';
  pmlTag.style.color = tagColour;
  pmlTag.style.fontWeight = 'bold';
  pmlTag.style.lineHeight = '1.2';
  el.appendChild(pmlTag);
}

// ─────────────────────────────────────────────────────────────────────────────
// SAMPLE PEAK BAR (-60 to 0 dBFS)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Draw Sample Peak horizontal bar meter with RTW visual form.
 * Scale: -60 to 0 dBFS (linear, no oversampling)
 * Purist monochrome design per IEC 60268-18 / AES17-2015
 * No ballistics - instantaneous sample peak measurement
 */
export function drawSamplePeakBar(canvas, valueL, valueR, peakHoldL, peakHoldR) {
  const dpr = window.devicePixelRatio || 1;
  // Use clientWidth/clientHeight to exclude border from dimensions
  const w = Math.floor(canvas.clientWidth * dpr), h = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');

  // Range constants: -60 to 0 dBFS (60 dB span)
  const dbMin = -60, dbMax = 0;
  const baseStep = 0.5;

  // Vertical inset for bargraph panels
  const vInset = getVerticalInset(canvas);
  const startY = h * vInset;
  const drawableH = h * (1 - 2 * vInset);
  const barH = Math.round(drawableH * BAR_HEIGHT_RATIO);

  // Position calculation with inset from CSS
  const xFromDb = createXFromDb(dbMin, dbMax, w, canvas);

  // Clear canvas with dark background
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0e151a';
  ctx.fillRect(0, 0, w, h);

  // Sample Peak colour: Dig60-style amber with red clip
  // DK-Audio MSD600 / Dig60 reference: 60 amber LEDs + red at 0 dBFS
  const segColour = '#ffcc00';  // Amber for authentic Dig60 appearance
  const clipColour = '#ff2020'; // Red for 0 dBFS clip indicator only

  // Draw a single channel with RTW segment form
  function drawChannel(yTop, val, peakHold) {
    const displayVal = Math.max(dbMin, Math.min(dbMax, val));
    const peakDbRaw = (peakHold !== undefined) ? peakHold : dbMin - 1;
    const peakDb = Math.max(dbMin, Math.min(dbMax, peakDbRaw));

    // Track peak-hold position for drawing
    let peakSubX = -1;
    let peakSegmentWidth = 0;
    let peakIsClip = false;

    // Draw segments for each base step with sub-resolution
    for (let d = dbMin; d < dbMax; d += baseStep) {
      const mult = getResolutionMultiplier(d, RESOLUTION_PROFILE_SAMPLE_PEAK);
      const subStep = baseStep / mult;
      const x0Base = xFromDb(d);
      const x1Base = xFromDb(d + baseStep);
      const baseWidth = x1Base - x0Base;

      if (baseWidth <= 1) continue;

      // Calculate sub-segment dimensions with RTW proportions
      const subCellWidth = baseWidth / mult;
      const segmentWidth = Math.max(1, subCellWidth * SEGMENT_RATIO);

      for (let sub = 0; sub < mult; sub++) {
        const subDb = d + sub * subStep;
        const subX = x0Base + sub * subCellWidth;
        const isClipZone = subDb >= -0.5; // Near 0 dBFS

        // Check if this sub-cell contains the peak-hold position
        if (peakDb >= subDb && peakDb < subDb + subStep) {
          peakSubX = subX;
          peakSegmentWidth = segmentWidth;
          peakIsClip = isClipZone;
        }

        // OFF state: always visible silhouette
        // Clip zone uses higher alpha since red is darker when dimmed
        ctx.globalAlpha = isClipZone ? 0.35 : ALPHA_OFF;
        ctx.fillStyle = isClipZone ? clipColour : segColour;
        ctx.fillRect(subX, yTop, segmentWidth, barH);

        // ON state: crisp, solid segment
        if (subDb < displayVal) {
          ctx.globalAlpha = ALPHA_ON;
          ctx.fillStyle = isClipZone ? clipColour : segColour;
          ctx.fillRect(subX, yTop, segmentWidth, barH);

          // Extra glow for clip zone
          if (isClipZone) {
            ctx.shadowColor = clipColour;
            ctx.shadowBlur = PEAK_GLOW_MULT * dpr;
            ctx.fillRect(subX, yTop, segmentWidth, barH);
            ctx.shadowBlur = 0;
          }
        }
      }
    }

    // Peak-hold marker (RTW-style: white for contrast, red if in clip zone)
    if (peakSubX >= 0 && peakHold > dbMin) {
      const pCol = peakIsClip ? clipColour : '#ffffff';  // White peak hold for visibility
      ctx.globalAlpha = 1;
      ctx.shadowColor = pCol;
      ctx.shadowBlur = peakIsClip ? PEAK_GLOW_MULT * 1.5 * dpr : PEAK_GLOW_MULT * dpr;
      ctx.fillStyle = pCol;
      ctx.fillRect(peakSubX, yTop, peakSegmentWidth, barH);
      ctx.shadowBlur = 0;
    }
  }

  drawChannel(startY + drawableH * CHANNEL_L_Y_RATIO, valueL, peakHoldL);
  drawChannel(startY + drawableH * CHANNEL_R_Y_RATIO, valueR, peakHoldR);

  // 0 dBFS fence (clip boundary)
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = clipColour;
  const zeroX = xFromDb(0);
  ctx.fillRect(Math.round(zeroX) - 1, startY + drawableH * SCALE_MARKER_Y_RATIO, 2, drawableH * SCALE_MARKER_HEIGHT_RATIO);
}

// ------- Sample Peak scale -------
// -60 to 0 dBFS, marks every 10 dB
const samplePeakMarks = [-60, -50, -40, -30, -20, -10, 0];

export function layoutSamplePeakScale(el) {
  if (!el) return;
  el.innerHTML = '';
  const dbMin = -60, dbMax = 0;
  const xPercent = createXPercent(dbMin, dbMax, el);
  const vLayout = getScaleVerticalLayout(el);

  // Sample Peak Dig60-style amber palette
  const tickColour = '#b8960a';      // Muted amber tick marks
  const tickBoldColour = '#ffcc00';  // Bright amber emphasis tick
  const labelColour = '#d4a800';     // Amber scale numerals
  const tagColour = '#ffcc00';       // Amber annotation tags
  const clipColour = '#ff2020';      // Red clip indicator

  // Draw dBFS markers
  samplePeakMarks.forEach(db => {
    const x = xPercent(db);
    const isClip = db === 0;

    const t = document.createElement('div');
    t.style.position = 'absolute';
    t.style.left = `calc(${x}% - ${isClip ? 1 : 0.5}px)`;
    t.style.top = vLayout.top;
    t.style.height = vLayout.height;
    t.style.width = isClip ? '2px' : '1px';
    t.style.background = isClip ? clipColour : tickColour;
    el.appendChild(t);

    const lab = document.createElement('div');
    lab.innerHTML = formatCenteredNumber(db === 0 ? '0' : String(db));
    lab.style.position = 'absolute';
    lab.style.left = `calc(${x}% - 20px)`;
    lab.style.bottom = vLayout.labelBottom;
    lab.style.width = '40px';
    lab.style.textAlign = 'center';
    lab.style.fontSize = '10px';
    lab.style.fontWeight = isClip ? 'bold' : 'normal';
    lab.style.color = isClip ? clipColour : labelColour;
    el.appendChild(lab);
  });

  // 0 dBFS clip marker tag
  const xClip = xPercent(0);
  const clipTag = document.createElement('div');
  clipTag.innerHTML = '<div>CLIP</div><div>0 dBFS</div>';
  clipTag.style.position = 'absolute';
  clipTag.style.left = `calc(${xClip}% - 32px)`;
  clipTag.style.top = vLayout.tagTopLg;
  clipTag.style.width = '64px';
  clipTag.style.textAlign = 'center';
  clipTag.style.fontSize = '10px';
  clipTag.style.color = clipColour;
  clipTag.style.fontWeight = 'bold';
  clipTag.style.lineHeight = '1.2';
  el.appendChild(clipTag);

  // -18 dBFS reference marker (common alignment level)
  const xRef = xPercent(-18);
  const refTick = document.createElement('div');
  refTick.style.position = 'absolute';
  refTick.style.left = `calc(${xRef}% - 1px)`;
  refTick.style.top = vLayout.top;
  refTick.style.height = vLayout.height;
  refTick.style.width = '2px';
  refTick.style.background = tickBoldColour;
  el.appendChild(refTick);

  const refTag = document.createElement('div');
  refTag.innerHTML = '<div>REF</div><div>−18 dBFS</div>';
  refTag.style.position = 'absolute';
  refTag.style.left = `calc(${xRef}% - 36px)`;
  refTag.style.top = vLayout.tagTop;
  refTag.style.width = '72px';
  refTag.style.textAlign = 'center';
  refTag.style.fontSize = '9px';
  refTag.style.color = tagColour;
  refTag.style.fontWeight = 'bold';
  refTag.style.lineHeight = '1.15';
  el.appendChild(refTag);
}
