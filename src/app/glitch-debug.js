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
 * GLITCH DEBUG MODULE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Debug utility for monitoring audio anomalies during development.
 * Detects buffer timing issues, correlation drops, and channel imbalances.
 *
 * USAGE
 * ─────
 *   // Enable in browser console:
 *   GlitchDebug.enabled = true;
 *   GlitchDebug.reset();
 *
 *   // After running tests:
 *   GlitchDebug.summary();
 *
 * DETECTED ANOMALIES
 * ──────────────────
 *   - LONG_FRAME: Browser throttling (>100ms frame)
 *   - CORR_DROP: Sudden correlation decrease
 *   - L_DROP/R_DROP: Single channel amplitude drop
 *   - IMBALANCE: Channel level imbalance
 *   - DISCONTINUITY: Large sample jump (glitch)
 *
 * @module app/glitch-debug
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// GLITCH DEBUG SINGLETON
// ─────────────────────────────────────────────────────────────────────────────

const GlitchDebug = {
  enabled: false,  // Disabled by default. Enable in console: GlitchDebug.enabled = true
  lastFrameTime: performance.now(),
  lastCorrelation: 1,
  lastRmsL: 0,
  lastRmsR: 0,
  frameCount: 0,
  startTime: performance.now(),
  glitchLog: [], // Store detected glitches

  /**
   * Analyse audio buffers for anomalies.
   * Called once per render frame.
   *
   * @param {Float32Array} bufL - Left channel buffer
   * @param {Float32Array} bufR - Right channel buffer
   * @param {number} frameTime - Current frame timestamp (performance.now())
   */
  analyze(bufL, bufR, frameTime) {
    if (!this.enabled) return;

    const frameDelta = frameTime - this.lastFrameTime;
    this.frameCount++;
    const elapsed = (frameTime - this.startTime) / 1000;

    // Calculate current frame metrics
    let sumL = 0, sumR = 0, sumLR = 0;
    let maxL = 0, maxR = 0;
    for (let i = 0; i < bufL.length; i++) {
      sumL += bufL[i] * bufL[i];
      sumR += bufR[i] * bufR[i];
      sumLR += bufL[i] * bufR[i];
      maxL = Math.max(maxL, Math.abs(bufL[i]));
      maxR = Math.max(maxR, Math.abs(bufR[i]));
    }
    const rmsL = Math.sqrt(sumL / bufL.length);
    const rmsR = Math.sqrt(sumR / bufR.length);
    const correlation = sumLR / (Math.sqrt(sumL * sumR) + 1e-10);

    // Only analyse when we have signal (not silence)
    const hasSignal = rmsL > 0.005 || rmsR > 0.005;

    const anomalies = [];

    // 1. Long frame (>100ms = definitely browser throttling)
    if (frameDelta > 100) {
      anomalies.push(`LONG_FRAME: ${frameDelta.toFixed(0)}ms`);
    }

    // Signal-dependent checks (only when generator is active)
    if (hasSignal) {
      // 2. Correlation drop (only if previous frame also had signal)
      if (this.lastRmsL > 0.01 && this.lastCorrelation > 0.9 && correlation < 0.5) {
        anomalies.push(`CORR_DROP: ${this.lastCorrelation.toFixed(2)} → ${correlation.toFixed(2)}`);
      }

      // 3. Sudden amplitude drop on one channel only
      if (this.lastRmsL > 0.01 && this.lastRmsR > 0.01) {
        const ratioL = rmsL / this.lastRmsL;
        const ratioR = rmsR / this.lastRmsR;
        if (ratioL < 0.5 && ratioR > 0.8) {
          anomalies.push(`L_DROP: ${this.lastRmsL.toFixed(4)} → ${rmsL.toFixed(4)}`);
        }
        if (ratioR < 0.5 && ratioL > 0.8) {
          anomalies.push(`R_DROP: ${this.lastRmsR.toFixed(4)} → ${rmsR.toFixed(4)}`);
        }
      }

      // 4. Channel imbalance
      const balance = rmsL / (rmsR + 1e-10);
      if (rmsL > 0.01 && rmsR > 0.01 && (balance < 0.7 || balance > 1.4)) {
        anomalies.push(`IMBALANCE: L/R=${balance.toFixed(2)}`);
      }

      // 5. Sample discontinuity - look for very large jumps (near full-scale)
      // This would indicate a true glitch, not normal audio
      let maxJump = 0, maxJumpIdx = 0;
      for (let i = 1; i < bufL.length; i++) {
        const jump = Math.abs(bufL[i] - bufL[i - 1]);
        if (jump > maxJump) { maxJump = jump; maxJumpIdx = i; }
      }
      // Flag only extreme discontinuities (>80% of full scale)
      if (maxJump > 0.8 && maxL > 0.1) {
        anomalies.push(`DISCONTINUITY: ${maxJump.toFixed(3)} @${maxJumpIdx}`);
      }
    }

    // Log if anomalies detected
    if (anomalies.length > 0) {
      this.glitchLog.push({ time: elapsed, anomalies: anomalies.join(' | ') });
      console.warn(
        `%c[GLITCH @${elapsed.toFixed(2)}s]%c ${anomalies.join(' | ')}`,
        'color: #ff6b6b; font-weight: bold',
        'color: #ffd93d'
      );
    }

    // Update state
    this.lastFrameTime = frameTime;
    this.lastCorrelation = hasSignal ? correlation : this.lastCorrelation;
    this.lastRmsL = rmsL;
    this.lastRmsR = rmsR;
  },

  /**
   * Reset debug state. Call after starting generator.
   */
  reset() {
    this.startTime = performance.now();
    this.lastFrameTime = performance.now();
    this.frameCount = 0;
    this.lastCorrelation = 1;
    this.lastRmsL = 0;
    this.lastRmsR = 0;
    this.glitchLog = [];
    console.log('%c[GLITCH DEBUG] Reset - watching for anomalies...', 'color: #4ecdc4; font-weight: bold');
  },

  /**
   * Print summary of detected glitches.
   * @returns {Array} Array of glitch events
   */
  summary() {
    const longFrames = this.glitchLog.filter(g => g.anomalies.includes('LONG_FRAME')).length;
    const disc = this.glitchLog.filter(g => g.anomalies.includes('DISCONTINUITY')).length;
    console.log(`%c[SUMMARY] ${this.glitchLog.length} events: ${longFrames} long frames, ${disc} discontinuities`, 'color: #4ecdc4; font-weight: bold');
    return this.glitchLog;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export { GlitchDebug };

// Expose to window for console access
if (typeof window !== 'undefined') {
  window.GlitchDebug = GlitchDebug;
  console.log('%c[GLITCH DEBUG] Active - use GlitchDebug.reset() after starting generator', 'color: #4ecdc4; font-weight: bold');
}
