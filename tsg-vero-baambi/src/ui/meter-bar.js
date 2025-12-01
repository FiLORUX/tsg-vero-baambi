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
 * HORIZONTAL METER BAR RENDERER
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * ───────
 * LED-style horizontal bar meters for broadcast displays.
 * Supports dBFS, True Peak (dBTP), and PPM scales with proper color zones.
 *
 * VISUAL STYLE
 * ────────────
 * - Discrete LED cells with gaps (RTW/DK-Audio style)
 * - Color zones based on level (green → amber → red)
 * - Peak hold indicator with glow effect
 * - High-DPI aware rendering
 *
 * @module ui/meter-bar
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { getDPR } from '../utils/dom.js';
import { clamp, mapRange } from '../utils/math.js';
import { DEFAULT_COLORS } from './colours.js';

// ─────────────────────────────────────────────────────────────────────────────
// METER CONFIGURATIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * dBFS meter configuration.
 * Range: -60 to 0 dBFS
 */
export const DBFS_CONFIG = {
  minDb: -60,
  maxDb: 0,
  cellCount: 120,
  cellsPerDb: 2,
  getColor: (db, colors = DEFAULT_COLORS) => colors.ok,
  referenceDb: null
};

/**
 * True Peak meter configuration.
 * Range: -60 to +3 dBTP (126 cells at 0.5dB resolution)
 */
export const TRUE_PEAK_CONFIG = {
  minDb: -60,
  maxDb: 3,
  cellCount: 126,
  cellsPerDb: 2,
  getColor: (db, colors = DEFAULT_COLORS) => {
    if (db >= 0) return '#ff2020';        // Above 0 dBTP: bright red
    if (db >= -1) return colors.hot;       // -1 to 0: red
    if (db >= -3) return colors.caution;   // -3 to -1: orange
    if (db >= -6) return colors.warn;      // -6 to -3: amber
    return colors.ok;                       // Below -6: green
  },
  getPeakColor: (db, colors = DEFAULT_COLORS) => {
    if (db >= 0) return '#ff4040';
    if (db >= -1) return '#ff6b5b';
    if (db >= -3) return '#ffb74d';
    if (db >= -6) return '#ffe066';
    return '#7dff7d';
  },
  referenceDb: 0,
  referenceColor: 'hot'
};

/**
 * Nordic PPM meter configuration.
 * Range: -54 to -9 dBFS (corresponds to -36 to +9 PPM)
 */
export const PPM_CONFIG = {
  minDb: -54,
  maxDb: -9,
  cellCount: 90,
  cellsPerDb: 2,
  getColor: (dbfs, colors = DEFAULT_COLORS) => {
    const ppm = dbfs + 18;  // dBFS to PPM conversion
    if (ppm >= 6) return colors.hot;       // +6 to +9: red (over)
    if (ppm >= 0) return colors.caution;   // 0 to +6: amber (nominal)
    return colors.ok;                       // Below 0: green
  },
  referenceDb: -18,  // 0 PPM = -18 dBFS
  referenceColor: 'cyan'
};

// ─────────────────────────────────────────────────────────────────────────────
// METER BAR CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Horizontal LED-style meter bar renderer.
 *
 * @example
 * const meter = new MeterBar(canvas, TRUE_PEAK_CONFIG);
 *
 * // In animation loop:
 * meter.render({
 *   left: -12.5,
 *   right: -14.2,
 *   peakLeft: -6.3,
 *   peakRight: -8.1
 * });
 */
export class MeterBar {
  /**
   * @param {HTMLCanvasElement} canvas - Canvas element to render to
   * @param {Object} config - Meter configuration (e.g., TRUE_PEAK_CONFIG)
   * @param {Object} [options] - Additional options
   * @param {Object} [options.colors] - Color overrides
   * @param {number} [options.barHeight=0.12] - Bar height as fraction of canvas
   * @param {number} [options.gap=1] - Gap between LED cells in pixels
   */
  constructor(canvas, config, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.config = config;

    this.colors = options.colors || DEFAULT_COLORS;
    this.barHeightRatio = options.barHeight || 0.12;
    this.gapPx = options.gap ?? 1;

    // Cached dimensions
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.cellWidth = 0;
    this.cellGap = 0;
    this.barHeight = 0;
  }

  /**
   * Update canvas size for high-DPI.
   * Call on resize.
   */
  resize() {
    this.dpr = getDPR();
    const rect = this.canvas.getBoundingClientRect();

    this.width = Math.floor(rect.width * this.dpr);
    this.height = Math.floor(rect.height * this.dpr);

    if (this.canvas.width !== this.width || this.canvas.height !== this.height) {
      this.canvas.width = this.width;
      this.canvas.height = this.height;
    }

    // Calculate cell dimensions
    this.cellGap = Math.max(1, Math.round(this.gapPx * this.dpr));
    this.cellWidth = (this.width - this.cellGap * (this.config.cellCount - 1)) / this.config.cellCount;
    this.barHeight = Math.round(this.height * this.barHeightRatio);
  }

  /**
   * Render the meter bars.
   *
   * @param {Object} values - Current meter values
   * @param {number} values.left - Left channel level in dB
   * @param {number} values.right - Right channel level in dB
   * @param {number} [values.peakLeft] - Left peak hold in dB
   * @param {number} [values.peakRight] - Right peak hold in dB
   */
  render({ left, right, peakLeft, peakRight }) {
    // Ensure dimensions are current
    if (this.width === 0) this.resize();

    const { ctx, width, height, config } = this;

    // Clear
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0e151a';
    ctx.fillRect(0, 0, width, height);

    // Draw channels
    const yTop = height * 0.35;
    const yBottom = height * 0.55;

    this._drawChannel(yTop, left, peakLeft);
    this._drawChannel(yBottom, right, peakRight);

    // Draw reference line if configured
    if (config.referenceDb !== null) {
      this._drawReferenceLine(config.referenceDb, config.referenceColor);
    }
  }

  /**
   * Draw a single channel bar.
   * @private
   */
  _drawChannel(yTop, value, peakHold) {
    const { ctx, config, cellWidth, cellGap, barHeight, colors, dpr } = this;
    const { minDb, maxDb, cellCount, getColor, getPeakColor } = config;

    const displayDb = clamp(value, minDb, maxDb);
    const dbPerCell = (maxDb - minDb) / cellCount;

    // Calculate peak cell
    const peakCell = peakHold !== undefined
      ? clamp(Math.round((peakHold - minDb) / dbPerCell), 0, cellCount - 1)
      : -1;

    for (let cell = 0; cell < cellCount; cell++) {
      const cellDb = minDb + cell * dbPerCell;
      const cellX = cell * (cellWidth + cellGap);
      const color = getColor(cellDb + dbPerCell / 2, colors);

      // Background (dimmed)
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = color;
      ctx.fillRect(cellX, yTop, cellWidth, barHeight);

      // Active cell
      if (cellDb < displayDb) {
        // Extra emphasis for cells above 0 dBTP (if True Peak)
        if (cellDb >= 0 && config === TRUE_PEAK_CONFIG) {
          ctx.globalAlpha = 1.0;
          ctx.shadowColor = '#ff2020';
          ctx.shadowBlur = 6 * dpr;
        } else {
          ctx.globalAlpha = 0.9;
          ctx.shadowBlur = 0;
        }
        ctx.fillStyle = color;
        ctx.fillRect(cellX, yTop, cellWidth, barHeight);
        ctx.shadowBlur = 0;
      }
    }

    // Peak hold indicator
    if (peakCell >= 0 && peakHold > minDb) {
      const peakCellDb = minDb + peakCell * dbPerCell;
      const cellX = peakCell * (cellWidth + cellGap);
      const peakColor = getPeakColor
        ? getPeakColor(peakCellDb, colors)
        : getColor(peakCellDb, colors);

      ctx.globalAlpha = 1;
      ctx.shadowColor = peakColor;
      ctx.shadowBlur = (peakCellDb >= 0) ? 8 * dpr : 4 * dpr;
      ctx.fillStyle = peakColor;
      ctx.fillRect(cellX, yTop, cellWidth, barHeight);
      ctx.shadowBlur = 0;
    }

    ctx.globalAlpha = 1;
  }

  /**
   * Draw reference line.
   * @private
   */
  _drawReferenceLine(refDb, colorKey) {
    const { ctx, width, height, config, colors, dpr } = this;
    const { minDb, maxDb } = config;

    const x = mapRange(refDb, minDb, maxDb, 0, width);

    ctx.globalAlpha = 0.95;
    ctx.fillStyle = colors[colorKey] || colors.hot;
    ctx.fillRect(Math.round(x) - 1, height * 0.25, 2, height * 0.5);
    ctx.globalAlpha = 1;
  }

  /**
   * Dispose renderer and release resources.
   */
  dispose() {
    this.canvas = null;
    this.ctx = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEREO METER BAR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convenience class for stereo meter with automatic resize handling.
 *
 * @example
 * const tpMeter = new StereoMeterBar(canvas, 'truePeak');
 *
 * function render() {
 *   tpMeter.draw(tpState.left, tpState.right, tpState.peakHoldL, tpState.peakHoldR);
 *   requestAnimationFrame(render);
 * }
 */
export class StereoMeterBar {
  /**
   * @param {HTMLCanvasElement} canvas - Canvas element
   * @param {'dbfs'|'truePeak'|'ppm'} type - Meter type
   * @param {Object} [options] - Additional options
   */
  constructor(canvas, type = 'truePeak', options = {}) {
    const configs = {
      dbfs: DBFS_CONFIG,
      truePeak: TRUE_PEAK_CONFIG,
      ppm: PPM_CONFIG
    };

    this.meter = new MeterBar(canvas, configs[type] || TRUE_PEAK_CONFIG, options);
    this.resizeObserver = null;

    // Set up resize observer
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.meter.resize();
      });
      this.resizeObserver.observe(canvas);
    }

    // Initial resize
    this.meter.resize();
  }

  /**
   * Draw the meter with current values.
   *
   * @param {number} left - Left channel dB
   * @param {number} right - Right channel dB
   * @param {number} [peakLeft] - Left peak hold dB
   * @param {number} [peakRight] - Right peak hold dB
   */
  draw(left, right, peakLeft, peakRight) {
    this.meter.render({ left, right, peakLeft, peakRight });
  }

  /**
   * Dispose and clean up.
   */
  dispose() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.meter.dispose();
  }
}
