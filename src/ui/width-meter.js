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
 * WIDTH METER
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Horizontal stereo width bar meter.
 * Colour zones: 0-30% M-colour (blue), 30-60% green, 60-80% yellow, 80-100% orange, >100% red
 *
 * @module ui/width-meter
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export class WidthMeter {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
  }

  // Colour zones: 0-30% M-colour (blue), 30-60% green, 60-80% yellow, 80-100% orange, >100% red
  widthColour(w) {
    if (w >= 1.0) return '#ff4444';   // Red: >100%
    if (w >= 0.8) return '#ff9a2d';   // Orange: 80-100%
    if (w >= 0.6) return '#ffd94a';   // Yellow: 60-80%
    if (w >= 0.3) return '#44bb66';   // Green: 30-60%
    return '#3b82f6';                  // M-colour (blue): 0-30%
  }

  draw(widthVal, widthPeak) {
    if (!this.ctx) return;
    const canvas = this.canvas;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = rect.height;

    if (cssW < 1 || cssH < 1) return;

    const w = Math.floor(cssW * dpr);
    const h = Math.floor(cssH * dpr);

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    const padding = w * 0.02;
    const centreY = h / 2;
    const trackW = w - padding * 2;
    const trackH = Math.max(6, h * 0.35);
    const radius = 4 * dpr;

    // Draw track background with rounded corners
    ctx.fillStyle = '#0a0c0e';
    ctx.beginPath();
    ctx.roundRect(padding, centreY - trackH / 2, trackW, trackH, radius);
    ctx.fill();

    // Draw fill bar with rounded corners
    const fillW = Math.min(1.0, widthVal) * trackW;
    const fillColour = this.widthColour(widthVal);
    ctx.fillStyle = fillColour;
    ctx.beginPath();
    ctx.roundRect(padding, centreY - trackH / 2, fillW, trackH, radius);
    ctx.fill();

    // Draw peak hold tick (taller)
    const peakX = padding + Math.min(1.0, widthPeak) * trackW;
    ctx.fillStyle = this.widthColour(widthPeak);
    ctx.fillRect(peakX - 1.5 * dpr, centreY - trackH * 0.8, 3 * dpr, trackH * 1.6);
  }
}
