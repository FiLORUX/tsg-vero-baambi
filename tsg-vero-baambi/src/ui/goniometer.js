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
 * STEREO GONIOMETER / VECTORSCOPE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * ───────
 * M/S (Mid/Side) vectorscope display for stereo imaging analysis.
 * Shows the stereo field as a rotated Lissajous pattern.
 *
 * DISPLAY ORIENTATION
 * ───────────────────
 * - Vertical axis (12 o'clock): M (mono, L+R)
 * - Horizontal axis (3 o'clock): S (side, L-R)
 * - 45° left (10:30): Left channel
 * - 45° right (1:30): Right channel
 *
 * INTERPRETATION
 * ──────────────
 * - Vertical line: Mono signal (L = R)
 * - Horizontal line: Out-of-phase (L = -R)
 * - 45° ellipse: Normal stereo
 * - Wide pattern: Wide stereo image
 * - Collapsed pattern: Narrow/mono-ish
 *
 * @module ui/goniometer
 * @see DK-Audio MSD600 series
 * @see RTW TouchMonitor vectorscope
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { getDPR } from '../utils/dom.js';
import { clamp } from '../utils/math.js';
import { DEFAULT_COLORS } from './colors.js';

// ─────────────────────────────────────────────────────────────────────────────
// GONIOMETER CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rotation angle for M/S display (45° = π/4).
 * Rotates so M (mono) is vertical, S (side) is horizontal.
 * @type {number}
 */
export const MS_ROTATION = Math.PI / 4;

/**
 * Default phosphor decay factor per frame (60fps assumed).
 * 0.92 gives approximately 0.5s decay to 1% brightness.
 * @type {number}
 */
export const DEFAULT_DECAY = 0.92;

/**
 * Number of samples to display per frame.
 * @type {number}
 */
export const DEFAULT_SAMPLE_COUNT = 512;

// ─────────────────────────────────────────────────────────────────────────────
// GONIOMETER CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stereo Goniometer / Vectorscope renderer.
 *
 * @example
 * const gonio = new Goniometer(canvas, { decay: 0.94 });
 *
 * // In animation loop:
 * gonio.draw(leftSamples, rightSamples);
 */
export class Goniometer {
  /**
   * @param {HTMLCanvasElement} canvas - Canvas element
   * @param {Object} [options] - Configuration options
   * @param {number} [options.decay=0.92] - Phosphor decay factor (0-1)
   * @param {number} [options.gain=1] - Display gain multiplier
   * @param {Object} [options.colors] - Color overrides
   * @param {boolean} [options.showGrid=true] - Show grid lines
   * @param {boolean} [options.showLabels=true] - Show L/R/M/S labels
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.decay = options.decay ?? DEFAULT_DECAY;
    this.gain = options.gain ?? 1.0;
    this.colors = options.colors || DEFAULT_COLORS;
    this.showGrid = options.showGrid !== false;
    this.showLabels = options.showLabels !== false;

    // Cached dimensions
    this.width = 0;
    this.height = 0;
    this.cx = 0;
    this.cy = 0;
    this.radius = 0;

    // Phosphor buffer for persistence
    this.phosphorCanvas = null;
    this.phosphorCtx = null;
  }

  /**
   * Update canvas dimensions and create phosphor buffer.
   */
  resize() {
    const dpr = getDPR();
    const rect = this.canvas.getBoundingClientRect();

    this.width = Math.floor(rect.width * dpr);
    this.height = Math.floor(rect.height * dpr);

    if (this.canvas.width !== this.width || this.canvas.height !== this.height) {
      this.canvas.width = this.width;
      this.canvas.height = this.height;

      // Recreate phosphor buffer
      this.phosphorCanvas = document.createElement('canvas');
      this.phosphorCanvas.width = this.width;
      this.phosphorCanvas.height = this.height;
      this.phosphorCtx = this.phosphorCanvas.getContext('2d');
    }

    this.cx = this.width / 2;
    this.cy = this.height / 2;
    this.radius = Math.min(this.width, this.height) * 0.42;
  }

  /**
   * Draw the goniometer with new audio samples.
   *
   * @param {Float32Array} leftSamples - Left channel samples
   * @param {Float32Array} rightSamples - Right channel samples
   */
  draw(leftSamples, rightSamples) {
    if (this.width === 0) this.resize();

    const { ctx, phosphorCtx, width, height, cx, cy, radius, gain, decay } = this;

    // Clear main canvas
    ctx.clearRect(0, 0, width, height);

    // Decay phosphor buffer
    if (phosphorCtx) {
      phosphorCtx.globalCompositeOperation = 'source-over';
      phosphorCtx.fillStyle = `rgba(0, 0, 0, ${1 - decay})`;
      phosphorCtx.fillRect(0, 0, width, height);
    }

    // Draw background
    this._drawBackground();

    // Draw grid
    if (this.showGrid) {
      this._drawGrid();
    }

    // Draw new samples to phosphor
    if (leftSamples && rightSamples && phosphorCtx) {
      this._drawSamples(leftSamples, rightSamples);
    }

    // Composite phosphor to main canvas
    if (this.phosphorCanvas) {
      ctx.drawImage(this.phosphorCanvas, 0, 0);
    }

    // Draw labels on top
    if (this.showLabels) {
      this._drawLabels();
    }
  }

  /**
   * Clear the phosphor buffer.
   */
  clear() {
    if (this.phosphorCtx) {
      this.phosphorCtx.clearRect(0, 0, this.width, this.height);
    }
  }

  /**
   * @private
   */
  _drawBackground() {
    const { ctx, cx, cy, radius } = this;

    ctx.save();

    // Circular background with gradient
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.1);
    gradient.addColorStop(0, '#0a0c0e');
    gradient.addColorStop(0.8, '#0d1014');
    gradient.addColorStop(1, '#181c20');

    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.05, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    // Outer ring
    ctx.strokeStyle = '#2a2f36';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  }

  /**
   * @private
   */
  _drawGrid() {
    const { ctx, cx, cy, radius } = this;

    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth = 1;

    // Concentric circles at 25%, 50%, 75%, 100%
    [0.25, 0.5, 0.75, 1.0].forEach(t => {
      ctx.beginPath();
      ctx.arc(cx, cy, radius * t, 0, Math.PI * 2);
      ctx.setLineDash(t === 1.0 ? [] : [3, 4]);
      ctx.stroke();
    });

    ctx.setLineDash([]);

    // M axis (vertical - mono)
    ctx.beginPath();
    ctx.moveTo(cx, cy - radius);
    ctx.lineTo(cx, cy + radius);
    ctx.strokeStyle = '#6b7280';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // S axis (horizontal - side/difference)
    ctx.beginPath();
    ctx.moveTo(cx - radius, cy);
    ctx.lineTo(cx + radius, cy);
    ctx.stroke();

    // L and R axes (45° diagonals)
    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    // Left channel axis (upper-left to lower-right)
    const lx = radius * Math.cos(MS_ROTATION + Math.PI);
    const ly = radius * Math.sin(MS_ROTATION + Math.PI);
    ctx.beginPath();
    ctx.moveTo(cx + lx, cy + ly);
    ctx.lineTo(cx - lx, cy - ly);
    ctx.stroke();

    // Right channel axis (upper-right to lower-left)
    const rx = radius * Math.cos(-MS_ROTATION);
    const ry = radius * Math.sin(-MS_ROTATION);
    ctx.beginPath();
    ctx.moveTo(cx + rx, cy + ry);
    ctx.lineTo(cx - rx, cy - ry);
    ctx.stroke();

    ctx.restore();
  }

  /**
   * @private
   */
  _drawSamples(leftSamples, rightSamples) {
    const { phosphorCtx, cx, cy, radius, gain, colors } = this;
    const len = Math.min(leftSamples.length, rightSamples.length);

    phosphorCtx.save();

    // Sample points with intensity based on level
    for (let i = 0; i < len; i++) {
      const l = leftSamples[i] * gain;
      const r = rightSamples[i] * gain;

      // Convert to M/S coordinates
      // M = (L + R) / sqrt(2), S = (L - R) / sqrt(2)
      // Then rotate by 45° so M is vertical
      const m = (l + r) * 0.7071;  // 1/sqrt(2)
      const s = (l - r) * 0.7071;

      // Map to screen coordinates
      // M (mono) goes up (negative Y), S (side) goes right (positive X)
      const x = cx + clamp(s, -1, 1) * radius;
      const y = cy - clamp(m, -1, 1) * radius;  // Inverted Y

      // Intensity based on signal level
      const intensity = Math.sqrt(l * l + r * r);
      const alpha = clamp(intensity * 2, 0.3, 1.0);

      // Colour based on instantaneous phase relationship
      // Positive product (L and R same polarity) = green, opposite = red
      const phaseProduct = l * r;
      let color;
      if (phaseProduct >= 0) {
        color = colors.ok;
      } else if (phaseProduct > -0.3) {
        color = colors.warn;
      } else {
        color = colors.hot;
      }

      phosphorCtx.fillStyle = color;
      phosphorCtx.globalAlpha = alpha;
      phosphorCtx.fillRect(x - 1, y - 1, 2, 2);
    }

    phosphorCtx.restore();
  }

  /**
   * @private
   */
  _drawLabels() {
    const { ctx, cx, cy, radius, width } = this;

    ctx.save();

    const fontSize = Math.max(10, Math.floor(width * 0.028));
    ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#9ca3af';

    const labelOffset = radius + fontSize * 1.2;

    // M label (top - mono)
    ctx.fillStyle = '#a0aec0';
    ctx.fillText('M', cx, cy - labelOffset);

    // S label (right - side)
    ctx.fillText('S', cx + labelOffset, cy);

    // L label (upper-left)
    const lAngle = Math.PI * 0.75;  // 135°
    ctx.fillStyle = '#718096';
    ctx.fillText('L', cx + labelOffset * Math.cos(lAngle), cy + labelOffset * Math.sin(lAngle));

    // R label (upper-right)
    const rAngle = Math.PI * 0.25;  // 45°
    ctx.fillText('R', cx + labelOffset * Math.cos(rAngle), cy - labelOffset * Math.sin(rAngle));

    ctx.restore();
  }

  /**
   * Set display gain.
   *
   * @param {number} gain - Gain multiplier (1.0 = 0dB)
   */
  setGain(gain) {
    this.gain = clamp(gain, 0.1, 10);
  }

  /**
   * Set phosphor decay rate.
   *
   * @param {number} decay - Decay factor (0.9 = fast, 0.98 = slow)
   */
  setDecay(decay) {
    this.decay = clamp(decay, 0.8, 0.99);
  }

  /**
   * Dispose and clean up.
   */
  dispose() {
    this.phosphorCanvas = null;
    this.phosphorCtx = null;
    this.canvas = null;
    this.ctx = null;
  }
}
