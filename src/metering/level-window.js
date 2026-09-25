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
 * LEVEL WINDOW (SAMPLE PEAK AND RMS FROM BLOCK SUMMARIES)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * ───────
 * The sample-peak and dBFS (RMS) meters measure a window of the most recent
 * samples: in local metering, the analyser buffer. A source that cannot hand
 * over every sample, such as the native engine, instead reports summaries of
 * consecutive, non-overlapping blocks: the largest sample magnitude, the mean
 * square and the number of frames of each. This window rebuilds the same
 * measurement from those summaries, so the meters see every sample exactly
 * once and never a join between display snapshots.
 *
 * ALGORITHM
 * ─────────
 *   Keep the newest blocks whose frames add up to at least windowFrames.
 *   Peak  = max(peak of each block)
 *   RMS   = √( Σ meanSquare·frames / Σ frames )
 *
 * The RMS is the exact root mean square over the covered frames, not an
 * average of per-block RMS values, which would under-read unequal blocks.
 * Blocks are indivisible, so the window covers windowFrames rounded up to
 * whole blocks: at most one block longer.
 *
 * @module metering/level-window
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default number of blocks the window can hold. The native engine sends
 * about 120 packets per second, each of hundreds of frames, so a window of a
 * few thousand frames needs a handful; the bound only matters for a source
 * with absurdly small blocks, where the oldest go first.
 * @type {number}
 */
const DEFAULT_CAPACITY = 256;

// ─────────────────────────────────────────────────────────────────────────────
// LEVEL WINDOW CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sliding window over stereo block summaries.
 *
 * @example
 * const window = new LevelWindow({ windowFrames: 4096 });
 * // For each block of consecutive frames:
 * window.push(peakL, peakR, meanSquareL, meanSquareR, frames);
 * const { peakLeft, rmsLeft } = window.getState();
 */
export class LevelWindow {
  /** @type {number} */
  #windowFrames;

  /** @type {number} */
  #capacity;

  /** @type {Float64Array} Per-block largest magnitude, left */
  #peakL;

  /** @type {Float64Array} Per-block largest magnitude, right */
  #peakR;

  /** @type {Float64Array} Per-block mean square, left */
  #meanSquareL;

  /** @type {Float64Array} Per-block mean square, right */
  #meanSquareR;

  /** @type {Float64Array} Per-block frame count */
  #frames;

  /** @type {number} Ring index of the oldest block */
  #head = 0;

  /** @type {number} Blocks held */
  #count = 0;

  /** @type {number} Frames held */
  #totalFrames = 0;

  /**
   * @param {Object} options - Configuration options
   * @param {number} options.windowFrames - Frames the window must cover
   * @param {number} [options.capacity=DEFAULT_CAPACITY] - Maximum blocks held
   */
  constructor({ windowFrames, capacity = DEFAULT_CAPACITY }) {
    if (!(Number.isInteger(windowFrames) && windowFrames > 0)) {
      throw new RangeError(`windowFrames must be a positive integer, got ${windowFrames}`);
    }
    if (!(Number.isInteger(capacity) && capacity > 0)) {
      throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
    }
    this.#windowFrames = windowFrames;
    this.#capacity = capacity;
    this.#peakL = new Float64Array(capacity);
    this.#peakR = new Float64Array(capacity);
    this.#meanSquareL = new Float64Array(capacity);
    this.#meanSquareR = new Float64Array(capacity);
    this.#frames = new Float64Array(capacity);
  }

  /**
   * Frames the window must cover.
   * @returns {number}
   */
  get windowFrames() {
    return this.#windowFrames;
  }

  /**
   * Add the summary of the block that follows the previous one.
   *
   * A block without frames carries no signal and is ignored. A level that is
   * not a finite, non-negative number reads as silence, so a broken summary
   * cannot poison the window for as long as it stays in it.
   *
   * @param {number} peakLeft - Largest left sample magnitude, linear
   * @param {number} peakRight - Largest right sample magnitude, linear
   * @param {number} meanSquareLeft - Mean of the squared left samples
   * @param {number} meanSquareRight - Mean of the squared right samples
   * @param {number} frames - Stereo frames in the block
   */
  push(peakLeft, peakRight, meanSquareLeft, meanSquareRight, frames) {
    if (!(Number.isFinite(frames) && frames > 0)) return;

    if (this.#count === this.#capacity) this.#evictOldest();

    const index = (this.#head + this.#count) % this.#capacity;
    this.#peakL[index] = sanitise(peakLeft);
    this.#peakR[index] = sanitise(peakRight);
    this.#meanSquareL[index] = sanitise(meanSquareLeft);
    this.#meanSquareR[index] = sanitise(meanSquareRight);
    this.#frames[index] = frames;
    this.#count++;
    this.#totalFrames += frames;

    // Drop the oldest blocks the window no longer needs to cover windowFrames
    while (this.#count > 1 && this.#totalFrames - this.#frames[this.#head] >= this.#windowFrames) {
      this.#evictOldest();
    }
  }

  /**
   * Add a block summary in dBFS, as the native engine sends it: sample peak
   * as 20·log10 of the largest magnitude, RMS as 20·log10 of the RMS, and
   * −200 dBFS for silence. The RMS is squared back to the block's mean square,
   * so the window's RMS stays exact over its frames.
   *
   * @param {number} peakLeftDb - Left sample peak (dBFS)
   * @param {number} peakRightDb - Right sample peak (dBFS)
   * @param {number} rmsLeftDb - Left RMS (dBFS)
   * @param {number} rmsRightDb - Right RMS (dBFS)
   * @param {number} frames - Stereo frames in the block
   */
  pushDb(peakLeftDb, peakRightDb, rmsLeftDb, rmsRightDb, frames) {
    this.push(
      10 ** (peakLeftDb / 20),
      10 ** (peakRightDb / 20),
      10 ** (rmsLeftDb / 10),
      10 ** (rmsRightDb / 10),
      frames
    );
  }

  /**
   * Levels over the blocks in the window.
   *
   * @returns {LevelWindowState} Linear peak and RMS per channel, and the
   *   frames they cover; all zero while the window is empty
   */
  getState() {
    let peakLeft = 0;
    let peakRight = 0;
    let energyLeft = 0;
    let energyRight = 0;
    let frames = 0;

    for (let i = 0; i < this.#count; i++) {
      const index = (this.#head + i) % this.#capacity;
      const blockFrames = this.#frames[index];
      if (this.#peakL[index] > peakLeft) peakLeft = this.#peakL[index];
      if (this.#peakR[index] > peakRight) peakRight = this.#peakR[index];
      energyLeft += this.#meanSquareL[index] * blockFrames;
      energyRight += this.#meanSquareR[index] * blockFrames;
      frames += blockFrames;
    }

    return {
      peakLeft,
      peakRight,
      rmsLeft: frames > 0 ? Math.sqrt(energyLeft / frames) : 0,
      rmsRight: frames > 0 ? Math.sqrt(energyRight / frames) : 0,
      frames
    };
  }

  /**
   * Empty the window.
   */
  reset() {
    this.#head = 0;
    this.#count = 0;
    this.#totalFrames = 0;
  }

  #evictOldest() {
    this.#totalFrames -= this.#frames[this.#head];
    this.#head = (this.#head + 1) % this.#capacity;
    this.#count--;
  }
}

/**
 * @param {number} value - Linear level
 * @returns {number} The level, or 0 if it is not a finite, non-negative number
 */
function sanitise(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * @typedef {Object} LevelWindowState
 * @property {number} peakLeft - Largest left sample magnitude in the window, linear
 * @property {number} peakRight - Largest right sample magnitude in the window, linear
 * @property {number} rmsLeft - Left RMS over the window, linear
 * @property {number} rmsRight - Right RMS over the window, linear
 * @property {number} frames - Frames covered by the window
 */
