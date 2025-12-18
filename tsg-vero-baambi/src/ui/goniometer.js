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
 * M/S GONIOMETER (VECTORSCOPE)
 * ═══════════════════════════════════════════════════════════════════════════════
 * Lissajous-style stereo phase display in the Mid/Side domain.
 * Visual gain calibrated so −18 dBFS mono tone reaches ~70% of radius,
 * matching RTW, DK-Audio, and TC Electronic hardware implementations.
 *
 * Coordinate system (DK/RTW convention):
 *   Y-axis (vertical)   = Mid   = (L+R)/√2  = mono/centre content
 *   X-axis (horizontal) = Side  = (L−R)/√2  = stereo difference
 *
 * Visual interpretation:
 *   • Vertical line       → mono signal (full correlation)
 *   • Horizontal line     → out-of-phase (anti-correlated)
 *   • 45° diagonal (L+)   → hard left
 *   • 45° diagonal (R+)   → hard right
 *   • Circular/elliptical → complex stereo field
 *
 * @module ui/goniometer
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// EXACT from original audio-meters-grid.html line 2369
const VECTORSCOPE_GAIN = 3.5;

/**
 * Goniometer renderer - EXACT extraction from audio-meters-grid.html drawXY()
 */
export class Goniometer {
  /**
   * @param {HTMLCanvasElement} canvas - Canvas element (xy)
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
  }

  /**
   * Draw the goniometer with audio samples.
   * EXACT extraction from audio-meters-grid.html lines 2381-2483
   *
   * @param {Float32Array} bufL - Left channel samples
   * @param {Float32Array} bufR - Right channel samples
   * @param {boolean} shouldRender - TransitionGuard.shouldRender() result
   */
  draw(bufL, bufR, shouldRender = true) {
    if (!this.ctx || !this.canvas) return;

    const w = this.canvas.width, h = this.canvas.height;
    if (!w || !h) return;

    const dpr = window.devicePixelRatio || 1;
    const ctx = this.ctx;

    // Clear canvas
    ctx.fillStyle = '#0d0f11';
    ctx.fillRect(0, 0, w, h);

    // Draw samples if TransitionGuard allows
    if (shouldRender && bufL && bufR) {
      const n = Math.min(bufL.length, bufR.length);

      ctx.globalAlpha = 0.85;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(105,191,255,.85)';
      const px = Math.max(1, Math.floor(dpr));

      // Line settings - thicker with round caps
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      let prevX = null, prevY = null;
      for (let i = 0; i < n; i += 2) {
        const L = bufL[i];
        const R = bufR[i];

        // M/S transform (DK/RTW standard)
        const M = 0.5 * (L + R);  // Mid = mono content
        const S = 0.5 * (R - L);  // Side: +S = right, -S = left

        // Map to canvas: X = Side (horizontal), Y = Mid (vertical, inverted)
        const x = (S * VECTORSCOPE_GAIN * w / 2) + w / 2;
        const y = h / 2 - (M * VECTORSCOPE_GAIN * h / 2);

        if (prevX !== null) {
          // Glow layer first (wider, more transparent)
          ctx.globalAlpha = .15;
          ctx.strokeStyle = 'rgba(105,191,255,.5)';
          ctx.lineWidth = 3 * dpr;
          ctx.beginPath();
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(x, y);
          ctx.stroke();

          // Main line (thicker than before)
          ctx.globalAlpha = .35;
          ctx.strokeStyle = 'rgba(105,191,255,.35)';
          ctx.lineWidth = 1.5 * dpr;
          ctx.beginPath();
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
        ctx.globalAlpha = .85;
        ctx.fillRect(x, y, px, px);
        prevX = x; prevY = y;
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // Grid lines: M/S cross + L/R diagonals
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#3a4855';
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Vertical centre line (MONO axis)
    ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
    // Horizontal centre line (SIDE axis)
    ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
    // Diagonal lines (L and R directions)
    ctx.moveTo(0, 0); ctx.lineTo(w, h);      // L direction (top-left to bottom-right)
    ctx.moveTo(w, 0); ctx.lineTo(0, h);      // R direction (top-right to bottom-left)
    ctx.stroke();

    // Axis labels (DK/RTW style)
    const fontSize = Math.round(9 * dpr);
    ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = '#6b7a8a';
    ctx.textBaseline = 'middle';

    // Top row: +L / +M / +R
    const margin = 12 * dpr;
    ctx.textAlign = 'left';
    ctx.fillText('+L', margin, margin);
    ctx.textAlign = 'center';
    ctx.fillText('+M', w / 2, margin);
    ctx.textAlign = 'right';
    ctx.fillText('+R', w - margin, margin);

    // Middle row: –S / +S
    ctx.textAlign = 'left';
    ctx.fillText('–S', margin, h / 2);
    ctx.textAlign = 'right';
    ctx.fillText('+S', w - margin, h / 2);

    // Bottom row: –L / –M / –R
    ctx.textAlign = 'left';
    ctx.fillText('–L', margin, h - margin);
    ctx.textAlign = 'center';
    ctx.fillText('–M', w / 2, h - margin);
    ctx.textAlign = 'right';
    ctx.fillText('–R', w - margin, h - margin);
  }

  /**
   * Draw goniometer from pre-computed M/S point data (for remote metering).
   *
   * This method accepts an array of normalized M/S coordinates, allowing the
   * probe to compute the expensive L→M/S transform and downsample once,
   * then transmit only the essential visualization data.
   *
   * @param {Float32Array|number[]} points - Interleaved [M0,S0, M1,S1, ...] normalized to ±1
   * @param {boolean} shouldRender - TransitionGuard.shouldRender() result
   */
  drawFromPoints(points, shouldRender = true) {
    if (!this.ctx || !this.canvas) return;

    const w = this.canvas.width, h = this.canvas.height;
    if (!w || !h) return;

    const dpr = window.devicePixelRatio || 1;
    const ctx = this.ctx;

    // Clear canvas
    ctx.fillStyle = '#0d0f11';
    ctx.fillRect(0, 0, w, h);

    // Draw points if we have data and should render
    if (shouldRender && points && points.length >= 2) {
      const numPoints = Math.floor(points.length / 2);

      ctx.globalAlpha = 0.85;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(105,191,255,.85)';
      const px = Math.max(1, Math.floor(dpr));

      // Line settings
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      let prevX = null, prevY = null;
      for (let i = 0; i < numPoints; i++) {
        const M = points[i * 2];      // Mid (normalized ±1)
        const S = points[i * 2 + 1];  // Side (normalized ±1)

        // Map to canvas: X = Side (horizontal), Y = Mid (vertical, inverted)
        // Points are already M/S transformed, just apply gain and position
        const x = (S * VECTORSCOPE_GAIN * w / 2) + w / 2;
        const y = h / 2 - (M * VECTORSCOPE_GAIN * h / 2);

        if (prevX !== null) {
          // Glow layer
          ctx.globalAlpha = .15;
          ctx.strokeStyle = 'rgba(105,191,255,.5)';
          ctx.lineWidth = 3 * dpr;
          ctx.beginPath();
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(x, y);
          ctx.stroke();

          // Main line
          ctx.globalAlpha = .35;
          ctx.strokeStyle = 'rgba(105,191,255,.35)';
          ctx.lineWidth = 1.5 * dpr;
          ctx.beginPath();
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
        ctx.globalAlpha = .85;
        ctx.fillRect(x, y, px, px);
        prevX = x; prevY = y;
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // Draw grid and labels (same as draw())
    this._drawGrid(w, h, dpr, ctx);
  }

  /**
   * Draw the static grid overlay (shared between draw() and drawFromPoints())
   * @private
   */
  _drawGrid(w, h, dpr, ctx) {
    // Grid lines: M/S cross + L/R diagonals
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#3a4855';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
    ctx.moveTo(0, 0); ctx.lineTo(w, h);
    ctx.moveTo(w, 0); ctx.lineTo(0, h);
    ctx.stroke();

    // Axis labels
    const fontSize = Math.round(9 * dpr);
    ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = '#6b7a8a';
    ctx.textBaseline = 'middle';

    const margin = 12 * dpr;
    ctx.textAlign = 'left';
    ctx.fillText('+L', margin, margin);
    ctx.textAlign = 'center';
    ctx.fillText('+M', w / 2, margin);
    ctx.textAlign = 'right';
    ctx.fillText('+R', w - margin, margin);

    ctx.textAlign = 'left';
    ctx.fillText('–S', margin, h / 2);
    ctx.textAlign = 'right';
    ctx.fillText('+S', w - margin, h / 2);

    ctx.textAlign = 'left';
    ctx.fillText('–L', margin, h - margin);
    ctx.textAlign = 'center';
    ctx.fillText('–M', w / 2, h - margin);
    ctx.textAlign = 'right';
    ctx.fillText('–R', w - margin, h - margin);
  }

  /**
   * Resize canvas to match element size
   */
  resize() {
    if (!this.canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.floor(rect.width * dpr);
    const h = Math.floor(rect.height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REMOTE GONIOMETER UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pre-compute M/S points from L/R audio buffers for remote transmission.
 * This extracts the essential visualization data at a fraction of the bandwidth.
 *
 * @param {Float32Array} bufL - Left channel samples
 * @param {Float32Array} bufR - Right channel samples
 * @param {number} [numPoints=128] - Number of output points (downsampling)
 * @returns {Float32Array} Interleaved [M0,S0, M1,S1, ...] normalized points
 */
export function computeGoniometerPoints(bufL, bufR, numPoints = 128) {
  const n = Math.min(bufL.length, bufR.length);
  if (n === 0) return new Float32Array(0);

  const output = new Float32Array(numPoints * 2);
  const step = Math.max(1, Math.floor(n / numPoints));

  for (let i = 0; i < numPoints; i++) {
    const idx = Math.min(i * step, n - 1);
    const L = bufL[idx];
    const R = bufR[idx];

    // M/S transform (DK/RTW standard)
    // Must match draw() which uses M = 0.5*(L+R), S = 0.5*(R-L)
    output[i * 2] = 0.5 * (L + R);      // Mid
    output[i * 2 + 1] = 0.5 * (R - L);  // Side
  }

  return output;
}
