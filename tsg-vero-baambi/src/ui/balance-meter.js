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
 * BALANCE METER (L/R MonoDev)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Stereo balance meter showing L/R level deviation in dB.
 * Range: -12 to +12 dB
 * Positive = L louder, Negative = R louder
 *
 * @module ui/balance-meter
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// Get CSS custom property value
function getCss(v) {
  return getComputedStyle(document.documentElement).getPropertyValue(v).trim();
}

export class BalanceMeter {
  constructor(canvas, valueEl) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.valueEl = valueEl;
    this.monoDevHold = 0;
  }

  draw(bufL, bufR) {
    if (!this.ctx || !this.canvas) return;

    // Calculate RMS for L and R
    let sumL = 0, sumR = 0;
    for (let i = 0; i < bufL.length; i++) {
      sumL += bufL[i] * bufL[i];
      sumR += bufR[i] * bufR[i];
    }
    const rmsL = Math.sqrt(sumL / bufL.length);
    const rmsR = Math.sqrt(sumR / bufR.length);

    // L/R balance in dB (positive = L louder, negative = R louder)
    const balanceDb = 20 * Math.log10((rmsL + 1e-12) / (rmsR + 1e-12));
    const clampedBalance = Math.max(-12, Math.min(12, balanceDb));

    // Smooth
    const a = 0.15;
    this.monoDevHold = isFinite(clampedBalance) ? this.monoDevHold + a * (clampedBalance - this.monoDevHold) : 0;

    // Canvas setup with HiDPI
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.floor(rect.width * dpr);
    const h = Math.floor(rect.height * dpr);

    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    // Draw background
    const pad = Math.round(8 * dpr);
    const barY = Math.round(h * 0.35);
    const barH = Math.round(h * 0.3);
    const barX = pad;
    const barW = w - 2 * pad;

    ctx.fillStyle = '#0f1214';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.strokeStyle = '#3a4855';
    ctx.strokeRect(barX, barY, barW, barH);

    // Centre line (0 dB)
    const centerX = barX + barW / 2;
    ctx.fillStyle = '#5a6a7a';
    ctx.fillRect(centerX - 1, barY - 4 * dpr, 2, barH + 8 * dpr);

    // Tick marks at ±3, ±6, ±12 dB
    const ticks = [-12, -6, -3, 3, 6, 12];
    ctx.fillStyle = '#3a4855';
    ctx.font = `${Math.round(8 * dpr)}px ui-monospace, monospace`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    for (const t of ticks) {
      const xPos = centerX + (t / 12) * (barW / 2);
      ctx.fillRect(xPos - 0.5, barY - 2 * dpr, 1, barH + 4 * dpr);
    }

    // Draw balance bar
    const devX = centerX + (this.monoDevHold / 12) * (barW / 2);
    const devW = Math.abs(devX - centerX);

    // Colour based on deviation
    let col;
    const absDev = Math.abs(this.monoDevHold);
    if (absDev < 1.5) col = getCss('--ok');       // Green: good balance
    else if (absDev < 3) col = getCss('--cyan');  // Cyan: slight deviation
    else if (absDev < 6) col = getCss('--warn');  // Amber: noticeable
    else col = getCss('--hot');                    // Red: severe imbalance

    ctx.globalAlpha = 0.85;
    ctx.fillStyle = col;
    // Positive balance (L > R) → bar to LEFT (towards L label)
    // Negative balance (R > L) → bar to RIGHT (towards R label)
    if (this.monoDevHold >= 0) {
      ctx.fillRect(centerX - devW, barY + 2, devW, barH - 4);
    } else {
      ctx.fillRect(centerX, barY + 2, devW, barH - 4);
    }
    ctx.globalAlpha = 1;

    // Update display with L/R instead of +/-
    if (this.valueEl) {
      const absVal = Math.abs(this.monoDevHold);
      let balanceStr;
      if (absVal < 0.05) {
        balanceStr = 'C 0.0 dB';  // Centrerad
      } else if (this.monoDevHold > 0) {
        balanceStr = 'L ' + absVal.toFixed(1) + ' dB';
      } else {
        balanceStr = 'R ' + absVal.toFixed(1) + ' dB';
      }
      this.valueEl.textContent = balanceStr;
    }
  }
}
