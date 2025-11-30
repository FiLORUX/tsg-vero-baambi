/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * TSG Suite – THÅST Vector Text AudioWorklet Processor
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Runs in audio thread for glitch-free vector text generation.
 * Outputs X/Y coordinates as L/R channels for goniometer display.
 *
 * @module generators/thast-vector-worklet
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/*
 * Vector Letter Definitions (same as main module, inlined for worklet isolation)
 */
function polyline(points) {
  return points.map(([x, y]) => ({ x, y }));
}

function createRing(cx, cy, r, n = 16) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

const LETTERS = {
  T: [polyline([[0, 1], [1, 1]]), polyline([[0.5, 1], [0.5, 0]])],
  H: [polyline([[0, 0], [0, 1]]), polyline([[1, 0], [1, 1]]), polyline([[0, 0.5], [1, 0.5]])],
  Å: [polyline([[0, 0], [0.5, 1], [1, 0]]), polyline([[0.2, 0.4], [0.8, 0.4]]), createRing(0.5, 1.22, 0.12)],
  S: [polyline([[0.9, 0.95], [0.1, 0.95], [0.1, 0.55], [0.9, 0.55], [0.9, 0.45], [0.1, 0.45], [0.1, 0.05], [0.9, 0.05]])]
};

function resample(stroke, step) {
  const out = [];
  for (let i = 0; i < stroke.length - 1; i++) {
    const a = stroke[i], b = stroke[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const segs = Math.max(1, Math.ceil(dist / step));
    for (let j = 0; j < segs; j++) {
      const t = j / segs;
      out.push({ x: a.x + dx * t, y: a.y + dy * t, blank: false });
    }
  }
  out.push({ ...stroke[stroke.length - 1], blank: false });
  return out;
}

function buildPath(text, step = 0.025, blankLen = 8, margin = 0.85) {
  const raw = [];
  let cursor = 0;
  const gap = 0.25;

  for (const c of text.toUpperCase()) {
    const strokes = LETTERS[c];
    if (!strokes) continue;
    for (const s of strokes) {
      const offset = s.map(p => ({ x: p.x + cursor, y: p.y }));
      raw.push(...resample(offset, step));
      for (let i = 0; i < blankLen; i++) raw.push({ x: 0, y: 0, blank: true });
    }
    cursor += 1 + gap;
  }

  // Normalise
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of raw) {
    if (p.blank) continue;
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const half = Math.max((maxX - minX) / 2, (maxY - minY) / 2, 0.001);

  return raw.map(p => p.blank
    ? { x: 0, y: 0, blank: true }
    : { x: ((p.x - cx) / half) * margin, y: ((p.y - cy) / half) * margin, blank: false }
  );
}

/**
 * AudioWorklet Processor for THÅST vector text
 */
class ThastVectorProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const config = options.processorOptions || {};
    this.pointsPerSecond = config.pointsPerSecond || 1200;
    this.outputScale = config.outputScale || 0.8;
    this.path = buildPath('THÅST', config.resampleStep, config.blankingLength, config.normalisationMargin);
    this.index = 0;
    this.running = true;

    this.port.onmessage = (e) => {
      if (e.data.type === 'stop') this.running = false;
      if (e.data.type === 'setScale') this.outputScale = e.data.value;
      if (e.data.type === 'setSpeed') this.pointsPerSecond = e.data.value;
    };
  }

  process(inputs, outputs) {
    if (!this.running) return false;

    const output = outputs[0];
    const outL = output[0];
    const outR = output[1];
    if (!outL || !outR) return true;

    const pps = this.pointsPerSecond;
    const scale = this.outputScale;
    const path = this.path;
    const len = path.length;
    const step = pps / sampleRate;

    for (let i = 0; i < outL.length; i++) {
      const idx = Math.floor(this.index) % len;
      const next = (idx + 1) % len;
      const frac = this.index - Math.floor(this.index);
      const p0 = path[idx];
      const p1 = path[next];

      let x = 0, y = 0;
      if (!p0.blank && !p1.blank) {
        x = p0.x + (p1.x - p0.x) * frac;
        y = p0.y + (p1.y - p0.y) * frac;
      }

      // Rotate 45° counter-clockwise for proper goniometer alignment
      // cos(-45°) = sin(-45°) = √2/2 ≈ 0.7071
      const cos45 = 0.7071067811865476;
      const rx = (x + y) * cos45;
      const ry = (y - x) * cos45;

      outL[i] = rx * scale;
      outR[i] = ry * scale;

      this.index += step;
      if (this.index >= len) this.index -= len;
    }

    return true;
  }
}

registerProcessor('thast-vector-processor', ThastVectorProcessor);
