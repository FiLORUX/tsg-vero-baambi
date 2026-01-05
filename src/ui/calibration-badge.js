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
 * CALIBRATION STATUS BADGE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Visual indicator showing calibration status for current input source.
 * Updates automatically when input device changes.
 *
 * STATES
 * ──────
 *   Calibrated:    Green badge, shows profile name and age
 *   Uncalibrated:  Amber badge, prompts user to calibrate
 *   Stale:         Amber badge, calibration older than 30 days
 *   N/A:           Grey badge, generator mode (no calibration needed)
 *
 * @module ui/calibration-badge
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { getProfileForDevice, REFERENCE_STANDARDS } from '../calibration/index.js';
import { appState, InputMode } from '../app/state.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Age threshold for stale calibration (days) */
const STALE_THRESHOLD_DAYS = 30;

/** Age threshold for warning indicator (days) */
const WARNING_THRESHOLD_DAYS = 14;

// ─────────────────────────────────────────────────────────────────────────────
// CALIBRATION STATUS BADGE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calibration status badge component.
 *
 * @example
 * const badge = new CalibrationStatusBadge(document.getElementById('calBadge'));
 * badge.onCalibrationClick = () => openCalibrationWizard();
 */
export class CalibrationStatusBadge {
  /**
   * @param {HTMLElement} container - Container element for badge
   */
  constructor(container) {
    /** @type {HTMLElement} */
    this.container = container;

    /** @type {Function|null} */
    this.onCalibrationClick = null;

    /** @type {Function|null} */
    this._unsubscribe = null;

    this._render();
    this._subscribe();
    this.update();
  }

  /**
   * Clean up subscriptions.
   */
  dispose() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  }

  /**
   * Force update of badge state.
   */
  update() {
    const inputMode = appState.get('inputMode');

    // Generator mode: no calibration applicable
    if (inputMode === InputMode.GENERATOR) {
      this._setNA();
      return;
    }

    const deviceId = this._getCurrentDeviceId();
    if (!deviceId) {
      this._setUncalibrated();
      return;
    }

    const profile = getProfileForDevice(deviceId);
    if (!profile) {
      this._setUncalibrated();
      return;
    }

    // Calculate age
    const age = Date.now() - profile.calibratedAt;
    const daysOld = age / (1000 * 60 * 60 * 24);

    if (daysOld > STALE_THRESHOLD_DAYS) {
      this._setStale(profile, daysOld);
    } else if (daysOld > WARNING_THRESHOLD_DAYS) {
      this._setCalibrated(profile, daysOld, true);
    } else {
      this._setCalibrated(profile, daysOld, false);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE
  // ═══════════════════════════════════════════════════════════════════════════

  /** @private */
  _render() {
    this.container.innerHTML = `
      <div class="cal-badge-wrap">
        <button class="cal-badge" id="calBadgeBtn" title="Click to open calibration">
          <span class="cal-badge-title">Calibration Profile Tool</span>
          <span class="cal-badge-status">
            <span class="cal-badge-icon"></span>
            <span class="cal-badge-text"></span>
          </span>
        </button>
      </div>
    `;

    this._badge = this.container.querySelector('#calBadgeBtn');
    this._icon = this.container.querySelector('.cal-badge-icon');
    this._text = this.container.querySelector('.cal-badge-text');

    this._badge.addEventListener('click', () => {
      if (!this._badge.disabled) {
        this.onCalibrationClick?.();
      }
    });
  }

  /** @private */
  _subscribe() {
    this._unsubscribe = appState.subscribe((state, changed) => {
      if (changed.deviceId || changed.inputMode || changed.calibrationRevision) {
        this.update();
      }
    });
  }

  /** @private */
  _getCurrentDeviceId() {
    const mode = appState.get('inputMode');
    if (mode === InputMode.BROWSER) return 'browser';
    if (mode === InputMode.EXTERNAL) return appState.get('deviceId') || null;
    return null;
  }

  /** @private */
  _setCalibrated(profile, daysOld, showWarning) {
    const standard = REFERENCE_STANDARDS[profile.referenceStandard];
    const standardName = standard?.name || profile.referenceStandard;
    const trimOffset = profile.trimOffset ?? 0;
    const trimStr = `${trimOffset > 0 ? '+' : ''}${trimOffset.toFixed(1)} dB`;

    this._badge.className = `cal-badge cal-calibrated ${showWarning ? 'cal-warning' : ''}`;
    this._badge.disabled = false;
    this._icon.textContent = '✓';
    this._text.innerHTML = `<span class="cal-badge-profile">${profile.profileName}</span>`;
    this._badge.title = `${profile.profileName}\n` +
      `Standard: ${standardName}\n` +
      `Trim: ${trimStr}\n` +
      `Age: ${Math.floor(daysOld)} days`;
  }

  /** @private */
  _setStale(profile, daysOld) {
    this._badge.className = 'cal-badge cal-stale';
    this._badge.disabled = false;
    this._icon.textContent = '⚠';
    this._text.innerHTML = `<span class="cal-badge-profile">${profile.profileName}</span> <span class="cal-badge-detail">(${Math.floor(daysOld)}d)</span>`;
    this._badge.title = `Calibration is ${Math.floor(daysOld)} days old.\n` +
      `Recommend re-calibration for accuracy.`;
  }

  /** @private */
  _setUncalibrated() {
    this._badge.className = 'cal-badge cal-uncalibrated';
    this._badge.disabled = false;
    this._icon.textContent = '⚠';
    this._text.textContent = 'Not Calibrated';
    this._badge.title = 'No calibration profile for this input.\n' +
      'Click to calibrate.';
  }

  /** @private */
  _setNA() {
    this._badge.className = 'cal-badge cal-na';
    this._badge.disabled = true;
    this._icon.textContent = '⊘';
    this._text.textContent = 'N/A';
    this._badge.title = 'Calibration not applicable for signal generator.';
  }
}
