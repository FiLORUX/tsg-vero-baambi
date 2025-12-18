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
 * TRANSITION GUARD MODULE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Prevents visual artifacts during EBU Stereo-ID pulse transitions.
 * Blanks meter displays for a brief period after gain changes.
 *
 * TIMING
 * ──────
 *   - 60ms blanking covers analyser buffer flush + 1 render frame
 *   - Triggered explicitly by EBU pulse logic only
 *
 * NOTE: Automatic edge detection was REMOVED because RMS jitter
 * caused false triggers → random blanking artifacts.
 *
 * @module app/transition-guard
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// TRANSITION GUARD SINGLETON
// ─────────────────────────────────────────────────────────────────────────────

const TransitionGuard = (function() {
  'use strict';

  let blankUntil = 0;
  // Blanking: 60ms covers analyser buffer flush + 1 render frame
  const BLANK_DURATION_MS = 60;

  return {
    /**
     * Trigger blanking period. Call when EBU pulse state changes.
     */
    trigger() {
      blankUntil = performance.now() + BLANK_DURATION_MS;
    },

    /**
     * Check if rendering should proceed.
     * @returns {boolean} True if blanking period has passed
     */
    shouldRender() {
      return performance.now() >= blankUntil;
    },

    /**
     * Check if currently in blanking period.
     * @returns {boolean} True if currently blanking
     */
    isBlanking() {
      return performance.now() < blankUntil;
    },

    /**
     * Reset blanking state. Call when generator stops.
     */
    reset() {
      blankUntil = 0;
    }
  };
})();

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export { TransitionGuard };
