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
 * PHASE CORRELATION METER
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * ───────
 * Horizontal bar meter showing stereo phase correlation (-1 to +1).
 * Essential for detecting phase issues in stereo content.
 *
 * INTERPRETATION
 * ──────────────
 *   +1.0: Mono (L = R)
 *   +0.3 to +1.0: Normal stereo (green zone)
 *   -0.3 to +0.3: Wide stereo (amber zone)
 *   -1.0 to -0.3: Out-of-phase (red zone - problem!)
 *   -1.0: Full anti-phase (L = -R)
 *
 * DISPLAY
 * ───────
 * - Center-zero horizontal bar
 * - Fills from center towards +1 (right) or -1 (left)
 * - Color indicates severity of phase issues
 * - Optional peak hold indicator
 *
 * @module ui/correlation-meter
 * @see DK-Audio correlation meter
 * @see RTW phase correlation display
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { getDPR } from '../utils/dom.js';
import { clamp, lerp } from '../utils/math.js';
import { getCorrelationColor, DEFAULT_COLORS } from './colors.js';

// ─────────────────────────────────────────────────────────────────────────────
// CORRELATION METER CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimum correlation value.
 * @type {number}
 */
export const CORR_MIN = -1;

/**
 * Maximum correlation value.
 * @type {number}
 */
export const CORR_MAX = 1;

/**
 * Peak hold time in milliseconds.
 * @type {number}
 */
export const PEAK_HOLD_MS = 2000;

/**
 * Peak fall rate per second.
 * @type {number}
 */
export const PEAK_FALL_RATE = 0.5;

// ─────────────────────────────────────────────────────────────────────────────
// CORRELATION METER CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Phase Correlation Meter renderer.
 *
 * @example
 * const corrMeter = new CorrelationMeter(canvas);
 *
 * // In animation loop:
 * corrMeter.draw(correlationValue);
 */
export class CorrelationMeter {
  /**
   * @param {HTMLCanvasElement} canvas - Canvas element
   * @param {Object} [options] - Configuration options
   * @param {boolean} [options.showPeakHold=true] - Show peak hold indicator
   * @param {boolean} [options.showScale=true] - Show scale labels
   * @param {boolean} [options.vertical=false] - Vertical orientation
   * @param {Object} [options.colors] - Color overrides
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.showPeakHold = options.showPeakHold !== false;
    this.showScale = options.showScale !== false;
    this.vertical = options.vertical || false;
    this.colors = options.colors || DEFAULT_COLORS;

    // Current smoothed value
    this.current = 0;
    this.smoothing = 0.85;

    // Peak hold tracking (tracks minimum, since anti-phase is the problem)
    this.peakMin = 1;
    this.peakMinTime = 0;

    // Cached dimensions
    this.width = 0;
    this.height = 0;
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
  }

  /**
   * Draw the correlation meter with a new value.
   *
   * @param {number} correlation - Correlation coefficient (-1 to +1)
   */
  draw(correlation) {
    if (this.width === 0) this.resize();

    const now = Date.now();
    const dt = 1 / 60;  // Assume 60fps

    // Smooth the input value
    const target = clamp(correlation, CORR_MIN, CORR_MAX);
    this.current = lerp(this.current, target, 1 - this.smoothing);

    // Update peak minimum (tracking anti-phase peaks)
    if (this.current < this.peakMin) {
      this.peakMin = this.current;
      this.peakMinTime = now;
    } else if (now - this.peakMinTime > PEAK_HOLD_MS) {
      // Decay peak towards current
      this.peakMin = Math.min(this.peakMin + PEAK_FALL_RATE * dt, this.current);
    }

    const { ctx, width, height } = this;

    ctx.clearRect(0, 0, width, height);

    if (this.vertical) {
      this._drawVertical();
    } else {
      this._drawHorizontal();
    }
  }

  /**
   * Reset peak hold.
   */
  resetPeak() {
    this.peakMin = 1;
    this.peakMinTime = 0;
  }

  /**
   * @private
   */
  _drawHorizontal() {
    const { ctx, width, height, current, peakMin, colors, showScale, showPeakHold } = this;

    // Layout
    const padding = Math.floor(width * 0.02);
    const scaleHeight = showScale ? Math.floor(height * 0.25) : 0;
    const barHeight = height - scaleHeight - padding * 2;
    const barY = padding;
    const barWidth = width - padding * 2;
    const barX = padding;
    const centerX = barX + barWidth / 2;

    // Background
    ctx.save();
    ctx.fillStyle = '#0f1214';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barWidth, barHeight, 3);
    ctx.fill();

    // Color zones (background hints)
    this._drawZones(barX, barY, barWidth, barHeight, false);

    // Center line
    ctx.fillStyle = '#4a5568';
    ctx.fillRect(centerX - 1, barY, 2, barHeight);

    // Draw correlation bar from center
    const valueWidth = Math.abs(current) * (barWidth / 2);
    const color = getCorrelationColor(current, colors);

    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 4;

    if (current >= 0) {
      // Positive: fill from center to right
      ctx.fillRect(centerX, barY + 2, valueWidth, barHeight - 4);
    } else {
      // Negative: fill from center to left
      ctx.fillRect(centerX - valueWidth, barY + 2, valueWidth, barHeight - 4);
    }

    ctx.shadowBlur = 0;

    // Peak hold indicator
    if (showPeakHold && peakMin < 0.9) {
      const peakX = centerX + (peakMin * barWidth / 2);
      ctx.fillStyle = getCorrelationColor(peakMin, colors);
      ctx.globalAlpha = 0.8;
      ctx.fillRect(peakX - 1, barY, 3, barHeight);
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    // Scale labels
    if (showScale) {
      this._drawHorizontalScale(barX, barY + barHeight + 4, barWidth);
    }
  }

  /**
   * @private
   */
  _drawVertical() {
    const { ctx, width, height, current, peakMin, colors, showScale, showPeakHold } = this;

    // Layout
    const padding = Math.floor(height * 0.02);
    const scaleWidth = showScale ? Math.floor(width * 0.25) : 0;
    const barWidth = width - scaleWidth - padding * 2;
    const barX = padding;
    const barHeight = height - padding * 2;
    const barY = padding;
    const centerY = barY + barHeight / 2;

    // Background
    ctx.save();
    ctx.fillStyle = '#0f1214';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barWidth, barHeight, 3);
    ctx.fill();

    // Color zones
    this._drawZones(barX, barY, barWidth, barHeight, true);

    // Center line
    ctx.fillStyle = '#4a5568';
    ctx.fillRect(barX, centerY - 1, barWidth, 2);

    // Draw correlation bar from center
    const valueHeight = Math.abs(current) * (barHeight / 2);
    const color = getCorrelationColor(current, colors);

    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 4;

    if (current >= 0) {
      // Positive: fill from center upward
      ctx.fillRect(barX + 2, centerY - valueHeight, barWidth - 4, valueHeight);
    } else {
      // Negative: fill from center downward
      ctx.fillRect(barX + 2, centerY, barWidth - 4, valueHeight);
    }

    ctx.shadowBlur = 0;

    // Peak hold indicator
    if (showPeakHold && peakMin < 0.9) {
      const peakY = centerY - (peakMin * barHeight / 2);
      ctx.fillStyle = getCorrelationColor(peakMin, colors);
      ctx.globalAlpha = 0.8;
      ctx.fillRect(barX, peakY - 1, barWidth, 3);
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    // Scale labels
    if (showScale) {
      this._drawVerticalScale(barX + barWidth + 4, barY, barHeight);
    }
  }

  /**
   * @private
   */
  _drawZones(x, y, width, height, vertical) {
    const { ctx, colors } = this;

    ctx.save();
    ctx.globalAlpha = 0.15;

    if (vertical) {
      const thirdH = height / 3;
      // Top third (positive) - green
      ctx.fillStyle = colors.ok;
      ctx.fillRect(x, y, width, thirdH);
      // Middle third - amber
      ctx.fillStyle = colors.warn;
      ctx.fillRect(x, y + thirdH, width, thirdH);
      // Bottom third (negative) - red
      ctx.fillStyle = colors.hot;
      ctx.fillRect(x, y + thirdH * 2, width, thirdH);
    } else {
      const thirdW = width / 3;
      // Left third (negative) - red
      ctx.fillStyle = colors.hot;
      ctx.fillRect(x, y, thirdW, height);
      // Middle third - amber
      ctx.fillStyle = colors.warn;
      ctx.fillRect(x + thirdW, y, thirdW, height);
      // Right third (positive) - green
      ctx.fillStyle = colors.ok;
      ctx.fillRect(x + thirdW * 2, y, thirdW, height);
    }

    ctx.restore();
  }

  /**
   * @private
   */
  _drawHorizontalScale(x, y, width) {
    const { ctx, width: canvasWidth } = this;

    ctx.save();

    const fontSize = Math.max(9, Math.floor(canvasWidth * 0.022));
    ctx.font = `500 ${fontSize}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#9ca3af';

    const labels = [
      { value: -1, label: '-1' },
      { value: -0.5, label: '' },
      { value: 0, label: '0' },
      { value: 0.5, label: '' },
      { value: 1, label: '+1' }
    ];

    labels.forEach(({ value, label }) => {
      if (!label) return;

      const posX = x + ((value + 1) / 2) * width;

      if (value === -1) {
        ctx.textAlign = 'left';
      } else if (value === 1) {
        ctx.textAlign = 'right';
      } else {
        ctx.textAlign = 'center';
      }

      ctx.fillText(label, posX, y);
    });

    ctx.restore();
  }

  /**
   * @private
   */
  _drawVerticalScale(x, y, height) {
    const { ctx, height: canvasHeight } = this;

    ctx.save();

    const fontSize = Math.max(9, Math.floor(canvasHeight * 0.022));
    ctx.font = `500 ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9ca3af';

    const labels = [
      { value: 1, label: '+1' },
      { value: 0, label: '0' },
      { value: -1, label: '-1' }
    ];

    labels.forEach(({ value, label }) => {
      const posY = y + ((1 - value) / 2) * height;

      if (value === 1) {
        ctx.textBaseline = 'top';
      } else if (value === -1) {
        ctx.textBaseline = 'bottom';
      } else {
        ctx.textBaseline = 'middle';
      }

      ctx.fillText(label, x, posY);
    });

    ctx.restore();
  }

  /**
   * Set smoothing factor.
   *
   * @param {number} smoothing - Smoothing factor (0 = none, 0.99 = heavy)
   */
  setSmoothing(smoothing) {
    this.smoothing = clamp(smoothing, 0, 0.99);
  }

  /**
   * Dispose and clean up.
   */
  dispose() {
    this.canvas = null;
    this.ctx = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BALANCE METER CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * L/R Balance Meter renderer.
 * Similar to correlation meter but shows level balance between channels.
 *
 * @example
 * const balanceMeter = new BalanceMeter(canvas);
 *
 * // In animation loop (balance in dB, negative = left, positive = right):
 * balanceMeter.draw(balanceDb);
 */
export class BalanceMeter {
  /**
   * @param {HTMLCanvasElement} canvas - Canvas element
   * @param {Object} [options] - Configuration options
   * @param {number} [options.range=12] - Maximum deviation in dB
   * @param {boolean} [options.showScale=true] - Show scale labels
   * @param {Object} [options.colors] - Color overrides
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.range = options.range ?? 12;
    this.showScale = options.showScale !== false;
    this.colors = options.colors || DEFAULT_COLORS;

    // Current smoothed value
    this.current = 0;
    this.smoothing = 0.8;

    // Cached dimensions
    this.width = 0;
    this.height = 0;
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
  }

  /**
   * Draw the balance meter.
   *
   * @param {number} balanceDb - Balance deviation in dB (negative = left, positive = right)
   */
  draw(balanceDb) {
    if (this.width === 0) this.resize();

    const { ctx, width, height, range, colors, showScale, smoothing } = this;

    // Smooth the input
    const target = clamp(balanceDb, -range, range);
    this.current = lerp(this.current, target, 1 - smoothing);

    ctx.clearRect(0, 0, width, height);

    // Layout
    const padding = Math.floor(width * 0.02);
    const scaleHeight = showScale ? Math.floor(height * 0.3) : 0;
    const barHeight = height - scaleHeight - padding * 2;
    const barY = padding;
    const barWidth = width - padding * 2;
    const barX = padding;
    const centerX = barX + barWidth / 2;

    ctx.save();

    // Background
    ctx.fillStyle = '#0f1214';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barWidth, barHeight, 3);
    ctx.fill();

    // Center marker (0 dB)
    ctx.fillStyle = '#4a5568';
    ctx.fillRect(centerX - 1, barY, 2, barHeight);

    // Tick marks at ±3, ±6 dB
    ctx.strokeStyle = '#3a4048';
    ctx.lineWidth = 1;
    [3, 6, 9].forEach(db => {
      const offset = (db / range) * (barWidth / 2);
      ctx.beginPath();
      ctx.moveTo(centerX + offset, barY + barHeight - 4);
      ctx.lineTo(centerX + offset, barY + barHeight);
      ctx.moveTo(centerX - offset, barY + barHeight - 4);
      ctx.lineTo(centerX - offset, barY + barHeight);
      ctx.stroke();
    });

    // Balance bar
    const deviation = Math.abs(this.current);
    const valueWidth = (deviation / range) * (barWidth / 2);

    // Color based on deviation
    let color;
    if (deviation < 1.5) {
      color = colors.ok;
    } else if (deviation < 3) {
      color = colors.cyan;
    } else if (deviation < 6) {
      color = colors.warn;
    } else {
      color = colors.hot;
    }

    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 3;

    if (this.current >= 0) {
      ctx.fillRect(centerX, barY + 2, valueWidth, barHeight - 4);
    } else {
      ctx.fillRect(centerX - valueWidth, barY + 2, valueWidth, barHeight - 4);
    }

    ctx.shadowBlur = 0;
    ctx.restore();

    // Scale labels
    if (showScale) {
      ctx.save();

      const fontSize = Math.max(9, Math.floor(width * 0.022));
      ctx.font = `500 ${fontSize}px system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#9ca3af';

      const labelY = barY + barHeight + 4;

      ctx.textAlign = 'left';
      ctx.fillText('L', barX, labelY);

      ctx.textAlign = 'center';
      ctx.fillText('C', centerX, labelY);

      ctx.textAlign = 'right';
      ctx.fillText('R', barX + barWidth, labelY);

      ctx.restore();
    }
  }

  /**
   * Dispose and clean up.
   */
  dispose() {
    this.canvas = null;
    this.ctx = null;
  }
}
