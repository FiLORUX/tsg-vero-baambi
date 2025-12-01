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
 * ROTATION METER
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Stereo centroid angle with trail.
 * Colors: M (center) = #3b82f6 (blue), S (edges) = #22d3ee (cyan)
 *
 * @module ui/rotation-meter
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export class RotationMeter {
  constructor(canvas, wrapperSelector) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.wrapperSelector = wrapperSelector;
  }

  // Colors: M (center) = #3b82f6 (blue), S (edges) = #22d3ee (cyan)
  rotationColor(rotationValue) {
    // |rotation| 0 = M color (blue), |rotation| 1 = S color (cyan)
    const t = Math.abs(rotationValue);  // 0..1
    // M color: rgb(59, 130, 246), S color: rgb(34, 211, 238)
    const r = Math.round(59 + t * (34 - 59));
    const g = Math.round(130 + t * (211 - 130));
    const b = Math.round(246 + t * (238 - 246));
    return `rgb(${r}, ${g}, ${b})`;
  }

  draw(rotation, rotationHistory, containerEl) {
    if (!this.ctx || !this.canvas) return;

    // Use wrapper for dimensions
    const rotationWrap = containerEl?.querySelector('.rotationWrap');
    if (!rotationWrap) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = rotationWrap.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = rect.height;

    if (cssW < 1 || cssH < 1) return;

    const w = Math.floor(cssW * dpr);
    const h = Math.floor(cssH * dpr);

    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    const padding = w * 0.04;
    const trackY = h / 2;
    const trackW = w - padding * 2;
    const centerX = w / 2;
    const trackH = Math.max(4, h * 0.12);

    // 1. Draw track background
    ctx.fillStyle = '#1a1f25';
    ctx.fillRect(padding, trackY - trackH / 2, trackW, trackH);

    // 2. Centre tick
    ctx.fillStyle = '#4b5563';
    ctx.fillRect(centerX - 1, trackY - trackH, 2, trackH * 2);

    // 3. Trail (fading opacity) with dynamic color
    const usableW = trackW / 2 - padding;
    rotationHistory.forEach((val, i) => {
      const alpha = (i + 1) / rotationHistory.length * 0.4;
      const x = centerX + val * usableW;
      const radius = Math.max(2, h * 0.06);
      const color = this.rotationColor(val);

      ctx.beginPath();
      ctx.arc(x, trackY, radius, 0, Math.PI * 2);
      ctx.fillStyle = color.replace('rgb', 'rgba').replace(')', `, ${alpha})`);
      ctx.fill();
    });

    // 4. Main dot with glow - dynamic color based on position
    const dotX = centerX + rotation * usableW;
    const dotRadius = Math.max(3, h * 0.1);
    const dotColor = this.rotationColor(rotation);

    ctx.shadowColor = dotColor;
    ctx.shadowBlur = 8 * dpr;
    ctx.beginPath();
    ctx.arc(dotX, trackY, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();
    ctx.shadowBlur = 0;

    // 5. Degree scale at bottom (−45° 0° +45°)
    const degreeY = h - 4 * dpr;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = `${Math.round(7 * dpr)}px ui-monospace, monospace`;
    ctx.textBaseline = 'bottom';

    ctx.textAlign = 'left';
    ctx.fillText('−45°', padding, degreeY);

    ctx.textAlign = 'center';
    ctx.fillText('0°', centerX, degreeY);

    ctx.textAlign = 'right';
    ctx.fillText('+45°', w - padding, degreeY);
  }
}
