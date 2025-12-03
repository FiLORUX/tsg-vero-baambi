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
 * Displays Pearson correlation coefficient between L and R channels.
 *   +1.0 = perfect positive correlation (mono, in-phase)
 *    0.0 = uncorrelated (independent stereo)
 *   −1.0 = perfect negative correlation (anti-phase, cancellation risk)
 * Asymmetric ballistics: faster attack (0.25), slower release (0.06) to
 * catch phase issues while providing stable visual indication.
 *
 * @module ui/correlation-meter
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// EXACT from original audio-meters-grid.html line 2500
// Asymmetric ballistics: faster attack, slower release
const corrUp = 0.25;
const corrDn = 0.06;

/**
 * Calculate Pearson correlation coefficient between L and R channels.
 * EXACT from audio-meters-grid.html lines 2485-2489
 * @param {Float32Array} l - Left channel samples
 * @param {Float32Array} r - Right channel samples
 * @returns {number} Correlation coefficient (-1 to +1)
 */
export function corrNow(l, r) {
  let n = Math.min(l.length, r.length), sL = 0, sR = 0;
  for (let i = 0; i < n; i++) { sL += l[i]; sR += r[i]; }
  const mL = sL / n, mR = sR / n;
  let num = 0, dL = 0, dR = 0;
  for (let i = 0; i < n; i++) {
    const L = l[i] - mL, R = r[i] - mR;
    num += L * R; dL += L * L; dR += R * R;
  }
  return num / (Math.sqrt(dL * dR) + 1e-20);
}

/**
 * Phase Correlation Meter - EXACT extraction from audio-meters-grid.html drawCorr()
 */
export class CorrelationMeter {
  /**
   * @param {HTMLCanvasElement} canvas - Canvas element (corr)
   * @param {HTMLElement} corrValEl - Element to display correlation value text
   * @param {Function} getCss - Function to get CSS custom property values
   * @param {Function} formatCorr - Function to format correlation display
   */
  constructor(canvas, corrValEl, getCss, formatCorr) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.corrValEl = corrValEl;
    this.getCss = getCss;
    this.formatCorr = formatCorr;

    // Held correlation value with asymmetric ballistics
    this.corrHold = 0;
  }

  /**
   * Draw the correlation meter.
   * EXACT extraction from audio-meters-grid.html lines 2502-2575
   *
   * @param {Float32Array} bufL - Left channel samples
   * @param {Float32Array} bufR - Right channel samples
   * @param {boolean} shouldRender - TransitionGuard.shouldRender() result
   */
  draw(bufL, bufR, shouldRender = true) {
    if (!this.ctx || !this.canvas) return;

    // Update correlation only if TransitionGuard allows
    if (shouldRender && bufL && bufR) {
      const cRaw = Math.max(-1, Math.min(1, corrNow(bufL, bufR)));
      // Asymmetric ballistics: faster attack, slower release
      this.corrHold = cRaw > this.corrHold
        ? this.corrHold + corrUp * (cRaw - this.corrHold)
        : this.corrHold + corrDn * (cRaw - this.corrHold);
    }
    // Always render the current held value (smooth during blanking)

    // Update canvas size based on actual element size
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.floor(rect.width * dpr);
    const h = Math.floor(rect.height * dpr);

    if (w < 10 || h < 10) return; // Skip if too small

    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.canvas.style.width = `${rect.width}px`;
      this.canvas.style.height = `${rect.height}px`;
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    // Horizontal correlation bar layout
    const padding = 8 * dpr;
    const barH = Math.max(12 * dpr, h * 0.4);
    const barY = (h - barH) / 2;
    const barX = padding;
    const barW = w - padding * 2;

    // Background track
    ctx.fillStyle = '#0f1214';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.strokeStyle = '#3a4855';
    ctx.strokeRect(barX, barY, barW, barH);

    // Center line (0 position)
    const centerX = barX + barW / 2;
    ctx.fillStyle = '#4b5563';
    ctx.fillRect(centerX - 1, barY - 4 * dpr, 2, barH + 8 * dpr);

    // RTW-style colour zones for correlation
    const col = (this.corrHold < -0.3)
      ? this.getCss('--hot')
      : (this.corrHold >= 0.3 ? this.getCss('--ok') : this.getCss('--warn'));

    // Fill from center based on correlation value
    // -1 = full left, 0 = center, +1 = full right
    const fillX = centerX + (this.corrHold * barW / 2);
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.85;
    if (this.corrHold >= 0) {
      ctx.fillRect(centerX, barY + 2, fillX - centerX, barH - 4);
    } else {
      ctx.fillRect(fillX, barY + 2, centerX - fillX, barH - 4);
    }
    ctx.globalAlpha = 1;

    // Scale labels
    ctx.font = `${Math.round(9 * dpr)}px ui-sans-serif`;
    ctx.fillStyle = '#88a3bf';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    // -1, 0, +1 labels
    const labelY = barY + barH + 10 * dpr;
    ctx.fillText('-1', barX + 10 * dpr, labelY);
    ctx.fillText('0', centerX, labelY);
    ctx.fillText('+1', barX + barW - 10 * dpr, labelY);

    // Update value display element
    if (this.corrValEl && this.formatCorr) {
      this.corrValEl.textContent = this.formatCorr(this.corrHold);
    }
  }

  /**
   * Draw the correlation meter with a pre-calculated value.
   * Used for remote metering where correlation is computed remotely.
   *
   * @param {number} correlation - Pre-calculated correlation value (-1 to +1)
   * @param {boolean} shouldRender - TransitionGuard.shouldRender() result
   */
  drawValue(correlation, shouldRender = true) {
    if (!this.ctx || !this.canvas) return;

    // Apply ballistics to the remote value
    if (shouldRender && isFinite(correlation)) {
      const cRaw = Math.max(-1, Math.min(1, correlation));
      this.corrHold = cRaw > this.corrHold
        ? this.corrHold + corrUp * (cRaw - this.corrHold)
        : this.corrHold + corrDn * (cRaw - this.corrHold);
    }

    // Canvas setup
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.floor(rect.width * dpr);
    const h = Math.floor(rect.height * dpr);

    if (w < 10 || h < 10) return;

    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.canvas.style.width = `${rect.width}px`;
      this.canvas.style.height = `${rect.height}px`;
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    // Horizontal correlation bar layout
    const padding = 8 * dpr;
    const barH = Math.max(12 * dpr, h * 0.4);
    const barY = (h - barH) / 2;
    const barX = padding;
    const barW = w - padding * 2;

    // Background track
    ctx.fillStyle = '#0f1214';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.strokeStyle = '#3a4855';
    ctx.strokeRect(barX, barY, barW, barH);

    // Center line (0 position)
    const centerX = barX + barW / 2;
    ctx.fillStyle = '#4b5563';
    ctx.fillRect(centerX - 1, barY - 4 * dpr, 2, barH + 8 * dpr);

    // RTW-style colour zones for correlation
    const col = (this.corrHold < -0.3)
      ? this.getCss('--hot')
      : (this.corrHold >= 0.3 ? this.getCss('--ok') : this.getCss('--warn'));

    // Fill from center based on correlation value
    const fillX = centerX + (this.corrHold * barW / 2);
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.85;
    if (this.corrHold >= 0) {
      ctx.fillRect(centerX, barY + 2, fillX - centerX, barH - 4);
    } else {
      ctx.fillRect(fillX, barY + 2, centerX - fillX, barH - 4);
    }
    ctx.globalAlpha = 1;

    // Scale labels
    ctx.font = `${Math.round(9 * dpr)}px ui-sans-serif`;
    ctx.fillStyle = '#88a3bf';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    const labelY = barY + barH + 10 * dpr;
    ctx.fillText('-1', barX + 10 * dpr, labelY);
    ctx.fillText('0', centerX, labelY);
    ctx.fillText('+1', barX + barW - 10 * dpr, labelY);

    // Update value display element
    if (this.corrValEl && this.formatCorr) {
      this.corrValEl.textContent = this.formatCorr(this.corrHold);
    }
  }

  /**
   * Get current held correlation value
   * @returns {number}
   */
  getValue() {
    return this.corrHold;
  }

  /**
   * Reset correlation hold
   */
  reset() {
    this.corrHold = 0;
  }
}
