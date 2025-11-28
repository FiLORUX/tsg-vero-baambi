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
 * EBU R128 LOUDNESS RADAR
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * ───────
 * Circular radar display for programme loudness history.
 * Shows short-term loudness over time as colored donut segments.
 * Based on TC Electronic / RTW radar display conventions.
 *
 * VISUAL ELEMENTS
 * ───────────────
 * - Donut chart with loudness history (sweeping clockwise)
 * - Color-coded segments based on deviation from target
 * - Target ring at 0 LU (relative to loudness target)
 * - Grid rings every 6 LU
 * - Momentary level indicator in center
 *
 * SCALE
 * ─────
 * Range: -36 to +9 LU relative to target (45 LU total)
 * Default target: -23 LUFS (EBU R128)
 *
 * @module ui/radar
 * @see EBU Tech 3341 (Loudness metering)
 * @see TC Electronic radar display patents
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { getDPR } from '../utils/dom.js';
import { clamp, degToRad, normalize } from '../utils/math.js';
import { getRadarColor, DEFAULT_COLORS } from './colors.js';

// ─────────────────────────────────────────────────────────────────────────────
// RADAR CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimum LU value on radar (relative to target).
 * @type {number}
 */
export const RADAR_MIN_LU = -36;

/**
 * Maximum LU value on radar (relative to target).
 * @type {number}
 */
export const RADAR_MAX_LU = 9;

/**
 * Total LU range on radar.
 * @type {number}
 */
export const RADAR_RANGE_LU = RADAR_MAX_LU - RADAR_MIN_LU;

/**
 * Default loudness target (EBU R128).
 * @type {number}
 */
export const DEFAULT_TARGET_LUFS = -23;

/**
 * Grid ring interval in LU.
 * @type {number}
 */
export const GRID_INTERVAL_LU = 6;

// ─────────────────────────────────────────────────────────────────────────────
// LOUDNESS RADAR CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * EBU R128 Loudness Radar renderer.
 *
 * @example
 * const radar = new LoudnessRadar(canvas, { target: -23 });
 *
 * // In animation loop:
 * radar.pushValue(shortTermLufs);
 * radar.render(momentaryLufs);
 */
export class LoudnessRadar {
  /**
   * @param {HTMLCanvasElement} canvas - Canvas element
   * @param {Object} [options] - Configuration options
   * @param {number} [options.target=-23] - Target loudness in LUFS
   * @param {number} [options.maxSeconds=60] - History duration in seconds
   * @param {Object} [options.colors] - Color overrides
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.target = options.target ?? DEFAULT_TARGET_LUFS;
    this.maxAge = (options.maxSeconds ?? 60) * 1000;  // Convert to ms
    this.colors = options.colors || DEFAULT_COLORS;

    // History of {t: timestamp, v: lufs} points
    this.history = [];

    // Cached dimensions
    this.width = 0;
    this.height = 0;
    this.cx = 0;
    this.cy = 0;
    this.rOuter = 0;
    this.rInner = 0;
  }

  /**
   * Update canvas dimensions.
   */
  resize() {
    const dpr = getDPR();
    const rect = this.canvas.getBoundingClientRect();

    this.width = Math.floor(rect.width * dpr);
    this.height = Math.floor(rect.height * dpr);

    if (this.canvas.width !== this.width || this.canvas.height !== this.height) {
      this.canvas.width = this.width;
      this.canvas.height = this.height;
    }

    // Calculate radar geometry
    this.cx = this.width / 2;
    this.cy = this.height / 2;
    this.rOuter = Math.min(this.width, this.height) * 0.38;
    this.rInner = this.rOuter * 0.35;
  }

  /**
   * Push a new loudness value to history.
   *
   * @param {number} lufs - Short-term loudness in LUFS
   */
  pushValue(lufs) {
    const now = Date.now();

    // Remove old entries
    while (this.history.length > 0 && now - this.history[0].t > this.maxAge) {
      this.history.shift();
    }

    // Add new entry
    this.history.push({ t: now, v: lufs });
  }

  /**
   * Clear history.
   */
  reset() {
    this.history.length = 0;
  }

  /**
   * Render the radar.
   *
   * @param {number} [momentaryLufs] - Current momentary loudness for center display
   */
  render(momentaryLufs) {
    if (this.width === 0) this.resize();

    const { ctx, width, height, cx, cy, rOuter, rInner } = this;

    ctx.clearRect(0, 0, width, height);

    // Draw layers
    this._drawBackground();
    this._drawSegments();
    this._drawGrid();
    this._drawTargetRing();
    this._drawSweepLine();
    this._drawLabels();

    if (momentaryLufs !== undefined) {
      this._drawCenterValue(momentaryLufs);
    }
  }

  /**
   * Convert LUFS to radius on radar.
   * @private
   */
  _lufsToRadius(lufs) {
    const lu = lufs - this.target;
    const clamped = clamp(lu, RADAR_MIN_LU, RADAR_MAX_LU);
    const t = normalize(clamped, RADAR_MIN_LU, RADAR_MAX_LU);
    return this.rInner + t * (this.rOuter - this.rInner);
  }

  /**
   * @private
   */
  _drawBackground() {
    const { ctx, cx, cy, rOuter, rInner } = this;

    ctx.save();

    // Outer gradient
    const gradient = ctx.createRadialGradient(cx, cy, rInner, cx, cy, rOuter);
    gradient.addColorStop(0, '#0a0c0e');
    gradient.addColorStop(1, '#181c20');

    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, 0, 2 * Math.PI);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = '#2a2f36';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Inner circle
    ctx.beginPath();
    ctx.arc(cx, cy, rInner, 0, 2 * Math.PI);
    ctx.fillStyle = '#0d0f11';
    ctx.fill();
    ctx.strokeStyle = '#1a1e22';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();
  }

  /**
   * @private
   */
  _drawSegments() {
    const { ctx, cx, cy, rOuter, rInner, history, maxAge, target, colors } = this;
    const now = Date.now();

    ctx.save();

    const segmentCount = history.length;
    const anglePerSegment = (2 * Math.PI) / Math.max(segmentCount, 60);
    const FADE_START = 0.85;

    history.forEach((point) => {
      const age = now - point.t;
      if (age < 0 || age > maxAge) return;

      const normalizedAge = age / maxAge;
      const startAngle = (2 * Math.PI * normalizedAge) - Math.PI / 2;
      const endAngle = startAngle + anglePerSegment;

      const lufs = point.v;
      const r = this._lufsToRadius(lufs);
      const color = getRadarColor(lufs, target, colors);

      // Fade out last 15%
      let fadeMultiplier = 1.0;
      if (normalizedAge > FADE_START) {
        fadeMultiplier = 1.0 - (normalizedAge - FADE_START) / (1.0 - FADE_START);
      }
      const opacity = 0.85 * (1 - normalizedAge * 0.2) * Math.max(0, fadeMultiplier);

      // Draw donut segment
      ctx.beginPath();
      ctx.arc(cx, cy, rInner, startAngle, endAngle);
      ctx.arc(cx, cy, r, endAngle, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.globalAlpha = opacity;

      // Glow for fresh segments
      if (normalizedAge < 0.10) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 4 * (1 - normalizedAge / 0.10);
      } else {
        ctx.shadowBlur = 0;
      }

      ctx.fill();
      ctx.shadowBlur = 0;
    });

    ctx.restore();
  }

  /**
   * @private
   */
  _drawGrid() {
    const { ctx, cx, cy, rOuter, rInner, target } = this;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.55;

    // Rings every 6 LU
    for (let lu = RADAR_MIN_LU; lu <= RADAR_MAX_LU; lu += GRID_INTERVAL_LU) {
      if (lu === 0) continue;  // Target ring drawn separately

      const lufs = lu + target;
      const r = this._lufsToRadius(lufs);

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = '#8b95a5';
      ctx.setLineDash([3, 5]);
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // Spokes every 30°
    ctx.setLineDash([]);
    ctx.strokeStyle = '#6b7580';
    ctx.lineWidth = 1.0;

    for (let deg = 0; deg < 360; deg += 30) {
      const a = degToRad(deg - 90);
      ctx.beginPath();
      ctx.moveTo(cx + rInner * Math.cos(a), cy + rInner * Math.sin(a));
      ctx.lineTo(cx + rOuter * Math.cos(a), cy + rOuter * Math.sin(a));
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * @private
   */
  _drawTargetRing() {
    const { ctx, cx, cy, target } = this;
    const r = this._lufsToRadius(target);  // 0 LU

    ctx.save();

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = '#40a0ff';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#40a0ff';
    ctx.shadowBlur = 3;
    ctx.stroke();

    ctx.restore();
  }

  /**
   * @private
   */
  _drawSweepLine() {
    const { ctx, cx, cy, rOuter, rInner, history } = this;

    if (history.length === 0) return;

    const sweepAngle = -Math.PI / 2;  // 12 o'clock

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#69bfff';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#69bfff';
    ctx.shadowBlur = 8;

    ctx.beginPath();
    ctx.moveTo(cx + rInner * Math.cos(sweepAngle), cy + rInner * Math.sin(sweepAngle));
    ctx.lineTo(cx + rOuter * Math.cos(sweepAngle), cy + rOuter * Math.sin(sweepAngle));
    ctx.stroke();

    ctx.restore();
  }

  /**
   * @private
   */
  _drawLabels() {
    const { ctx, cx, cy, rOuter, rInner, width, target } = this;
    const SCALE_LU = [-18, -12, -6, 0, 6];

    ctx.save();

    const fontSize = Math.max(8, Math.floor(width * 0.020));
    ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const labelAngle = 0;  // 3 o'clock

    SCALE_LU.forEach(lu => {
      const lufs = lu + target;
      const r = this._lufsToRadius(lufs);
      const x = cx + r * Math.cos(labelAngle) + 3;
      const y = cy + r * Math.sin(labelAngle);

      if (lu === 0) {
        ctx.fillStyle = '#40a0ff';
        ctx.font = `700 ${fontSize}px system-ui, sans-serif`;
      } else {
        ctx.fillStyle = '#9ca3af';
        ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
      }

      const label = lu > 0 ? `+${lu}` : lu.toString();
      ctx.fillText(label, x, y);
    });

    ctx.restore();
  }

  /**
   * @private
   */
  _drawCenterValue(lufs) {
    const { ctx, cx, cy, rInner, target, colors } = this;

    ctx.save();

    const fontSize = Math.max(14, rInner * 0.35);
    ctx.font = `700 ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (isFinite(lufs)) {
      const color = getRadarColor(lufs, target, colors);
      ctx.fillStyle = color;
      ctx.fillText(lufs.toFixed(1), cx, cy);
    } else {
      ctx.fillStyle = colors.muted;
      ctx.fillText('—', cx, cy);
    }

    ctx.restore();
  }

  /**
   * Dispose and clean up.
   */
  dispose() {
    this.history.length = 0;
    this.canvas = null;
    this.ctx = null;
  }
}
