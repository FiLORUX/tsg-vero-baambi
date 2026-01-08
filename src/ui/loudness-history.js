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
 * LOUDNESS HISTORY STRIP (RTW TM9 / TC ELECTRONIC STYLE)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Rolling time-domain visualisation of loudness measurements.
 * Four traces matching professional hardware (RTW TM9, TC Clarity M):
 *
 * DISPLAY FORMAT
 * ──────────────
 *   Left Y-axis: LUFS scale (-36 to -6)
 *   Right Y-axis: dBTP scale (-36 to +3)
 *   X-axis: Time (configurable duration, default 5 minutes)
 *
 * TRACES (bottom to top layer order)
 * ──────────────────────────────────
 *   Green area: Short-term LUFS (S, 3s window)
 *   Orange line: Momentary LUFS (M, 400ms window)
 *   Yellow line: Integrated LUFS (I, programme)
 *   Cyan dashed: True Peak dBTP (TP, highest channel)
 *   Cyan line: Target reference
 *
 * DATA STRUCTURE
 * ──────────────
 *   Ring buffer of { t, m, st, i, tp }
 *   Samples at ~1 Hz
 *   Automatic pruning of samples older than duration
 *
 * @module ui/loudness-history
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { pruneHistory, needsPruning } from '../utils/history-pruner.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Default history duration in seconds */
const DEFAULT_DURATION_SEC = 300; // 5 minutes

/** Left Y-axis range (LUFS) */
const LUFS_MIN = -36;
const LUFS_MAX = -6;
const LUFS_RANGE = LUFS_MAX - LUFS_MIN;

/** Right Y-axis range (dBTP) */
const TP_MIN = -36;
const TP_MAX = 3;
const TP_RANGE = TP_MAX - TP_MIN;

/** Sampling interval in milliseconds */
const SAMPLE_INTERVAL_MS = 1000;

/** Visual styling (RTW TM9 / TC Electronic colour scheme) */
const COLOURS = Object.freeze({
  // Traces (matches radar colour zones)
  shortTerm: 'rgba(136, 214, 92, 0.35)',      // Green area fill
  shortTermStroke: 'rgba(136, 214, 92, 0.8)', // Green area stroke
  momentary: '#ff9a2d',                        // Orange line
  integrated: '#fbbf24',                       // Yellow/gold line
  truePeak: '#4dd4e0',                         // Cyan/teal line
  // Reference
  target: '#69bfff',                           // Cyan target line
  targetArea: 'rgba(105, 191, 255, 0.08)',    // Target tolerance band
  // Grid and labels
  grid: 'rgba(41, 50, 59, 0.6)',              // Grid lines
  text: 'rgba(169, 178, 199, 0.8)',           // Axis text
  background: 'rgba(10, 12, 14, 0.8)'         // Canvas background
});

// ─────────────────────────────────────────────────────────────────────────────
// LOUDNESS HISTORY STRIP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Loudness history strip component (RTW TM9 style).
 * Four traces: TP (True Peak), M (Momentary), S (Short-term), I (Integrated).
 *
 * @example
 * const strip = new LoudnessHistoryStrip(canvas, {
 *   duration: 300,
 *   target: -23,
 *   tolerance: 1
 * });
 * // In render loop:
 * strip.addSample(momentary, shortTerm, integrated, truePeak);
 * strip.render();
 */
export class LoudnessHistoryStrip {
  /**
   * @param {HTMLCanvasElement} canvas - Canvas element for rendering
   * @param {Object} [options] - Configuration options
   * @param {number} [options.duration=300] - History duration in seconds
   * @param {number} [options.target=-23] - Target LUFS reference
   * @param {number} [options.tolerance=1] - Target tolerance band (±LU)
   */
  constructor(canvas, options = {}) {
    /** @type {HTMLCanvasElement} */
    this._canvas = canvas;

    /** @type {CanvasRenderingContext2D} */
    this._ctx = canvas.getContext('2d');

    /** @type {number} History duration in seconds */
    this._duration = options.duration ?? DEFAULT_DURATION_SEC;

    /** @type {number} Target LUFS reference */
    this._target = options.target ?? -23;

    /** @type {number} Target tolerance band */
    this._tolerance = options.tolerance ?? 1;

    /** @type {Array<{t: number, m: number, st: number, i: number, tp: number}>} History buffer */
    this._history = [];

    /** @type {number} Last sample timestamp */
    this._lastSampleTime = 0;

    /** @type {number} Device pixel ratio for HiDPI rendering */
    this._dpr = window.devicePixelRatio || 1;

    /** @type {Object} Trace visibility state */
    this._visible = {
      s: true,   // Short-term
      m: true,   // Momentary
      i: true,   // Integrated
      tp: true   // True Peak
    };

    this._setupCanvas();
  }

  /**
   * Set target LUFS reference.
   * @param {number} target - Target LUFS value
   */
  setTarget(target) {
    this._target = target;
  }

  /**
   * Set history duration.
   * @param {number} seconds - Duration in seconds
   */
  setDuration(seconds) {
    this._duration = Math.max(30, Math.min(3600, seconds));
    this._pruneHistory();
  }

  /**
   * Toggle visibility of a trace.
   * @param {'s'|'m'|'i'|'tp'} trace - Trace identifier
   * @param {boolean} [visible] - Optional explicit state, or toggle if omitted
   * @returns {boolean} New visibility state
   */
  setTraceVisible(trace, visible) {
    if (!(trace in this._visible)) return false;
    this._visible[trace] = visible !== undefined ? visible : !this._visible[trace];
    return this._visible[trace];
  }

  /**
   * Get visibility state of a trace.
   * @param {'s'|'m'|'i'|'tp'} trace - Trace identifier
   * @returns {boolean} Visibility state
   */
  isTraceVisible(trace) {
    return this._visible[trace] ?? false;
  }

  /**
   * Add a new sample to history.
   * Called at ~1 Hz with all four loudness/peak values.
   *
   * @param {number} momentary - Momentary LUFS (400ms window)
   * @param {number} shortTerm - Short-term LUFS (3s window)
   * @param {number} integrated - Integrated LUFS (programme)
   * @param {number} truePeak - True Peak dBTP (highest channel)
   */
  addSample(momentary, shortTerm, integrated, truePeak) {
    const now = Date.now();

    // Rate limit to approximately 1 Hz
    if (now - this._lastSampleTime < SAMPLE_INTERVAL_MS * 0.9) {
      return;
    }

    this._lastSampleTime = now;

    // Add new sample with all four values
    this._history.push({
      t: now,
      m: isFinite(momentary) ? momentary : -100,
      st: isFinite(shortTerm) ? shortTerm : -100,
      i: isFinite(integrated) ? integrated : -100,
      tp: isFinite(truePeak) ? truePeak : -100
    });

    // Prune old samples
    this._pruneHistory();
  }

  /**
   * Clear all history.
   */
  reset() {
    this._history = [];
    this._lastSampleTime = 0;
  }

  /**
   * Render the history strip.
   * Called from render loop (60 Hz).
   * @param {Array<number>} [pauseBreaks=[]] - Timestamps of pause boundaries for gap rendering
   */
  render(pauseBreaks = []) {
    const ctx = this._ctx;

    // Set canvas dimensions (synced with drawing, like radar.js)
    const rect = this._canvas.getBoundingClientRect();
    const newW = Math.round(rect.width * this._dpr);
    const newH = Math.round(rect.height * this._dpr);
    if (newW !== this._lastW || newH !== this._lastH) {
      this._canvas.width = newW;
      this._canvas.height = newH;
      this._lastW = newW;
      this._lastH = newH;
      ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    }

    // Use CSS dimensions (canvas pixels / DPR) since transform scales by DPR
    const w = rect.width;
    const h = rect.height;

    // Store for use in draw functions
    this._pauseBreaks = pauseBreaks;

    // Clear canvas
    ctx.fillStyle = COLOURS.background;
    ctx.fillRect(0, 0, w, h);

    // Calculate drawing area (leave margins for dual Y-axis)
    const margin = { left: 36, right: 32, top: 8, bottom: 20 };
    const plotW = w - margin.left - margin.right;
    const plotH = h - margin.top - margin.bottom;

    if (plotW < 10 || plotH < 10) return;

    // Draw grid with dual Y-axis (LUFS left, dBTP right)
    this._drawGrid(ctx, margin, plotW, plotH);

    // Draw target tolerance band
    this._drawTargetBand(ctx, margin, plotW, plotH);

    // Draw history data (layer order: S area, M line, I line, TP line)
    // Only draw visible traces
    if (this._history.length > 1) {
      if (this._visible.s) this._drawShortTermArea(ctx, margin, plotW, plotH);   // Green area (bottom)
      if (this._visible.m) this._drawMomentaryLine(ctx, margin, plotW, plotH);   // Orange line
      if (this._visible.i) this._drawIntegratedLine(ctx, margin, plotW, plotH);  // Yellow line
      if (this._visible.tp) this._drawTruePeakLine(ctx, margin, plotW, plotH);   // Cyan dashed (top)
    }

    // Draw target line
    this._drawTargetLine(ctx, margin, plotW, plotH);

    // Legend is now rendered as HTML toggle buttons
  }

  /**
   * Dispose and clean up.
   */
  dispose() {
    this._history = [];
    this._ctx = null;
    this._canvas = null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE
  // ═══════════════════════════════════════════════════════════════════════════

  /** @private */
  _setupCanvas() {
    // Initial canvas setup - dimensions updated in render() for smooth resize
    const rect = this._canvas.getBoundingClientRect();
    this._lastW = Math.round(rect.width * this._dpr);
    this._lastH = Math.round(rect.height * this._dpr);
    this._canvas.width = this._lastW;
    this._canvas.height = this._lastH;
    this._ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    // No ResizeObserver needed - render() handles dimension updates
  }

  /** @private - Prune samples older than duration using efficient binary search */
  _pruneHistory() {
    const cutoff = Date.now() - (this._duration * 1000);
    // Uses O(log n) binary search + single splice instead of O(n²) shift loop
    if (needsPruning(this._history, cutoff, 't')) {
      pruneHistory(this._history, cutoff, 't');
    }
  }

  /** @private - Map LUFS to Y coordinate (left axis) */
  _lufsToY(lufs, plotH, marginTop) {
    // Clamp to range
    const clamped = Math.max(LUFS_MIN, Math.min(LUFS_MAX, lufs));
    // Map to Y coordinate (inverted: high LUFS = top)
    const ratio = (clamped - LUFS_MIN) / LUFS_RANGE;
    return marginTop + plotH * (1 - ratio);
  }

  /** @private - Map dBTP to Y coordinate (right axis) */
  _tpToY(dbtp, plotH, marginTop) {
    // Clamp to range
    const clamped = Math.max(TP_MIN, Math.min(TP_MAX, dbtp));
    // Map to Y coordinate (inverted: high dBTP = top)
    const ratio = (clamped - TP_MIN) / TP_RANGE;
    return marginTop + plotH * (1 - ratio);
  }

  /** @private */
  _timeToX(timestamp, now, plotW, marginLeft) {
    const age = now - timestamp;
    const maxAge = this._duration * 1000;
    // Newer samples on right, older on left
    const ratio = 1 - (age / maxAge);
    return marginLeft + plotW * ratio;
  }

  /**
   * Check if a line segment crosses any pause boundary.
   * @private
   * @param {number} newerTs - Timestamp of newer (right) point
   * @param {number} olderTs - Timestamp of older (left) point
   * @returns {boolean} True if segment crosses a pause boundary
   */
  _crossesPauseBoundary(newerTs, olderTs) {
    if (!this._pauseBreaks || this._pauseBreaks.length === 0) return false;
    // A segment crosses if: newerTs > pauseTs && olderTs <= pauseTs
    for (const pauseTs of this._pauseBreaks) {
      if (newerTs > pauseTs && olderTs <= pauseTs) {
        return true;
      }
    }
    return false;
  }

  /** @private */
  _drawGrid(ctx, margin, plotW, plotH) {
    ctx.strokeStyle = COLOURS.grid;
    ctx.lineWidth = 1;
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillStyle = COLOURS.text;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    // Left Y-axis: LUFS scale (every 6 LU)
    const labelGap = 10;  // Gap between labels and meter edge
    for (let lufs = LUFS_MIN; lufs <= LUFS_MAX; lufs += 6) {
      const y = this._lufsToY(lufs, plotH, margin.top);

      ctx.beginPath();
      ctx.moveTo(margin.left, y);
      ctx.lineTo(margin.left + plotW, y);
      ctx.stroke();

      // Left Y-axis label (LUFS)
      ctx.fillStyle = COLOURS.text;
      ctx.textAlign = 'right';
      ctx.fillText(`${lufs}`, margin.left - labelGap, y);
    }

    // Right Y-axis: dBTP scale (key values)
    ctx.textAlign = 'left';
    const tpMarks = [-36, -24, -12, -6, -3, 0, 3];
    for (const dbtp of tpMarks) {
      const y = this._tpToY(dbtp, plotH, margin.top);

      // Right Y-axis label (dBTP) - cyan tint
      ctx.fillStyle = COLOURS.truePeak;
      ctx.globalAlpha = 0.6;
      // Add space before 0 to align with +/- signs
      const sign = dbtp > 0 ? '+' : dbtp === 0 ? ' ' : '';
      ctx.fillText(`${sign}${dbtp}`, margin.left + plotW + labelGap, y);
    }
    ctx.globalAlpha = 1;

    // Time markers (every minute for durations > 2 min, else every 30s)
    const interval = this._duration > 120 ? 60 : 30;
    ctx.fillStyle = COLOURS.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const now = Date.now();
    for (let t = 0; t <= this._duration; t += interval) {
      const x = margin.left + plotW * (1 - t / this._duration);

      ctx.beginPath();
      ctx.moveTo(x, margin.top);
      ctx.lineTo(x, margin.top + plotH);
      ctx.stroke();

      // X-axis label
      if (t === 0) {
        ctx.fillText('Now', x, margin.top + plotH + 4);
      } else {
        const label = t >= 60 ? `−${Math.floor(t / 60)}m` : `−${t}s`;
        ctx.fillText(label, x, margin.top + plotH + 4);
      }
    }
  }

  /** @private */
  _drawTargetBand(ctx, margin, plotW, plotH) {
    const yTop = this._lufsToY(this._target + this._tolerance, plotH, margin.top);
    const yBottom = this._lufsToY(this._target - this._tolerance, plotH, margin.top);

    ctx.fillStyle = COLOURS.targetArea;
    ctx.fillRect(margin.left, yTop, plotW, yBottom - yTop);
  }

  /** @private */
  _drawTargetLine(ctx, margin, plotW, plotH) {
    const y = this._lufsToY(this._target, plotH, margin.top);

    ctx.strokeStyle = COLOURS.target;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(margin.left + plotW, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** @private */
  _drawShortTermArea(ctx, margin, plotW, plotH) {
    if (this._history.length < 2) return;

    const now = Date.now();
    const baseline = this._lufsToY(LUFS_MIN, plotH, margin.top);

    ctx.fillStyle = COLOURS.shortTerm;
    ctx.strokeStyle = COLOURS.shortTermStroke;
    ctx.lineWidth = 1.5;

    // Build segments separated by pause boundaries
    let segmentStart = null;
    let segmentPoints = [];

    const flushSegment = () => {
      if (segmentPoints.length < 2) {
        segmentPoints = [];
        segmentStart = null;
        return;
      }
      ctx.beginPath();
      ctx.moveTo(segmentPoints[0].x, baseline);
      for (const pt of segmentPoints) {
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.lineTo(segmentPoints[segmentPoints.length - 1].x, baseline);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      segmentPoints = [];
      segmentStart = null;
    };

    for (let i = 0; i < this._history.length; i++) {
      const sample = this._history[i];
      if (sample.st < -99) continue; // Skip invalid samples

      const x = this._timeToX(sample.t, now, plotW, margin.left);
      const y = this._lufsToY(sample.st, plotH, margin.top);

      // Check if this segment crosses a pause boundary
      if (segmentStart !== null && this._crossesPauseBoundary(sample.t, segmentStart)) {
        flushSegment();
      }

      segmentPoints.push({ x, y });
      segmentStart = sample.t;
    }

    // Flush remaining segment
    flushSegment();
  }

  /** @private */
  _drawIntegratedLine(ctx, margin, plotW, plotH) {
    if (this._history.length < 2) return;

    const now = Date.now();

    ctx.strokeStyle = COLOURS.integrated;
    ctx.lineWidth = 2;

    ctx.beginPath();
    let prevTs = null;

    for (const sample of this._history) {
      if (sample.i < -99) continue; // Skip invalid samples

      const x = this._timeToX(sample.t, now, plotW, margin.left);
      const y = this._lufsToY(sample.i, plotH, margin.top);

      // Use moveTo if first point or if crossing pause boundary (creates gap)
      if (prevTs === null || this._crossesPauseBoundary(sample.t, prevTs)) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      prevTs = sample.t;
    }

    ctx.stroke();
  }

  /** @private - Draw Momentary line (orange) */
  _drawMomentaryLine(ctx, margin, plotW, plotH) {
    if (this._history.length < 2) return;

    const now = Date.now();

    ctx.strokeStyle = COLOURS.momentary;
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    let prevTs = null;

    for (const sample of this._history) {
      if (sample.m < -99) continue; // Skip invalid samples

      const x = this._timeToX(sample.t, now, plotW, margin.left);
      const y = this._lufsToY(sample.m, plotH, margin.top);

      // Use moveTo if first point or if crossing pause boundary (creates gap)
      if (prevTs === null || this._crossesPauseBoundary(sample.t, prevTs)) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      prevTs = sample.t;
    }

    ctx.stroke();
  }

  /** @private - Draw True Peak line (cyan dashed, uses TP scale) */
  _drawTruePeakLine(ctx, margin, plotW, plotH) {
    if (this._history.length < 2) return;

    const now = Date.now();

    ctx.strokeStyle = COLOURS.truePeak;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 3]);

    ctx.beginPath();
    let prevTs = null;

    for (const sample of this._history) {
      if (sample.tp < -99) continue; // Skip invalid samples

      const x = this._timeToX(sample.t, now, plotW, margin.left);
      // Use TP scale (right Y-axis) for True Peak values
      const y = this._tpToY(sample.tp, plotH, margin.top);

      // Use moveTo if first point or if crossing pause boundary (creates gap)
      if (prevTs === null || this._crossesPauseBoundary(sample.t, prevTs)) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      prevTs = sample.t;
    }

    ctx.stroke();
    ctx.setLineDash([]);
  }

}
