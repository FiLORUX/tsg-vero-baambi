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
 * LOUDNESS RADAR (TC ELECTRONIC CLARITY / LM6 STYLE)
 * ═══════════════════════════════════════════════════════════════════════════════
 * Polar display of short-term loudness history. Spoke at 12 o'clock represents
 * current time; segments age clockwise. Ring position encodes LU relative to
 * target; colour indicates deviation severity per EBU R128 tolerance guidance.
 *
 * EXACT extraction from audio-meters-grid.html lines 1377-1801
 *
 * @module ui/radar
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// EBU R128 momentary loudness range: −36 to +9 LU relative to target.
// This 45 LU span covers practical broadcast content dynamics.
const MOMENTARY_LU_MIN = -36;
const MOMENTARY_LU_MAX = 9;
const MOMENTARY_LU_RANGE = MOMENTARY_LU_MAX - MOMENTARY_LU_MIN;
const LOW_LEVEL_BELOW = -12;  // Below −12 LU = "low level" zone (cyan)

// Maps LU value to normalised 0–1 range for radial positioning
function luToNormalized(lu, minLu, maxLu) {
  return Math.max(0, Math.min(1, (lu - minLu) / (maxLu - minLu)));
}

// TC/RTW colour logic for momentary ring
function colorForLu(lu) {
  if (lu >= 3) return '#ff4444';       // Red: +3 to +9 (too loud)
  if (lu >= 0) return '#ffd700';       // Yellow: 0 to +3 (over target)
  if (lu >= LOW_LEVEL_BELOW) return '#44bb66';  // Green: normal level
  return '#4488cc';                     // Blue: below low level
}

// Radar colour zones: LUFS → LU relative to LOUDNESS_TARGET (EBU R128 compliant)
// EBU R128 defines < -12 LU as "low level"
function radarColorForLufs(lufs, target) {
  const lu = lufs - target;
  if (lu >= 3) return '#ff4335';    // red – over limit (+3 and above)
  if (lu >= 0) return '#ff9a2d';    // orange – over target (0 to +3)
  if (lu >= -6) return '#ffd94a';   // yellow – near target (-6 to 0)
  if (lu >= -12) return '#88d65c';  // light green – normal (-12 till -6)
  return '#4488cc';                 // blue – low level (below -12 LU per EBU R128)
}

/**
 * LoudnessRadar - EXACT extraction from audio-meters-grid.html LoudnessRadar IIFE
 */
export class LoudnessRadar {
  /**
   * @param {HTMLCanvasElement} canvas - Canvas element
   * @param {number} target - LOUDNESS_TARGET value (e.g. -23)
   */
  constructor(canvas, target = -23) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.target = target;
  }

  /**
   * Radar radius: LUFS → LU relativt LOUDNESS_TARGET, EBU R128 scale (-36 till +9 LU)
   */
  lufsToRadius(lufs, rOuter, rInner) {
    const lu = lufs - this.target;
    const clampedLu = Math.max(MOMENTARY_LU_MIN, Math.min(MOMENTARY_LU_MAX, lu));
    const t = (clampedLu - MOMENTARY_LU_MIN) / MOMENTARY_LU_RANGE; // 0..1
    return rInner + t * (rOuter - rInner);
  }

  drawRadarBackground(ctx, cx, cy, rOuter, rInner) {
    ctx.save();
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
    ctx.beginPath();
    ctx.arc(cx, cy, rInner, 0, 2 * Math.PI);
    ctx.fillStyle = '#0d0f11';
    ctx.fill();
    ctx.strokeStyle = '#1a1e22';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  // Grey reference lines - rings AND spokes (drawn ON TOP OF segments)
  drawGridOverlay(ctx, cx, cy, rOuter, rInner) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.55;

    // Ringar var 6 LU (utom target som ritas separat)
    const GRID_STEP_LU = 6;
    for (let lu = MOMENTARY_LU_MIN; lu <= MOMENTARY_LU_MAX; lu += GRID_STEP_LU) {
      if (lu === 0) continue;
      const lufs = lu + this.target;
      const r = this.lufsToRadius(lufs, rOuter, rInner);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = '#8b95a5';
      ctx.setLineDash([3, 5]);
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // Spokes every 30° (12 o'clock positions)
    ctx.setLineDash([]);
    ctx.strokeStyle = '#6b7580';
    ctx.lineWidth = 1.0;
    for (let deg = 0; deg < 360; deg += 30) {
      const a = (deg - 90) * Math.PI / 180;
      ctx.beginPath();
      ctx.moveTo(cx + rInner * Math.cos(a), cy + rInner * Math.sin(a));
      ctx.lineTo(cx + rOuter * Math.cos(a), cy + rOuter * Math.sin(a));
      ctx.stroke();
    }

    ctx.restore();
  }

  // Target ring drawn separately AFTER segments so it appears on top
  drawTargetRing(ctx, cx, cy, rOuter, rInner) {
    ctx.save();
    const lufs = 0 + this.target;  // LU=0 → LUFS
    const r = this.lufsToRadius(lufs, rOuter, rInner);

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

  drawRadarSegments(ctx, cx, cy, rOuter, rInner, history, maxAge) {
    ctx.save();
    const now = Date.now();
    const segmentCount = history.length;
    const anglePerSegment = (2 * Math.PI) / Math.max(segmentCount, 60);
    const FADE_START = 0.85;  // Start fading at 85% of age

    history.forEach((point, index) => {
      const age = now - point.t;
      if (age < 0 || age > maxAge) return;
      const normalizedAge = age / maxAge;
      const startAngle = (2 * Math.PI * normalizedAge) - Math.PI / 2;
      const endAngle = startAngle + anglePerSegment;
      const lufs = point.v;
      const r = this.lufsToRadius(lufs, rOuter, rInner);
      const color = radarColorForLufs(lufs, this.target);

      // Fade ut sista 15% av livstiden
      let fadeMultiplier = 1.0;
      if (normalizedAge > FADE_START) {
        fadeMultiplier = 1.0 - (normalizedAge - FADE_START) / (1.0 - FADE_START);
      }
      const opacity = 0.85 * (1 - normalizedAge * 0.2) * Math.max(0, fadeMultiplier);

      // DONUT: Draw arc from rInner to r
      ctx.beginPath();
      ctx.arc(cx, cy, rInner, startAngle, endAngle);
      ctx.arc(cx, cy, r, endAngle, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.globalAlpha = opacity;

      // Fresh segments (first 10%) get subtle glow
      if (normalizedAge < 0.10) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 4 * (1 - normalizedAge / 0.10);
      } else {
        ctx.shadowBlur = 0;
      }

      ctx.fill();
      ctx.shadowBlur = 0;  // Reset efter fill

      // Mjukare kant som tonar med segmentet
      ctx.strokeStyle = `rgba(0, 0, 0, ${opacity * 0.3})`;
      ctx.lineWidth = 0.75;
      ctx.stroke();
    });
    if (history.length > 0) {
      const sweepAngle = -Math.PI / 2;
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = '#69bfff';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#69bfff';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      // Sweep line from rInner to rOuter
      ctx.moveTo(cx + rInner * Math.cos(sweepAngle), cy + rInner * Math.sin(sweepAngle));
      ctx.lineTo(cx + rOuter * Math.cos(sweepAngle), cy + rOuter * Math.sin(sweepAngle));
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  // Radial LU labels along 3 o'clock spoke (matches grid rings)
  // LU values: -18, -12, -6, 0, +6 (every 6 LU)
  drawRadarLabels(ctx, cx, cy, rOuter, rInner, canvasWidth) {
    const RADAR_SCALE_LU = [-18, -12, -6, 0, 6];

    ctx.save();
    const fontSize = Math.max(8, Math.floor(canvasWidth * 0.020));
    ctx.font = `600 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const labelAngle = 0;  // kl 3-spaken

    RADAR_SCALE_LU.forEach(lu => {
      const lufs = lu + this.target;
      const r = this.lufsToRadius(lufs, rOuter, rInner);
      const x = cx + r * Math.cos(labelAngle) + 3;
      const y = cy + r * Math.sin(labelAngle);

      // Highlight target (LU=0)
      if (lu === 0) {
        ctx.fillStyle = '#40a0ff';
        ctx.font = `700 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
      } else {
        ctx.fillStyle = '#9ca3af';  // Lighter grey
        ctx.font = `600 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
      }
      // Show LU value (with + for positive)
      const label = lu > 0 ? `+${lu}` : lu.toString();
      ctx.fillText(label, x, y);
    });

    ctx.restore();
  }

  // TC/RTW-style outer ring med momentary bargraph
  // Geometry: 270° arc, -18 to +9 LU = 27 LU, 10° per LU
  // Ticks var 2°, major tick var 10° (1 per LU)
  drawOuterMomentaryRing(ctx, cx, cy, rOuter, canvasWidth, momentaryLufs) {
    ctx.save();

    // Geometry for the ring
    const ringOuterRadius = rOuter * 1.16;
    const ringThickness = rOuter * 0.07;
    const ringInnerRadius = ringOuterRadius - ringThickness;
    const fontSize = Math.max(8, Math.floor(canvasWidth * 0.022));

    // 270° arc: -180° to +90° (6 o'clock to 3 o'clock)
    // -18 LU at -180° (6 o'clock, bottom), +9 LU at +90° (3 o'clock, right)
    const START_ANGLE_DEG = -180;  // -18 LU (kl 6, botten)
    const END_ANGLE_DEG = 90;      // +9 LU (3 o'clock, right)
    const TOTAL_ARC_DEG = END_ANGLE_DEG - START_ANGLE_DEG;  // 270°

    // 27 LU = 270° → 10° per LU
    const DEG_PER_LU = TOTAL_ARC_DEG / MOMENTARY_LU_RANGE;  // 10°

    // Tick var 2° → 135 ticks totalt
    const TICK_STEP_DEG = 2;
    const NUM_TICKS = Math.floor(TOTAL_ARC_DEG / TICK_STEP_DEG) + 1;

    // Calculate momentary LU relative to target
    const momentaryLu = (typeof momentaryLufs === 'number' && isFinite(momentaryLufs))
      ? momentaryLufs - this.target
      : MOMENTARY_LU_MIN - 1;

    // Normalisera momentary → vinkel
    const normalized = luToNormalized(momentaryLu, MOMENTARY_LU_MIN, MOMENTARY_LU_MAX);
    const litAngleDeg = START_ANGLE_DEG + normalized * TOTAL_ARC_DEG;

    // Draw all ticks (lit and unlit)
    ctx.lineCap = 'round';
    const tickOuterR = ringOuterRadius;
    const minorTickLen = rOuter * 0.055;
    const majorTickLen = rOuter * 0.085;

    for (let i = 0; i < NUM_TICKS; i++) {
      const angleDeg = START_ANGLE_DEG + i * TICK_STEP_DEG;
      const angleRad = (angleDeg - 90) * Math.PI / 180;  // -90° offset for 12 o'clock

      // Major tick var 10° (1 per LU)
      const isMajor = (Math.round(angleDeg - START_ANGLE_DEG) % 10 === 0);
      const tickLen = isMajor ? majorTickLen : minorTickLen;
      const tickInnerR = tickOuterR - tickLen;

      // LU vid denna vinkel
      const t = (angleDeg - START_ANGLE_DEG) / TOTAL_ARC_DEG;
      const luAtTick = MOMENTARY_LU_MIN + t * MOMENTARY_LU_RANGE;

      // Light up if we are below momentary level
      const isLit = angleDeg <= litAngleDeg;

      // Colour: lit = zone-based, unlit = visible grey
      const color = isLit ? colorForLu(luAtTick) : '#3a4048';
      const alpha = isLit ? 0.95 : 0.55;
      // Tjocklek: lit minor 2.5, major 4; unlit minor 2, major 3.5
      const lineWidth = isLit
        ? (isMajor ? 4 : 2.5)
        : (isMajor ? 3.5 : 2);

      ctx.beginPath();
      ctx.moveTo(cx + tickInnerR * Math.cos(angleRad), cy + tickInnerR * Math.sin(angleRad));
      ctx.lineTo(cx + tickOuterR * Math.cos(angleRad), cy + tickOuterR * Math.sin(angleRad));
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }

    // Siffror runt ringen (var 3 LU)
    ctx.globalAlpha = 1;
    ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const labelRadius = ringOuterRadius + fontSize * 1.1;
    const majorLabels = [-18, -15, -12, -9, -6, -3, 0, 3, 6, 9];

    majorLabels.forEach(lu => {
      if (lu < MOMENTARY_LU_MIN || lu > MOMENTARY_LU_MAX) return;

      const t = (lu - MOMENTARY_LU_MIN) / MOMENTARY_LU_RANGE;
      const angleDeg = START_ANGLE_DEG + t * TOTAL_ARC_DEG;
      const angleRad = (angleDeg - 90) * Math.PI / 180;
      const x = cx + labelRadius * Math.cos(angleRad);
      const y = cy + labelRadius * Math.sin(angleRad);

      // Colour based on zone (0 is grey like negatives)
      if (lu >= 3) {
        ctx.fillStyle = '#ff6666';
      } else if (lu > 0) {
        ctx.fillStyle = '#ffdd44';
      } else {
        ctx.fillStyle = '#8899aa';
      }

      const label = lu === 0 ? '0' : lu.toString();
      ctx.fillText(label, x, y);
    });

    ctx.restore();
  }

  drawCenterLUFS(ctx, cx, cy, rInner, momentaryLufs) {
    ctx.save();
    const fontSize = Math.max(14, rInner * 0.35);
    ctx.font = `800 ${fontSize}px ui-sans-serif, Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (typeof momentaryLufs === 'number' && isFinite(momentaryLufs)) {
      const color = radarColorForLufs(momentaryLufs, this.target);
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.fillStyle = color;
      ctx.fillText(momentaryLufs.toFixed(1), cx, cy);
    } else {
      ctx.fillStyle = '#6b7280';
      ctx.fillText('—', cx, cy);
    }
    ctx.restore();
  }

  drawEmptyRadar(ctx, w, h) {
    const cx = w / 2;
    const cy = h / 2;
    const rOuter = Math.min(w, h) * 0.38;
    const rInner = rOuter * 0.30;
    this.drawOuterMomentaryRing(ctx, cx, cy, rOuter, w, null);
    this.drawRadarBackground(ctx, cx, cy, rOuter, rInner);
    this.drawGridOverlay(ctx, cx, cy, rOuter, rInner);
    this.drawTargetRing(ctx, cx, cy, rOuter, rInner);
    this.drawRadarLabels(ctx, cx, cy, rOuter, rInner, w);
  }

  /**
   * Main render function - EXACT from audio-meters-grid.html
   * @param {Array} history - Array of {t: timestamp, v: lufs} points
   * @param {number} momentaryLufs - Current momentary loudness
   * @param {number} maxSeconds - History duration in seconds
   * @param {boolean} peakFlag - Whether peak indicator is on
   */
  render(history, momentaryLufs, maxSeconds, peakFlag) {
    if (!this.canvas || !this.ctx) return;

    const w = this.canvas.width = this.canvas.offsetWidth * window.devicePixelRatio;
    const h = this.canvas.height = this.canvas.offsetHeight * window.devicePixelRatio;
    const ctx = this.ctx;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!history || !history.length) {
      this.drawEmptyRadar(ctx, w, h);
      return;
    }

    const cx = w / 2;
    const cy = h / 2;
    const rOuter = Math.min(w, h) * 0.38;  // Larger to fill canvas better
    const rInner = rOuter * 0.30;  // DONUT: 30% hole in centre
    const maxAge = maxSeconds * 1000;

    this.drawOuterMomentaryRing(ctx, cx, cy, rOuter, w, momentaryLufs);  // TC/RTW momentary bargraph
    this.drawRadarBackground(ctx, cx, cy, rOuter, rInner);
    this.drawRadarSegments(ctx, cx, cy, rOuter, rInner, history, maxAge);
    this.drawGridOverlay(ctx, cx, cy, rOuter, rInner);  // Grey rings + spokes (on top of segments)
    this.drawTargetRing(ctx, cx, cy, rOuter, rInner);   // Target ring (on top of grid)
    this.drawRadarLabels(ctx, cx, cy, rOuter, rInner, w); // Labels on top
    // Peak LED now DOM-based (see .peak-led CSS) - canvas version disabled due to border-radius clipping
    // this.drawPeakIndicator(ctx, cx, cy, rOuter, w, peakFlag);
  }

  // Peak indicator - LED at upper-right corner of bounding square around outer ring
  drawPeakIndicator(ctx, cx, cy, rOuter, canvasWidth, peakFlag) {
    ctx.save();

    // Use same outer radius as momentary ring
    const ringOuterRadius = rOuter * 1.16;

    // Position: upper-right corner of imaginary bounding square
    // Square tangent to circle at 12, 3, 6, 9 o'clock → corner at (cx + r, cy - r)
    const peakX = cx + ringOuterRadius;
    const peakY = cy - ringOuterRadius;

    const diodeSize = rOuter * 0.06;

    // Draw LED (filled circle)
    ctx.beginPath();
    ctx.arc(peakX, peakY, diodeSize, 0, Math.PI * 2);

    if (peakFlag) {
      // ON: bright amber-red with glow
      ctx.fillStyle = '#ff4e2d';
      ctx.globalAlpha = 0.95;
      ctx.shadowColor = '#ff4e2d';
      ctx.shadowBlur = 10;
    } else {
      // OFF: dark red, low opacity (unlit faux-LED)
      ctx.fillStyle = '#5a1c1c';
      ctx.globalAlpha = 0.4;
      ctx.shadowBlur = 0;
    }
    ctx.fill();
    ctx.shadowBlur = 0;

    // Label "Peak" - right-aligned, positioned to the LEFT of the LED
    const fontSize = Math.max(8, Math.floor(canvasWidth * 0.020));
    ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = peakFlag ? 0.95 : 0.5;
    ctx.fillStyle = peakFlag ? '#ff6655' : '#8899aa';
    ctx.fillText('Peak', peakX - diodeSize - 4, peakY);

    ctx.restore();
  }

  /**
   * Set target loudness
   * @param {number} target - Target in LUFS (e.g. -23)
   */
  setTarget(target) {
    this.target = target;
  }
}
