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
function luToNormalised(lu, minLu, maxLu) {
  return Math.max(0, Math.min(1, (lu - minLu) / (maxLu - minLu)));
}

// UNIFIED COLOUR ZONES (LU relative to target)
// Matches radar gradient ZONE_STOPS for consistency
function colourForLu(lu) {
  if (lu >= 3) return '#ff4335';       // Red: +3 to +9 (over limit)
  if (lu >= 0) return '#ff9a2d';       // Orange: 0 to +3 (over target)
  if (lu >= -6) return '#ffd94a';      // Yellow: -6 to 0 (near target)
  if (lu >= -12) return '#88d65c';     // Green: -12 to -6 (normal)
  return '#4488cc';                     // Blue: below -12 (low level)
}

// Radar colour for LUFS value - delegates to unified colourForLu()
function radarColourForLufs(lufs, target) {
  return colourForLu(lufs - target);
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
    // Cache dimensions to avoid unnecessary canvas clears
    this._lastW = 0;
    this._lastH = 0;
  }

  /**
   * Radar radius: LUFS → LU relative to LOUDNESS_TARGET, EBU R128 scale (−36 to +9 LU)
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
    ctx.globalAlpha = 0.75;

    // Rings every 6 LU (target ring drawn separately)
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

  drawRadarSegments(ctx, cx, cy, rOuter, rInner, history, maxAge, frozenTs = null, pauseBreaks = []) {
    ctx.save();
    // Always use real time so segments continue moving on timeline
    const now = Date.now();
    const FADE_START = 5 / 6;  // Start fading at clock 10 (60° before 12)

    // Donut edge and fade zone (LU relative to target)
    const DONUT_LU = -30;       // Donut edge (transparent), aligns with 6 LU grid
    const FADE_END_LU = -27;    // Full opacity 3 LU from edge (short fade zone)

    // Zone colour stops for smooth gradient (LU relative to target)
    const ZONE_STOPS = [
      { lu: -30, colour: '#1a3242' },    // Deep teal at donut edge
      { lu: -18, colour: '#2a5a7a' },  // Teal
      { lu: -12, colour: '#4488cc' },  // Blue
      { lu: -6,  colour: '#88d65c' },  // Green
      { lu: 0,   colour: '#ffd94a' },  // Yellow (target)
      { lu: 3,   colour: '#ff9a2d' },  // Orange
      { lu: 9,   colour: '#ff4335' }   // Red (loud)
    ];

    // Interpolate colour between two hex colours
    const lerpColour = (c1, c2, t) => {
      const r1 = parseInt(c1.slice(1, 3), 16), g1 = parseInt(c1.slice(3, 5), 16), b1 = parseInt(c1.slice(5, 7), 16);
      const r2 = parseInt(c2.slice(1, 3), 16), g2 = parseInt(c2.slice(3, 5), 16), b2 = parseInt(c2.slice(5, 7), 16);
      const r = Math.round(r1 + (r2 - r1) * t), g = Math.round(g1 + (g2 - g1) * t), b = Math.round(b1 + (b2 - b1) * t);
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    };

    // Get interpolated colour for any LU value
    const colourAtLu = (lu) => {
      if (lu < ZONE_STOPS[0].lu) return ZONE_STOPS[0].colour;
      for (let i = 0; i < ZONE_STOPS.length - 1; i++) {
        if (lu <= ZONE_STOPS[i + 1].lu) {
          const t = (lu - ZONE_STOPS[i].lu) / (ZONE_STOPS[i + 1].lu - ZONE_STOPS[i].lu);
          return lerpColour(ZONE_STOPS[i].colour, ZONE_STOPS[i + 1].colour, Math.max(0, Math.min(1, t)));
        }
      }
      return ZONE_STOPS[ZONE_STOPS.length - 1].colour;
    };

    // Convert LU to normalised position within gradient (0 = rInner, 1 = rLevel)
    const luToGradientPos = (targetLu, minLu, maxLu) => {
      return Math.max(0, Math.min(1, (targetLu - minLu) / (maxLu - minLu)));
    };

    // Sort by timestamp descending (newest first) for proper segment connection
    const sortedHistory = [...history]
      .filter(p => {
        // During pause, filter out points added after pause started
        if (frozenTs !== null && p.t > frozenTs) return false;
        const age = now - p.t;
        return age >= 0 && age <= maxAge;
      })
      .sort((a, b) => b.t - a.t);

    // Sweep arm angle (12 o'clock = current time)
    const sweepAngle = -Math.PI / 2;

    sortedHistory.forEach((point, index) => {
      const age = now - point.t;
      const normalisedAge = age / maxAge;
      // This point's angle (clockwise from 12 o'clock)
      const pointAngle = (2 * Math.PI * normalisedAge) - Math.PI / 2;

      // Segment extends from previous point's angle (or sweep) to this point's angle
      // Previous = newer point (smaller index), so we fill backward in time
      let startAngle;
      if (index === 0) {
        // During pause: don't draw sweep connection, segment dies immediately
        if (frozenTs !== null) return;
        // After resume: don't connect sweep to pre-pause points
        const lastPauseTs = pauseBreaks.length > 0 ? pauseBreaks[pauseBreaks.length - 1] : null;
        if (lastPauseTs !== null && point.t <= lastPauseTs) return;
        // Newest point: extend from sweep arm to this point
        startAngle = sweepAngle;
      } else {
        // Older points: extend from previous (newer) point's angle
        const prevPoint = sortedHistory[index - 1];

        // Check if segment crosses any pause boundary (gap)
        // prevPoint is newer, point is older
        // If prevPoint.t > pauseTs && point.t <= pauseTs → crosses boundary
        for (const pauseTs of pauseBreaks) {
          if (prevPoint.t > pauseTs && point.t <= pauseTs) {
            return; // Gap boundary - don't interpolate across pause
          }
        }

        const prevAge = now - prevPoint.t;
        const prevNormalisedAge = prevAge / maxAge;
        startAngle = (2 * Math.PI * prevNormalisedAge) - Math.PI / 2;
      }
      const endAngle = pointAngle;

      // Skip if angles are essentially the same (no visible segment)
      if (Math.abs(endAngle - startAngle) < 0.001) return;

      const lufs = point.v;
      const lu = lufs - this.target;
      const rLevel = this.lufsToRadius(lufs, rOuter, rInner);

      // Fade out final 15% of segment lifetime
      let fadeMultiplier = 1.0;
      if (normalisedAge > FADE_START) {
        fadeMultiplier = 1.0 - (normalisedAge - FADE_START) / (1.0 - FADE_START);
      }
      const opacity = 0.85 * (1 - normalisedAge * 0.2) * Math.max(0, fadeMultiplier);

      // Create radial gradient from inner to current level
      const gradient = ctx.createRadialGradient(cx, cy, rInner, cx, cy, rLevel);

      // Fade zone: transparent at donut edge (-30 LU), full opacity at -27 LU (3 LU span)
      const fadeEndPos = luToGradientPos(FADE_END_LU, DONUT_LU, lu);
      gradient.addColorStop(0, 'rgba(26, 50, 66, 0)');
      gradient.addColorStop(Math.min(fadeEndPos, 1), colourAtLu(FADE_END_LU));

      // Add zone colour stops (all fully opaque after fade)
      for (const stop of ZONE_STOPS) {
        if (stop.lu <= FADE_END_LU) continue;  // Already covered by fade
        if (stop.lu > lu) break;
        const stopPos = luToGradientPos(stop.lu, DONUT_LU, lu);
        if (stopPos > fadeEndPos && stopPos < 1) {
          gradient.addColorStop(stopPos, stop.colour);
        }
      }

      // Final stop at current level with interpolated colour
      gradient.addColorStop(1, colourAtLu(lu));

      // Draw wedge from centre to current level
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, rLevel, startAngle, endAngle);
      ctx.closePath();

      ctx.fillStyle = gradient;
      ctx.globalAlpha = opacity;

      // Boost luminance + chroma from 12 to 1 o'clock
      // No shadowBlur - it creates hard edges in canvas
      const BOOST_SPAN = 1 / 12;  // 30° = 1 hour, 12 to 1 o'clock
      if (normalisedAge < BOOST_SPAN) {
        const t = normalisedAge / BOOST_SPAN;  // 0 at 12, 1 at 1
        const boost = Math.pow(1 - t, 2);  // exponential fade
        // Luminance: push opacity toward 1.0
        ctx.globalAlpha = opacity + boost * (1.0 - opacity);
        ctx.fill();
        // Chroma: additive layer for colour boost
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = boost * 0.2;
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';  // reset
      } else {
        ctx.fill();
      }
    });
    // Only show sweep line if there are post-resume points to connect to
    const lastPauseTs = pauseBreaks.length > 0 ? pauseBreaks[pauseBreaks.length - 1] : null;
    const hasNewPoints = history.some(p => lastPauseTs === null || p.t > lastPauseTs);
    if (history.length > 0 && frozenTs === null && hasNewPoints) {
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

  // Soft dark background behind LU labels (drawn before grid overlay)
  // Spans from -18 LU to +9 LU only, with heavy gradient feather
  drawLabelBackground(ctx, cx, cy, rOuter, rInner, canvasWidth) {
    ctx.save();
    const fontSize = Math.max(8, Math.floor(canvasWidth * 0.020));
    const height = fontSize * 1.8;  // Slimmer band

    // Calculate actual radius for -18 LU (first label position)
    const r18 = this.lufsToRadius(-18 + this.target, rOuter, rInner);
    const r9 = rOuter;  // +9 LU is at outer edge

    const startX = cx + r18 - fontSize * 1.5;  // More padding
    const endX = cx + r9 + fontSize * 1.8;
    const boxWidth = endX - startX;
    const boxY = cy - height / 2;

    // Heavy feather: long gradual fade at both ends, subtle middle
    const gradient = ctx.createLinearGradient(startX, cy, endX, cy);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(0.2, 'rgba(0, 0, 0, 0.1)');
    gradient.addColorStop(0.4, 'rgba(0, 0, 0, 0.15)');
    gradient.addColorStop(0.6, 'rgba(0, 0, 0, 0.15)');
    gradient.addColorStop(0.8, 'rgba(0, 0, 0, 0.1)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(startX, boxY, boxWidth, height, height / 2);
    ctx.fill();
    ctx.restore();
  }

  // Radial LU labels along 3 o'clock spoke (matches grid rings)
  // LU values: -18, -12, -6, 0, +6, +9 (every 6 LU, plus +9 to match outer ring max)
  drawRadarLabels(ctx, cx, cy, rOuter, rInner, canvasWidth) {
    const RADAR_SCALE_LU = [-18, -12, -6, 0, 6, 9];

    ctx.save();
    const fontSize = Math.max(8, Math.floor(canvasWidth * 0.020));
    ctx.font = `600 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = 'center';  // Centre on the grid line
    ctx.textBaseline = 'middle';

    RADAR_SCALE_LU.forEach(lu => {
      // Skip +9 label (doesn't fit, line still drawn)
      if (lu === 9) return;

      const lufs = lu + this.target;
      const r = this.lufsToRadius(lufs, rOuter, rInner);
      const x = cx + r;  // Centered on the grid ring
      const y = cy;

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

  // TC/RTW-style outer ring with momentary bargraph
  // Geometry: 270° arc, −18 to +9 LU = 27 LU, 10° per LU
  // Ticks every 2°, major tick every 10° (1 per LU)
  // Scale: 0 LU at 12 o'clock (top), -18 at 6 o'clock (bottom), +9 at 3 o'clock (right)
  drawOuterMomentaryRing(ctx, cx, cy, rOuter, canvasWidth, momentaryLufs) {
    ctx.save();

    // Geometry for the ring
    const ringOuterRadius = rOuter * 1.16;
    const ringThickness = rOuter * 0.07;
    const ringInnerRadius = ringOuterRadius - ringThickness;
    const fontSize = Math.max(8, Math.floor(canvasWidth * 0.022));

    // Outer ring uses displayed range: -18 to +9 LU (27 LU total)
    const OUTER_RING_LU_MIN = -18;
    const OUTER_RING_LU_MAX = 9;
    const OUTER_RING_LU_RANGE = OUTER_RING_LU_MAX - OUTER_RING_LU_MIN;  // 27

    // 270° arc: -180° to +90° (6 o'clock to 3 o'clock)
    // -18 LU at -180° (6 o'clock, bottom)
    // 0 LU at 0° (12 o'clock, top) ← CORRECT ALIGNMENT
    // +9 LU at +90° (3 o'clock, right)
    const START_ANGLE_DEG = -180;
    const END_ANGLE_DEG = 90;
    const TOTAL_ARC_DEG = END_ANGLE_DEG - START_ANGLE_DEG;  // 270°

    // 27 LU = 270° → 10° per LU
    const DEG_PER_LU = TOTAL_ARC_DEG / OUTER_RING_LU_RANGE;  // 10°

    // Tick every 2° → 135 ticks total
    const TICK_STEP_DEG = 2;
    const NUM_TICKS = Math.floor(TOTAL_ARC_DEG / TICK_STEP_DEG) + 1;

    // Calculate momentary LU relative to target
    const momentaryLu = (typeof momentaryLufs === 'number' && isFinite(momentaryLufs))
      ? momentaryLufs - this.target
      : OUTER_RING_LU_MIN - 1;

    // Normalise momentary → angle (using outer ring range)
    const normalised = luToNormalised(momentaryLu, OUTER_RING_LU_MIN, OUTER_RING_LU_MAX);
    const litAngleDeg = START_ANGLE_DEG + normalised * TOTAL_ARC_DEG;

    // Draw all ticks (lit and unlit)
    ctx.lineCap = 'round';
    const tickOuterR = ringOuterRadius;
    const minorTickLen = rOuter * 0.055;
    const majorTickLen = rOuter * 0.085;

    for (let i = 0; i < NUM_TICKS; i++) {
      const angleDeg = START_ANGLE_DEG + i * TICK_STEP_DEG;
      const angleRad = (angleDeg - 90) * Math.PI / 180;  // -90° offset for 12 o'clock

      // Major tick every 10° (1 per LU)
      const isMajor = (Math.round(angleDeg - START_ANGLE_DEG) % 10 === 0);
      const tickLen = isMajor ? majorTickLen : minorTickLen;
      const tickInnerR = tickOuterR - tickLen;

      // LU at this angle
      const t = (angleDeg - START_ANGLE_DEG) / TOTAL_ARC_DEG;
      const luAtTick = OUTER_RING_LU_MIN + t * OUTER_RING_LU_RANGE;

      // Light up if we are below momentary level
      const isLit = angleDeg <= litAngleDeg;

      // Colour: lit = zone-based, unlit = visible grey
      const colour = isLit ? colourForLu(luAtTick) : '#3a4048';
      const alpha = isLit ? 0.95 : 0.55;
      // Line width: lit minor 2.5, major 4; unlit minor 2, major 3.5
      const lineWidth = isLit
        ? (isMajor ? 4 : 2.5)
        : (isMajor ? 3.5 : 2);

      ctx.beginPath();
      ctx.moveTo(cx + tickInnerR * Math.cos(angleRad), cy + tickInnerR * Math.sin(angleRad));
      ctx.lineTo(cx + tickOuterR * Math.cos(angleRad), cy + tickOuterR * Math.sin(angleRad));
      ctx.strokeStyle = colour;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }

    // Numerals around the ring (every 3 LU)
    ctx.globalAlpha = 1;
    ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const labelRadius = ringOuterRadius + fontSize * 1.1;
    const majorLabels = [-18, -15, -12, -9, -6, -3, 0, 3, 6, 9];

    majorLabels.forEach(lu => {
      if (lu < OUTER_RING_LU_MIN || lu > OUTER_RING_LU_MAX) return;

      const t = (lu - OUTER_RING_LU_MIN) / OUTER_RING_LU_RANGE;
      const angleDeg = START_ANGLE_DEG + t * TOTAL_ARC_DEG;
      const angleRad = (angleDeg - 90) * Math.PI / 180;
      const x = cx + labelRadius * Math.cos(angleRad);
      const y = cy + labelRadius * Math.sin(angleRad);

      // Colour based on zone (matches unified colourForLu zones)
      if (lu >= 3) {
        ctx.fillStyle = '#ff6666';   // Red zone label
      } else if (lu >= 0) {
        ctx.fillStyle = '#ffaa44';   // Orange zone label (0 to +3)
      } else if (lu >= -6) {
        ctx.fillStyle = '#ffdd66';   // Yellow zone label (-6 to 0)
      } else {
        ctx.fillStyle = '#8899aa';   // Grey for rest
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
      const colour = radarColourForLufs(momentaryLufs, this.target);
      ctx.shadowColor = colour;
      ctx.shadowBlur = 10;
      ctx.fillStyle = colour;
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
    // Donut edge at -30 LU: ((-30) - (-36)) / 45 = 6/45 = 0.133
    const rInner = rOuter * ((-30 - MOMENTARY_LU_MIN) / MOMENTARY_LU_RANGE);
    this.drawOuterMomentaryRing(ctx, cx, cy, rOuter, w, null);
    this.drawRadarBackground(ctx, cx, cy, rOuter, rInner);
    this.drawGridOverlay(ctx, cx, cy, rOuter, rInner);
    this.drawTargetRing(ctx, cx, cy, rOuter, rInner);
    this.drawLabelBackground(ctx, cx, cy, rOuter, rInner, w);
    this.drawRadarLabels(ctx, cx, cy, rOuter, rInner, w);
  }

  /**
   * Main render function - EXACT from audio-meters-grid.html
   * @param {Array} history - Array of {t: timestamp, v: lufs} points
   * @param {number} momentaryLufs - Current momentary loudness
   * @param {number} maxSeconds - History duration in seconds
   * @param {boolean} peakFlag - Whether peak indicator is on
   * @param {number|null} frozenTs - Frozen timestamp for pause (segments stop aging)
   * @param {Array} pauseBreaks - List of pause timestamps for gap boundaries
   */
  render(history, momentaryLufs, maxSeconds, peakFlag, frozenTs = null, pauseBreaks = []) {
    if (!this.canvas || !this.ctx) return;

    const dpr = window.devicePixelRatio;
    const newW = Math.round(this.canvas.offsetWidth * dpr);
    const newH = Math.round(this.canvas.offsetHeight * dpr);

    // Only resize canvas when dimensions actually change (avoids clearing)
    if (newW !== this._lastW || newH !== this._lastH) {
      this.canvas.width = newW;
      this.canvas.height = newH;
      this._lastW = newW;
      this._lastH = newH;
    }

    const w = this.canvas.width;
    const h = this.canvas.height;
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
    // Donut edge at -30 LU: ((-30) - (-36)) / 45 = 6/45 = 0.133
    const rInner = rOuter * ((-30 - MOMENTARY_LU_MIN) / MOMENTARY_LU_RANGE);
    const maxAge = maxSeconds * 1000;

    this.drawOuterMomentaryRing(ctx, cx, cy, rOuter, w, momentaryLufs);  // TC/RTW momentary bargraph
    this.drawRadarBackground(ctx, cx, cy, rOuter, rInner);
    this.drawRadarSegments(ctx, cx, cy, rOuter, rInner, history, maxAge, frozenTs, pauseBreaks);  // Pass pause state
    this.drawGridOverlay(ctx, cx, cy, rOuter, rInner);  // Grey rings + spokes (on top of segments)
    this.drawTargetRing(ctx, cx, cy, rOuter, rInner);   // Target ring (on top of grid)
    this.drawLabelBackground(ctx, cx, cy, rOuter, rInner, w);  // Dark bg behind labels (over grid)
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

  /**
   * Export radar canvas as PNG data URL.
   * @returns {string} Base64-encoded PNG data URL
   */
  exportPNG() {
    if (!this.canvas) return null;
    return this.canvas.toDataURL('image/png');
  }

  /**
   * Download radar as PNG file.
   * @param {string} filename - Optional filename (default: loudness-radar-TIMESTAMP.png)
   */
  downloadPNG(filename) {
    const dataUrl = this.exportPNG();
    if (!dataUrl) return;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = filename || `loudness-radar-${timestamp}.png`;

    const link = document.createElement('a');
    link.download = name;
    link.href = dataUrl;
    link.click();
  }

  /**
   * Download session summary as JSON file.
   * Format follows EBU R 128 terminology for loudness metadata.
   *
   * @param {Array} history - History array from measure loop
   * @param {Object} stats - Current R128 stats {integrated, shortTerm, lra, tpMax}
   * @param {string} filename - Optional filename
   */
  downloadJSON(history, stats, filename) {
    const summary = this.getSessionSummary(history, stats);
    if (!summary.valid) {
      console.warn('[Radar] No valid session data to export');
      return;
    }

    // Format per EBU R 128 / Tech 3285 terminology
    const exportData = {
      format: 'EBU R 128 Session Summary',
      version: '1.0',
      generated: new Date().toISOString(),
      session: {
        start: summary.startTime.toISOString(),
        end: summary.endTime.toISOString(),
        duration: summary.durationFormatted,
        durationSeconds: Math.round(summary.duration / 1000),
        samples: summary.samples
      },
      loudness: {
        integrated: summary.integrated !== null ? parseFloat(summary.integrated) : null,
        integratedUnit: 'LUFS',
        range: summary.lra !== null ? parseFloat(summary.lra) : null,
        rangeUnit: 'LU',
        shortTermMax: parseFloat(summary.max),
        shortTermMin: parseFloat(summary.min),
        shortTermAvg: parseFloat(summary.avg),
        shortTermUnit: 'LUFS'
      },
      truePeak: {
        max: summary.tpMax !== null ? parseFloat(summary.tpMax) : null,
        unit: 'dBTP'
      },
      target: {
        level: summary.target,
        unit: 'LUFS',
        timeAboveSeconds: summary.timeAboveTarget,
        timeInRangeSeconds: summary.timeInRange,
        timeBelowRangeSeconds: summary.timeBelowRange
      },
      reference: {
        standard: 'EBU R 128',
        meteringSpec: 'EBU Tech 3341',
        loudnessRange: 'EBU Tech 3342',
        truePeak: 'ITU-R BS.1770-4'
      }
    };

    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = filename || `loudness-session-${timestamp}.json`;

    const link = document.createElement('a');
    link.download = name;
    link.href = url;
    link.click();

    URL.revokeObjectURL(url);
  }

  /**
   * Get history point at canvas position (for hover tooltip).
   * @param {number} x - X position in CSS pixels
   * @param {number} y - Y position in CSS pixels
   * @param {Array} history - History array
   * @param {number} maxSeconds - Max history duration
   * @returns {Object|null} {lufs, timestamp, age} or null if outside radar
   */
  getPointAtPosition(x, y, history, maxSeconds) {
    if (!this.canvas || !history || !history.length) return null;

    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cx = w / (2 * dpr);
    const cy = h / (2 * dpr);
    const rOuter = Math.min(w, h) * 0.38 / dpr;
    const rInner = rOuter * ((-30 - MOMENTARY_LU_MIN) / MOMENTARY_LU_RANGE);

    // Calculate distance and angle from centre
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Check if within radar ring
    if (dist < rInner || dist > rOuter) return null;

    // Calculate angle (0 = 12 o'clock, clockwise)
    let angle = Math.atan2(dy, dx) + Math.PI / 2; // Rotate so 0 = top
    if (angle < 0) angle += 2 * Math.PI;

    // Convert angle to age
    const normalisedAge = angle / (2 * Math.PI);
    const ageMs = normalisedAge * maxSeconds * 1000;
    const now = Date.now();
    const targetTime = now - ageMs;

    // Find closest history point
    let closest = null;
    let minDiff = Infinity;
    for (const point of history) {
      const diff = Math.abs(point.t - targetTime);
      if (diff < minDiff) {
        minDiff = diff;
        closest = point;
      }
    }

    // Only return if reasonably close (within 2 seconds)
    if (closest && minDiff < 2000) {
      return {
        lufs: closest.v,
        timestamp: new Date(closest.t),
        age: (now - closest.t) / 1000
      };
    }

    return null;
  }

  /**
   * Get session summary statistics.
   * @param {Array} history - History array
   * @param {Object} stats - Current R128 stats {integrated, shortTerm, lra, tpMax}
   * @returns {Object} Session summary
   */
  getSessionSummary(history, stats = {}) {
    if (!history || !history.length) {
      return { valid: false };
    }

    const values = history.map(p => p.v).filter(v => isFinite(v) && v > -100);
    if (!values.length) return { valid: false };

    const startTime = new Date(history[0].t);
    const endTime = new Date(history[history.length - 1].t);
    const durationMs = endTime - startTime;

    // Calculate statistics
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;

    // Count time in zones (relative to target)
    let timeAboveTarget = 0;
    let timeInRange = 0;
    let timeBelowRange = 0;
    const intervalMs = durationMs / values.length;

    for (const v of values) {
      const lu = v - this.target;
      if (lu > 0) timeAboveTarget += intervalMs;
      else if (lu >= -6) timeInRange += intervalMs;
      else timeBelowRange += intervalMs;
    }

    return {
      valid: true,
      startTime,
      endTime,
      duration: durationMs,
      durationFormatted: this._formatDuration(durationMs),
      samples: values.length,
      target: this.target,
      min: min.toFixed(1),
      max: max.toFixed(1),
      avg: avg.toFixed(1),
      integrated: stats.integrated || null,
      lra: stats.lra || null,
      tpMax: stats.tpMax || null,
      timeAboveTarget: Math.round(timeAboveTarget / 1000),
      timeInRange: Math.round(timeInRange / 1000),
      timeBelowRange: Math.round(timeBelowRange / 1000)
    };
  }

  _formatDuration(ms) {
    const sec = Math.floor(ms / 1000) % 60;
    const min = Math.floor(ms / 60000) % 60;
    const hr = Math.floor(ms / 3600000);
    if (hr > 0) {
      return `${hr}:${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    }
    return `${min}:${sec.toString().padStart(2, '0')}`;
  }
}
