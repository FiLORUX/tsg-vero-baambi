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
 * - drawHBar_PPM: Nordic PPM bar (-54 to -9 dBFS / -36 to +9 PPM)
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

// Get CSS custom property value
function getCss(v) {
  return getComputedStyle(document.documentElement).getPropertyValue(v).trim();
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
  const w = Math.floor(canvas.clientWidth * dpr), h = Math.floor(canvas.height);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');

  // Range constants
  const dbMin = -60, dbMax = 0, dbSpan = dbMax - dbMin;
  const baseStep = 0.5;
  const barH = Math.round(h * 0.12);

  // Position calculation
  function xFromDb(db) {
    const c = Math.max(dbMin, Math.min(dbMax, db));
    return (c - dbMin) / dbSpan * w;
  }

  // Clear canvas with dark background
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0e151a';
  ctx.fillRect(0, 0, w, h);

  // Colour (unchanged - all green for dBFS)
  function segColor() {
    return getCss('--ok');
  }

  // Draw a single channel with RTW segment form
  function drawChannel(yTop, val) {
    const displayVal = Math.max(dbMin, Math.min(dbMax, val));
    const col = segColor();

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

  drawChannel(h * 0.35, valueL);
  drawChannel(h * 0.55, valueR);

  // 0 dBFS fence
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#2a3642';
  ctx.fillRect(w - 2, 0, 2, h);
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
  const w = Math.floor(canvas.clientWidth * dpr), h = Math.floor(canvas.height);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');

  // Range constants
  const dbMin = -60, dbMax = 3, dbSpan = dbMax - dbMin; // 63 dB
  const baseStep = 0.5;
  const barH = Math.round(h * 0.12);

  // Clear canvas with dark background
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0e151a';
  ctx.fillRect(0, 0, w, h);

  // Position calculation
  function xFromDb(db) {
    const c = Math.max(dbMin, Math.min(dbMax, db));
    return (c - dbMin) / dbSpan * w;
  }

  // Colour zones (unchanged from original)
  function segColor(db) {
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
        const col = segColor(subDb + subStep / 2); // Color at sub-cell center

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
      const pCol = segColor(peakSubDb + 0.25);
      ctx.globalAlpha = 1;
      ctx.shadowColor = pCol;
      ctx.shadowBlur = (peakSubDb >= 0) ? PEAK_GLOW_MULT * 1.5 * dpr : PEAK_GLOW_MULT * dpr;
      ctx.fillStyle = pCol;
      ctx.fillRect(peakSubX, yTop, peakSegmentWidth, barH);
      ctx.shadowBlur = 0;
    }
  }

  drawChannel(h * 0.35, valueL, peakHoldL);
  drawChannel(h * 0.55, valueR, peakHoldR);

  // 0 dBTP fence (red line)
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = getCss('--hot');
  const zeroX = ((0 - dbMin) / dbSpan) * w;
  ctx.fillRect(Math.round(zeroX) - 1, h * 0.25, 2, h * 0.5);
}

// ─────────────────────────────────────────────────────────────────────────────
// NORDIC PPM BAR (-54 to -9 dBFS / -36 to +9 PPM)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Draw Nordic PPM horizontal bar meter with RTW visual form.
 * Scale: -36 to +9 PPM (dBu), mapped to -54 to -9 dBFS
 * Zones: green (safe) → yellow (caution) → red (overload)
 * TEST marker at 0 PPM (0 dBu = -18 dBFS), PML at +9 PPM (-9 dBFS)
 */
export function drawHBar_PPM(canvas, dBfsL, dBfsR, peakHoldL, peakHoldR) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.floor(rect.width * dpr), h = Math.floor(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');

  // Range constants
  const dbMin = -54, dbMax = -9, dbSpan = dbMax - dbMin; // 45 dB
  const baseStep = 0.5;
  const barH = Math.round(h * 0.12);

  // Position calculation
  function xFromDb(db) {
    const c = Math.max(dbMin, Math.min(dbMax, db));
    return (c - dbMin) / dbSpan * w;
  }

  // Clear canvas with dark background
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0e151a';
  ctx.fillRect(0, 0, w, h);

  // Nordic PPM colour zones (unchanged from original)
  function segColor(db) {
    const ppm = db + 18; // dBFS -> PPM/dBu
    if (ppm >= 6) return getCss('--hot');      // +6..+9: red (over PML)
    if (ppm >= 0) return getCss('--caution');  // 0..+6: amber (nominal / varning)
    return getCss('--ok');                      // <0: green (everything below line-up)
  }

  // Draw a single channel with RTW segment form
  function drawChannel(yTop, val, peakHold) {
    const displayVal = Math.max(dbMin, Math.min(dbMax, val));

    // Draw segments for each base step with sub-resolution
    for (let d = dbMin; d < dbMax; d += baseStep) {
      const mult = getResolutionMultiplier(d, RESOLUTION_PROFILE_PPM_EXTENDED);
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
        const col = segColor(subDb + subStep / 2); // Color at sub-cell center

        // OFF state: always visible silhouette
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

    // Peak-hold marker (RTW-style: same geometry, increased luminance, subtle glow)
    if (peakHold !== undefined && peakHold > dbMin) {
      const xPeak = xFromDb(peakHold);
      const peakCol = segColor(peakHold);

      // Find the segment width at peak position
      const mult = getResolutionMultiplier(peakHold, RESOLUTION_PROFILE_PPM_EXTENDED);
      const x0 = xFromDb(Math.floor(peakHold / baseStep) * baseStep);
      const x1 = xFromDb(Math.floor(peakHold / baseStep) * baseStep + baseStep);
      const baseWidth = Math.max(1, x1 - x0);
      const subCellWidth = baseWidth / mult;
      const segmentWidth = Math.max(2, subCellWidth * SEGMENT_RATIO);

      // Draw peak marker with subtle glow
      ctx.globalAlpha = 1;
      ctx.shadowColor = peakCol;
      ctx.shadowBlur = PEAK_GLOW_MULT * dpr;
      ctx.fillStyle = peakCol;
      ctx.fillRect(xPeak - segmentWidth / 2, yTop, segmentWidth, barH);
      ctx.shadowBlur = 0;
    }
  }

  drawChannel(h * 0.35, dBfsL, peakHoldL);
  drawChannel(h * 0.55, dBfsR, peakHoldR);

  // +9 PPM fence
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#2a3642';
  ctx.fillRect(w - 2, 0, 2, h);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCALE LAYOUT FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

// ------- Digital RMS (dBFS) scale -------
const dbfsMarks = [-60, -50, -40, -30, -24, -18, -12, -6, -3, 0];
export function layoutDBFSScale(el) {
  if (!el) return;
  el.innerHTML = '';
  dbfsMarks.forEach(m => {
    const x = ((m + 60) / 60) * 100;
    const t = document.createElement('div');
    t.style.position = 'absolute';
    t.style.left = `calc(${x}% - 0.5px)`;
    t.style.top = '25%';
    t.style.height = '50%';
    t.style.width = '1px';
    t.style.background = '#2a3642';
    el.appendChild(t);
    const lab = document.createElement('div');
    lab.textContent = m + ' dBFS';
    lab.style.position = 'absolute';
    lab.style.left = `calc(${x}% - 32px)`;
    lab.style.top = '8px';
    lab.style.width = '64px';
    lab.style.textAlign = 'center';
    lab.style.fontSize = '10px';
    lab.style.color = '#88a3bf';
    el.appendChild(lab);
  });
  // TEST -21 dBFS RMS
  const x = ((-21 + 60) / 60) * 100;
  const ref = document.createElement('div');
  ref.style.position = 'absolute';
  ref.style.left = `calc(${x}% - 0.5px)`;
  ref.style.top = '25%';
  ref.style.height = '50%';
  ref.style.width = '1px';
  ref.style.background = getCss('--cyan');
  ref.style.opacity = '0.95';
  el.appendChild(ref);
  const tag = document.createElement('div');
  tag.innerHTML = '<div>TEST</div><div>−21 dBFS RMS</div><div>−18 dBFS peak</div>';
  tag.style.position = 'absolute';
  tag.style.left = `calc(${x}% - 40px)`;
  tag.style.bottom = '4px';
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
  const marks = [-60, -50, -40, -30, -24, -18, -12, -6, -3, 0, 3];
  marks.forEach(m => {
    const x = ((m - TP_SCALE_MIN) / TP_SCALE_SPAN) * 100;
    if (m !== 0) {
      const t = document.createElement('div');
      t.style.position = 'absolute';
      t.style.left = `calc(${x}% - 1px)`;
      t.style.top = '25%';
      t.style.height = '50%';
      t.style.width = '2px';
      t.style.background = '#2a3642';
      el.appendChild(t);
    }
    const lab = document.createElement('div');
    lab.innerHTML = (m > 0 ? '+' : '') + m + '<br>dBTP';
    lab.style.position = 'absolute';
    lab.style.left = `calc(${x}% - 32px)`;
    lab.style.top = '2px';
    lab.style.width = '64px';
    lab.style.textAlign = 'center';
    lab.style.fontSize = '10px';
    lab.style.color = '#88a3bf';
    lab.style.lineHeight = '1.1';
    el.appendChild(lab);
  });
  // Warn zones
  const warn = [
    { v: -6, c: 'var(--warn)', w: 1, color: getCss('--warn') },
    { v: -3, c: 'var(--caution)', w: 1, color: getCss('--caution') }
  ];
  for (const mk of warn) {
    const x = ((mk.v - TP_SCALE_MIN) / TP_SCALE_SPAN) * 100;
    const col = document.createElement('div');
    col.style.position = 'absolute';
    col.style.left = `calc(${x}% - 0.5px)`;
    col.style.top = '25%';
    col.style.height = '50%';
    col.style.width = mk.w + 'px';
    col.style.background = mk.c;
    col.style.opacity = '0.95';
    el.appendChild(col);
  }
  // 0 dBTP label (text removed, element kept for future use)
  const xZero = ((0 - TP_SCALE_MIN) / TP_SCALE_SPAN) * 100;
  const zeroTag = document.createElement('div');
  zeroTag.innerHTML = '';
  zeroTag.style.position = 'absolute';
  zeroTag.style.left = `calc(${xZero}% - 32px)`;
  zeroTag.style.bottom = '8px';
  zeroTag.style.width = '64px';
  zeroTag.style.textAlign = 'center';
  zeroTag.style.fontSize = '10px';
  zeroTag.style.color = getCss('--hot');
  zeroTag.style.fontWeight = 'bold';
  zeroTag.style.lineHeight = '1.2';
  el.appendChild(zeroTag);
  // TEST -18 dBTP
  const xRef = ((-18 - TP_SCALE_MIN) / TP_SCALE_SPAN) * 100;
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
  tag.style.bottom = '4px';
  tag.style.width = '80px';
  tag.style.textAlign = 'center';
  tag.style.fontSize = '9px';
  tag.style.color = getCss('--cyan');
  tag.style.fontWeight = 'bold';
  tag.style.lineHeight = '1.2';
  el.appendChild(tag);
  // TP LIMIT
  const xLimit = ((TP_LIMIT - TP_SCALE_MIN) / TP_SCALE_SPAN) * 100;
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
  limitTag.style.bottom = '4px';
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
  const xLimit = ((TP_LIMIT - TP_SCALE_MIN) / TP_SCALE_SPAN) * 100;
  const limitLine = document.getElementById('tpLimitLine');
  const limitTag = document.getElementById('tpLimitTag');
  if (limitLine) {
    limitLine.style.left = `calc(${xLimit}% - 1px)`;
  }
  if (limitTag) {
    limitTag.style.left = `calc(${xLimit}% - 40px)`;
    limitTag.innerHTML = `<div>LIMIT</div><div>${TP_LIMIT} dBTP</div>`;
  }
}

// ------- Nordic PPM scale -------
const ppmMarks = [
  { ppm: -36, label: '−36' },
  { ppm: -30, label: '−30' },
  { ppm: -24, label: '−24' },
  { ppm: -18, label: '−18' },
  { ppm: -12, label: '−12' },
  { ppm: -6, label: '−6' },
  { ppm: 0, label: 'TEST' },
  { ppm: 6, label: '+6' },
  { ppm: 9, label: '+9' }
];

export function layoutPPMScale(el) {
  if (!el) return;
  el.innerHTML = '';
  const dbMin = -54, dbMax = -9, dbSpan = dbMax - dbMin;
  ppmMarks.forEach(m => {
    const dBFS = m.ppm - 18;
    const x = ((dBFS - dbMin) / dbSpan) * 100;
    const t = document.createElement('div');
    t.style.position = 'absolute';
    t.style.left = `calc(${x}% - 0.5px)`;
    t.style.top = '25%';
    t.style.height = '50%';
    t.style.width = '1px';
    t.style.background = '#2a3642';
    el.appendChild(t);
    const lab = document.createElement('div');
    lab.textContent = m.label;
    lab.style.position = 'absolute';
    lab.style.left = `calc(${x}% - 20px)`;
    lab.style.top = '6px';
    lab.style.width = '40px';
    lab.style.textAlign = 'center';
    lab.style.fontSize = '10px';
    lab.style.color = '#88a3bf';
    el.appendChild(lab);
  });
  // TEST = 0 PPM
  const xTest = ((-18 - dbMin) / dbSpan) * 100;
  const ref = document.createElement('div');
  ref.style.position = 'absolute';
  ref.style.left = `calc(${xTest}% - 1px)`;
  ref.style.top = '25%';
  ref.style.height = '50%';
  ref.style.width = '2px';
  ref.style.background = getCss('--cyan');
  ref.style.opacity = '0.95';
  el.appendChild(ref);
  const tag = document.createElement('div');
  tag.innerHTML = '<div>TEST</div><div>0 PPM (0 dBu)</div><div>−18 dBFS peak</div>';
  tag.style.position = 'absolute';
  tag.style.left = `calc(${xTest}% - 44px)`;
  tag.style.bottom = '4px';
  tag.style.width = '88px';
  tag.style.textAlign = 'center';
  tag.style.fontSize = '9px';
  tag.style.color = getCss('--cyan');
  tag.style.fontWeight = 'bold';
  tag.style.lineHeight = '1.15';
  el.appendChild(tag);
  // PML = +9 PPM
  const xPML = ((-9 - dbMin) / dbSpan) * 100;
  const pmlLine = document.createElement('div');
  pmlLine.style.position = 'absolute';
  pmlLine.style.left = `calc(${xPML}% - 1px)`;
  pmlLine.style.top = '25%';
  pmlLine.style.height = '50%';
  pmlLine.style.width = '2px';
  pmlLine.style.background = getCss('--hot');
  pmlLine.style.opacity = '0.95';
  el.appendChild(pmlLine);
  const pmlTag = document.createElement('div');
  pmlTag.innerHTML = '<div>PML</div><div>+9 PPM</div>';
  pmlTag.style.position = 'absolute';
  pmlTag.style.left = `calc(${xPML}% - 32px)`;
  pmlTag.style.bottom = '8px';
  pmlTag.style.width = '64px';
  pmlTag.style.textAlign = 'center';
  pmlTag.style.fontSize = '10px';
  pmlTag.style.color = getCss('--hot');
  pmlTag.style.fontWeight = 'bold';
  pmlTag.style.lineHeight = '1.2';
  el.appendChild(pmlTag);
}
