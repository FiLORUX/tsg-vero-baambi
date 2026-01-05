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
 * SESSION CAPTURE INDICATOR
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Header indicator for session capture state. Shows:
 * - "Session" badge (neutral) when capture enabled but not recording
 * - "Session" badge (red pulse) when actively capturing
 *
 * Works with session-export.js for EBU R128-compliant loudness reports.
 *
 * @module ui/session-indicator
 * @see session-export.js
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { meterState, resetMeterState } from '../app/meter-state.js';
import { getSessionData, downloadSessionJSON, downloadSessionXML } from '../app/session-export.js';

// ─────────────────────────────────────────────────────────────────────────────
// SESSION STATE
// ─────────────────────────────────────────────────────────────────────────────

/** Whether session capture hotkey is enabled */
let hotkeyEnabled = false;

/** Whether session is currently capturing */
let isCapturing = false;

/** Callback for state changes */
let onStateChange = null;

// ─────────────────────────────────────────────────────────────────────────────
// SESSION INDICATOR CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Header session indicator component.
 * Shows session capture state with visual feedback.
 */
export class SessionIndicator {
  /**
   * @param {HTMLElement} container - The indicator container element
   * @param {Object} [options] - Configuration options
   * @param {Function} [options.onStateChange] - Callback when capture state changes
   */
  constructor(container, options = {}) {
    /** @type {HTMLElement} */
    this.container = container;

    /** @type {HTMLElement|null} */
    this._durationEl = null;

    /** @type {number|null} */
    this._updateInterval = null;

    onStateChange = options.onStateChange || null;

    this._init();
  }

  /**
   * Initialise the indicator.
   * @private
   */
  _init() {
    this._durationEl = this.container.querySelector('.session-duration');
    this._textEl = this.container.querySelector('.session-text');
    this.update();
  }

  /**
   * Update the indicator based on current state.
   */
  update() {
    if (!hotkeyEnabled) {
      this.container.style.display = 'none';
      this._stopDurationUpdate();
      return;
    }

    this.container.style.display = 'flex';

    if (isCapturing) {
      this.container.classList.add('session-capturing');
      this.container.classList.remove('session-idle');
      if (this._textEl) this._textEl.textContent = 'Capturing';
      this._startDurationUpdate();
    } else {
      this.container.classList.remove('session-capturing');
      this.container.classList.add('session-idle');
      if (this._textEl) this._textEl.textContent = 'Capture Armed';
      this._stopDurationUpdate();
      if (this._durationEl) this._durationEl.textContent = '';
    }
  }

  /**
   * Start updating duration display.
   * @private
   */
  _startDurationUpdate() {
    if (this._updateInterval) return;

    this._updateDuration();
    this._updateInterval = setInterval(() => this._updateDuration(), 1000);
  }

  /**
   * Stop updating duration display.
   * @private
   */
  _stopDurationUpdate() {
    if (this._updateInterval) {
      clearInterval(this._updateInterval);
      this._updateInterval = null;
    }
  }

  /**
   * Update duration display.
   * @private
   */
  _updateDuration() {
    if (!this._durationEl || !isCapturing) return;

    const elapsed = this._getElapsedSeconds();
    this._durationEl.textContent = this._formatDuration(elapsed);
  }

  /**
   * Get elapsed seconds since session start.
   * @private
   * @returns {number}
   */
  _getElapsedSeconds() {
    const raw = performance.now() - meterState.startTs;
    let pausedTime = meterState.totalPausedMs;

    if (meterState.measurementPaused && meterState.pausedAt) {
      pausedTime += performance.now() - meterState.pausedAt;
    }

    return (raw - pausedTime) / 1000;
  }

  /**
   * Format duration as MM:SS or HH:MM:SS.
   * @private
   * @param {number} seconds
   * @returns {string}
   */
  _formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * Clean up resources.
   */
  dispose() {
    this._stopDurationUpdate();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if session hotkey is enabled.
 * @returns {boolean}
 */
export function isSessionHotkeyEnabled() {
  return hotkeyEnabled;
}

/**
 * Enable or disable session hotkey.
 * @param {boolean} enabled
 */
export function setSessionHotkeyEnabled(enabled) {
  hotkeyEnabled = enabled;

  // If disabling while capturing, stop capture
  if (!enabled && isCapturing) {
    stopSessionCapture();
  }

  // Persist preference
  try {
    localStorage.setItem('tsg-session-hotkey', enabled ? '1' : '0');
  } catch (e) {
    // Ignore storage errors
  }

  if (onStateChange) onStateChange({ hotkeyEnabled, isCapturing });
}

/**
 * Check if session is currently capturing.
 * @returns {boolean}
 */
export function isSessionCapturing() {
  return isCapturing;
}

/**
 * Start session capture.
 * Resets integrated values and begins accumulating.
 */
export function startSessionCapture() {
  if (isCapturing) return;

  isCapturing = true;

  // Reset meter state to start fresh session
  resetMeterState();

  if (onStateChange) onStateChange({ hotkeyEnabled, isCapturing });
}

/**
 * Stop session capture.
 * Data remains available for export via getSessionData().
 */
export function stopSessionCapture() {
  if (!isCapturing) return;

  isCapturing = false;

  if (onStateChange) onStateChange({ hotkeyEnabled, isCapturing });
}

/**
 * Toggle session capture state.
 * @returns {boolean} New capturing state
 */
export function toggleSessionCapture() {
  if (isCapturing) {
    stopSessionCapture();
  } else {
    startSessionCapture();
  }
  return isCapturing;
}

/**
 * Load saved preferences from localStorage.
 */
export function loadSessionPreferences() {
  try {
    const saved = localStorage.getItem('tsg-session-hotkey');
    hotkeyEnabled = saved === '1';
  } catch (e) {
    hotkeyEnabled = false;
  }
}

/**
 * Export current session as JSON.
 * @param {Object} lufsMeter - LUFS meter instance
 * @param {number} [targetLufs=-23] - Target loudness
 */
export function exportSessionJSON(lufsMeter, targetLufs = -23) {
  downloadSessionJSON(lufsMeter, targetLufs);
}

/**
 * Export current session as XML (ADM).
 * @param {Object} lufsMeter - LUFS meter instance
 * @param {number} [targetLufs=-23] - Target loudness
 * @param {Object} [options] - XML export options
 */
export function exportSessionXML(lufsMeter, targetLufs = -23, options = {}) {
  downloadSessionXML(lufsMeter, targetLufs, null, options);
}
