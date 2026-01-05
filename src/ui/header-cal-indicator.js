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
 * HEADER CALIBRATION INDICATOR
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Shows calibration status in the header bar. Only visible when the current
 * input source has an active calibration profile.
 *
 * @module ui/header-cal-indicator
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { getProfileForDevice, REFERENCE_STANDARDS } from '../calibration/index.js';
import { appState, InputMode } from '../app/state.js';

// ─────────────────────────────────────────────────────────────────────────────
// HEADER CALIBRATION INDICATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Header calibration indicator component.
 * Shows source type and calibration status when calibrated.
 * Also updates the sidebar status box if configured.
 */
export class HeaderCalIndicator {
  /**
   * @param {HTMLElement} container - The indicator container element
   * @param {Object} [options] - Configuration options
   * @param {HTMLElement} [options.statusBox] - Optional status box element in sidebar
   * @param {HTMLElement} [options.statusProfile] - Profile name element in status box
   * @param {HTMLElement} [options.statusStandard] - Standard element in status box
   */
  constructor(container, options = {}) {
    /** @type {HTMLElement} */
    this.container = container;

    /** @type {HTMLElement|null} */
    this._standardEl = null;

    /** @type {HTMLElement|null} - Status box container */
    this._statusBox = options.statusBox || null;

    /** @type {HTMLElement|null} - Profile name in status box */
    this._statusProfile = options.statusProfile || null;

    /** @type {HTMLElement|null} - Standard in status box */
    this._statusStandard = options.statusStandard || null;

    /** @type {Function|null} */
    this._unsubscribe = null;

    this._init();
  }

  /**
   * Initialise and subscribe to state changes.
   * @private
   */
  _init() {
    this._standardEl = this.container.querySelector('#headerCalStandard');

    // Subscribe to relevant state changes
    this._unsubscribe = appState.subscribe((state, changed) => {
      if (changed.deviceId || changed.inputMode || changed.calibrationRevision) {
        this.update();
      }
    });

    // Initial update
    this.update();
  }

  /**
   * Update the indicator based on current state.
   */
  update() {
    const inputMode = appState.get('inputMode');

    // Generator mode: no calibration applicable
    if (inputMode === InputMode.GENERATOR) {
      this._hideHeader();
      this._updateStatusBox('N/A', 'N/A');
      return;
    }

    const deviceId = this._getCurrentDeviceId();
    if (!deviceId) {
      this._hide();
      return;
    }

    const profile = getProfileForDevice(deviceId);
    if (!profile) {
      this._hide();
      return;
    }

    // We have an active calibration - show the indicator
    this._show(profile, inputMode);
  }

  /**
   * Show the indicator with profile data.
   * @private
   * @param {Object} profile - Calibration profile
   * @param {string} inputMode - Current input mode
   */
  _show(profile, inputMode) {
    const standard = REFERENCE_STANDARDS[profile.referenceStandard];
    const standardName = standard?.name || profile.referenceStandard;

    // Update header indicator
    if (this._standardEl) {
      this._standardEl.textContent = standardName;
    }

    // Show with glow animation
    const wasHidden = this.container.style.display === 'none';
    this.container.style.display = 'flex';

    // Trigger glow animation if newly shown
    if (wasHidden) {
      this.container.classList.remove('cal-glow-in');
      // Force reflow to restart animation
      void this.container.offsetWidth;
      this.container.classList.add('cal-glow-in');
    }

    // Update sidebar status box
    this._updateStatusBox(profile.profileName, standardName);
  }

  /**
   * Hide the header indicator only.
   * @private
   */
  _hideHeader() {
    this.container.style.display = 'none';
  }

  /**
   * Hide the indicator and set status box to inactive.
   * @private
   */
  _hide() {
    this._hideHeader();

    // Update sidebar status box to inactive state
    this._updateStatusBox('–', '–');
  }

  /**
   * Update the sidebar status box.
   * @private
   * @param {string} profileName - Profile name to display
   * @param {string} standardName - Standard name to display
   */
  _updateStatusBox(profileName, standardName) {
    if (this._statusProfile) {
      this._statusProfile.textContent = profileName;
    }
    if (this._statusStandard) {
      this._statusStandard.textContent = standardName;
    }
  }

  /**
   * Get current device ID based on input mode.
   * @private
   * @returns {string|null}
   */
  _getCurrentDeviceId() {
    const mode = appState.get('inputMode');
    if (mode === InputMode.BROWSER) return 'browser';
    if (mode === InputMode.EXTERNAL) return appState.get('deviceId') || null;
    return null;
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
}
