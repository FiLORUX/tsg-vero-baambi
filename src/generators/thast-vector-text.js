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
 * THÅST VECTOR TEXT GENERATOR
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Produces X/Y coordinate pairs that trace the word "THÅST" as vector strokes.
 * Designed for goniometer/oscilloscope display where L=X and R=Y.
 *
 * The output is a continuous stream of points with embedded blanking segments
 * that create clean pen-up transitions between strokes.
 *
 * @module generators/thast-vector-text
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export const DEFAULT_CONFIG = {
  /** Points emitted per second — higher values yield more stable display */
  pointsPerSecond: 1200,
  /** Output amplitude scaling [0–1] */
  outputScale: 0.8,
  /** Margin within the [-1, 1] coordinate space */
  normalisationMargin: 0.85,
  /** Distance between resampled points (smaller = smoother strokes) */
  resampleStep: 0.025,
  /** Number of blanking points inserted between strokes */
  blankingLength: 8
};


/*
 * ---------------------------------------------------------------------------
 * Vector Letter Definitions
 *
 * Each letter is an array of polylines (strokes).
 * Coordinates use a 1×1 unit cell with baseline at y=0, cap height at y=1.
 * ---------------------------------------------------------------------------
 */

/**
 * Creates a polyline from coordinate pairs.
 * @param {Array<[number, number]>} points
 * @returns {Array<{x: number, y: number}>}
 */
function polyline(points) {
  return points.map(([x, y]) => ({ x, y }));
}

/**
 * Generates a circular polyline for diacritical marks.
 * @param {number} centreX
 * @param {number} centreY
 * @param {number} radius
 * @param {number} segments
 * @returns {Array<{x: number, y: number}>}
 */
function createRing(centreX, centreY, radius, segments = 16) {
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push({
      x: centreX + Math.cos(angle) * radius,
      y: centreY + Math.sin(angle) * radius
    });
  }
  return points;
}

const LETTER_STROKES = {
  T: [
    polyline([[0, 1], [1, 1]]),
    polyline([[0.5, 1], [0.5, 0]])
  ],

  H: [
    polyline([[0, 0], [0, 1]]),
    polyline([[1, 0], [1, 1]]),
    polyline([[0, 0.5], [1, 0.5]])
  ],

  Å: [
    polyline([[0, 0], [0.5, 1], [1, 0]]),
    polyline([[0.2, 0.4], [0.8, 0.4]]),
    createRing(0.5, 1.22, 0.12)
  ],

  S: [
    /*
     * Angular S provides crisp edges on vector displays.
     * Curved alternatives tend to appear wobbly at low point rates.
     */
    polyline([
      [0.9, 0.95], [0.1, 0.95], [0.1, 0.55],
      [0.9, 0.55], [0.9, 0.45],
      [0.1, 0.45], [0.1, 0.05], [0.9, 0.05]
    ])
  ],

  /*
   * Additional letters can be added here following the same pattern.
   * Ensure each stroke forms a continuous path for proper beam tracing.
   */
};


/*
 * ---------------------------------------------------------------------------
 * Path Construction
 * ---------------------------------------------------------------------------
 */

/**
 * Resamples a polyline into evenly-spaced points.
 * This ensures consistent beam velocity across strokes of varying length.
 * @param {Array<{x: number, y: number}>} stroke
 * @param {number} step
 * @returns {Array<{x: number, y: number, blank: boolean}>}
 */
function resamplePolyline(stroke, step) {
  const output = [];

  for (let i = 0; i < stroke.length - 1; i++) {
    const a = stroke[i];
    const b = stroke[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.hypot(dx, dy);
    const segments = Math.max(1, Math.ceil(distance / step));

    for (let j = 0; j < segments; j++) {
      const t = j / segments;
      output.push({
        x: a.x + dx * t,
        y: a.y + dy * t,
        blank: false
      });
    }
  }

  const last = stroke[stroke.length - 1];
  output.push({ x: last.x, y: last.y, blank: false });

  return output;
}

/**
 * Creates blanking points that return the beam to centre.
 * These act as pen-up commands between strokes.
 * @param {number} count
 * @returns {Array<{x: number, y: number, blank: boolean}>}
 */
function createBlankingSegment(count) {
  return Array.from({ length: count }, () => ({
    x: 0,
    y: 0,
    blank: true
  }));
}

/**
 * Builds the complete point path for a text string.
 * Returns normalised coordinates in the range [-margin, +margin].
 * @param {string} text
 * @param {Partial<typeof DEFAULT_CONFIG>} config
 * @returns {Array<{x: number, y: number, blank: boolean}>}
 */
export function buildTextPath(text, config = {}) {
  const {
    resampleStep = DEFAULT_CONFIG.resampleStep,
    blankingLength = DEFAULT_CONFIG.blankingLength,
    normalisationMargin = DEFAULT_CONFIG.normalisationMargin
  } = config;

  const letterWidth = 1.0;
  const letterGap = 0.25;

  const rawPoints = [];
  let cursorX = 0;

  for (const char of text.toUpperCase()) {
    const strokes = LETTER_STROKES[char];
    if (!strokes) continue;

    for (const stroke of strokes) {
      /*
       * Offset stroke coordinates by current cursor position.
       */
      const offsetStroke = stroke.map(p => ({
        x: p.x * letterWidth + cursorX,
        y: p.y
      }));

      const resampled = resamplePolyline(offsetStroke, resampleStep);
      rawPoints.push(...resampled);
      rawPoints.push(...createBlankingSegment(blankingLength));
    }

    cursorX += letterWidth + letterGap;
  }

  /*
   * Compute bounding box from non-blank points.
   */
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const p of rawPoints) {
    if (p.blank) continue;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;
  const halfWidth = Math.max(0.001, (maxX - minX) / 2);
  const halfHeight = Math.max(0.001, (maxY - minY) / 2);

  /*
   * Normalise to [-margin, +margin] range.
   * Aspect ratio is preserved by using the larger dimension.
   */
  const halfExtent = Math.max(halfWidth, halfHeight);

  return rawPoints.map(p => {
    if (p.blank) {
      return { x: 0, y: 0, blank: true };
    }
    return {
      x: ((p.x - centreX) / halfExtent) * normalisationMargin,
      y: ((p.y - centreY) / halfExtent) * normalisationMargin,
      blank: false
    };
  });
}


/*
 * ---------------------------------------------------------------------------
 * Generator Class
 * ---------------------------------------------------------------------------
 */

/**
 * THÅST Vector Text Generator
 *
 * Generates X/Y coordinates for vector display of "THÅST" text.
 */
export class ThastVectorTextGenerator {
  /**
   * @param {Partial<typeof DEFAULT_CONFIG>} config
   */
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.path = buildTextPath('THÅST', this.config);
    this.index = 0;
  }

  /**
   * Resets the generator to the beginning of the path.
   */
  reset() {
    this.index = 0;
  }

  /**
   * Generates the next sample pair (x, y).
   * Call this at your audio sample rate.
   *
   * @param {number} sampleRate - Current audio sample rate in Hz
   * @returns {[number, number]} Tuple of [leftChannel, rightChannel] values
   */
  nextSample(sampleRate) {
    const pointsPerSample = this.config.pointsPerSecond / sampleRate;

    const currentIndex = Math.floor(this.index) % this.path.length;
    const nextIndex = (currentIndex + 1) % this.path.length;
    const fraction = this.index - Math.floor(this.index);

    const p0 = this.path[currentIndex];
    const p1 = this.path[nextIndex];

    let x = 0;
    let y = 0;

    /*
     * Interpolate between adjacent points unless either is blanking.
     * Blanking points output zero, creating clean pen-up segments.
     */
    if (!p0.blank && !p1.blank) {
      x = p0.x + (p1.x - p0.x) * fraction;
      y = p0.y + (p1.y - p0.y) * fraction;
    }

    this.index += pointsPerSample;
    if (this.index >= this.path.length) {
      this.index -= this.path.length;
    }

    const scale = this.config.outputScale;
    return [x * scale, y * scale];
  }

  /**
   * Fills stereo buffers with generated samples.
   * Convenience method for block-based audio processing.
   *
   * @param {Float32Array} leftChannel - Output buffer for left/X channel
   * @param {Float32Array} rightChannel - Output buffer for right/Y channel
   * @param {number} sampleRate - Current audio sample rate in Hz
   */
  fillBuffers(leftChannel, rightChannel, sampleRate) {
    for (let i = 0; i < leftChannel.length; i++) {
      const [l, r] = this.nextSample(sampleRate);
      leftChannel[i] = l;
      rightChannel[i] = r;
    }
  }

  /**
   * Returns the current path for visualisation or debugging.
   * @returns {ReadonlyArray<{x: number, y: number, blank: boolean}>}
   */
  getPath() {
    return this.path;
  }
}
