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
 * CALIBRATION WIZARD
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Modal dialog for automatic and manual calibration workflows.
 * Guides user through reference selection, measurement, and profile saving.
 *
 * WORKFLOW MODES
 * ──────────────
 *   Auto:    System plays reference tone, measures, calculates offset
 *   Manual:  User adjusts trim whilst monitoring LUFS-I
 *
 * UI STRUCTURE
 * ────────────
 *   1. Mode selection (auto vs manual)
 *   2. Configuration (reference standard, profile name)
 *   3. Measurement/adjustment
 *   4. Verification and save
 *
 * @module ui/calibration-wizard
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  CalibrationEngine,
  REFERENCE_STANDARDS,
  CALIBRATION_TONE,
  getProfileForDevice,
  deleteCalibrationProfile,
  setActiveProfile,
  deactivateProfile,
  deactivateAllProfiles,
  saveCalibrationProfile,
  downloadProfiles,
  importProfilesFromFile,
  getCalibrationProfiles,
  getProfileSummaries,
  generateProfileName,
  getUniqueProfileName
} from '../calibration/index.js';
import { appState, InputMode } from '../app/state.js';

// ─────────────────────────────────────────────────────────────────────────────
// CALIBRATION WIZARD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calibration wizard modal component.
 *
 * @example
 * const wizard = new CalibrationWizard(container, engine);
 * wizard.onComplete = (profile) => console.log('Saved:', profile);
 * wizard.open();
 * // Later...
 * wizard.close();
 */
export class CalibrationWizard {
  /**
   * @param {HTMLElement} container - Container element for wizard (used for cleanup tracking)
   * @param {CalibrationEngine} engine - Calibration engine instance (already configured)
   */
  constructor(container, engine) {
    /** @type {HTMLElement} */
    this._container = container;

    /** @type {CalibrationEngine} */
    this.engine = engine;

    /** @type {HTMLElement|null} */
    this._modal = null;

    /** @type {HTMLElement|null} */
    this._body = null;

    /** @type {HTMLElement|null} */
    this._title = null;

    /** @type {'auto'|'manual'|null} */
    this._currentMode = null;

    /** @type {Object|null} Pending profile awaiting user save confirmation */
    this._pendingProfile = null;

    /** @type {Function|null} */
    this.onComplete = null;

    /** @type {Function|null} */
    this.onCancel = null;
  }

  /**
   * Show the calibration wizard.
   */
  show() {
    this._createModal();
    this._showModeSelection();
    document.body.appendChild(this._modal);
  }

  /**
   * Alias for show().
   */
  open() {
    this.show();
  }

  /**
   * Hide and destroy the wizard.
   * @param {boolean} [isCancel=true] - Whether this is a cancellation (triggers onCancel)
   */
  hide(isCancel = true) {
    if (this.engine.isCalibrating) {
      this.engine.cancel();
    }
    this._modal?.remove();
    this._modal = null;
    this._body = null;
    this._title = null;
    this._currentMode = null;

    if (isCancel) {
      this.onCancel?.();
    }
  }

  /**
   * Alias for hide().
   */
  close() {
    this.hide(true);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: MODAL STRUCTURE
  // ═══════════════════════════════════════════════════════════════════════════

  /** @private */
  _createModal() {
    this._modal = document.createElement('div');
    this._modal.className = 'cal-modal-overlay';
    this._modal.innerHTML = `
      <div class="cal-modal">
        <div class="cal-modal-header">
          <h2 id="calModalTitle">Calibration Profile Tool</h2>
          <button class="cal-modal-close" id="calModalClose" title="Close">×</button>
        </div>
        <div class="cal-modal-body" id="calModalBody"></div>
      </div>
    `;

    this._modal.querySelector('#calModalClose').onclick = () => this.hide();
    this._modal.onclick = (e) => {
      if (e.target === this._modal) this.hide();
    };

    this._body = this._modal.querySelector('#calModalBody');
    this._title = this._modal.querySelector('#calModalTitle');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: MODE SELECTION
  // ═══════════════════════════════════════════════════════════════════════════

  /** @private */
  _showModeSelection() {
    this._title.textContent = 'Calibration Profile Tool';

    const deviceId = this._getCurrentDeviceId();
    const deviceLabel = this._getCurrentDeviceLabel();
    const existingProfile = getProfileForDevice(deviceId);

    this._body.innerHTML = `
      <div class="cal-mode-select">
        <div class="cal-device-info">
          <span class="cal-device-label">Input:</span>
          <span class="cal-device-name">${this._escapeHtml(deviceLabel)}</span>
          ${existingProfile ? `
            <div class="cal-existing-profile">
              <span class="cal-existing-label">Current profile:</span>
              <span class="cal-existing-name">${this._escapeHtml(existingProfile.profileName)}</span>
              <span class="cal-existing-meta">
                ${REFERENCE_STANDARDS[existingProfile.referenceStandard]?.name || existingProfile.referenceStandard}
                · ${existingProfile.method === 'auto' ? 'Auto' : 'Manual'}
              </span>
            </div>
          ` : ''}
        </div>

        <div class="cal-mode-cards">
          <button class="cal-mode-card" id="btnAutoCalibrate">
            <div class="cal-mode-icon">⚡</div>
            <div class="cal-mode-title">Auto-Calibrate</div>
            <div class="cal-mode-desc">
              System generates 1 kHz reference tone at −18 dBFS and
              automatically calculates trim offset. Duration: ~30 seconds.
            </div>
            <div class="cal-mode-badge cal-mode-recommended">Recommended</div>
          </button>

          <button class="cal-mode-card" id="btnManualCalibrate">
            <div class="cal-mode-icon">🎛</div>
            <div class="cal-mode-title">Manual Calibrate</div>
            <div class="cal-mode-desc">
              Adjust trim whilst monitoring integrated loudness.
              Use with external reference signal or for precision matching.
            </div>
          </button>
        </div>

        ${existingProfile ? `
          <div class="cal-existing-actions">
            <button class="btn-ghost cal-btn-delete" id="btnDeleteProfile">
              Delete Existing Profile
            </button>
          </div>
        ` : ''}

        <div class="cal-profile-io">
          <div class="cal-profile-io-title">Profile Management</div>
          <div class="cal-profile-io-buttons">
            <button class="btn-ghost" id="btnManageProfiles" ${this._getProfileCount() === 0 ? 'disabled' : ''}>
              View All Profiles (${this._getProfileCount()})
            </button>
          </div>
          <div class="cal-profile-io-buttons" style="margin-top: 8px;">
            <button class="btn-ghost" id="btnExportProfiles" ${this._getProfileCount() === 0 ? 'disabled' : ''}>
              Export
            </button>
            <button class="btn-ghost" id="btnImportProfiles">
              Import
            </button>
          </div>
        </div>
      </div>
    `;

    this._body.querySelector('#btnAutoCalibrate').onclick = () => this._showAutoSetup();
    this._body.querySelector('#btnManualCalibrate').onclick = () => this._showManualSetup();

    const deleteBtn = this._body.querySelector('#btnDeleteProfile');
    if (deleteBtn && existingProfile) {
      deleteBtn.onclick = () => this._confirmDeleteProfile(existingProfile.id, existingProfile.profileName);
    }

    this._body.querySelector('#btnManageProfiles')?.addEventListener('click', () => this._showProfileList());
    this._body.querySelector('#btnExportProfiles').onclick = () => this._handleExport();
    this._body.querySelector('#btnImportProfiles').onclick = () => this._handleImport();
  }

  /** @private */
  _confirmDeleteProfile(profileId, profileName) {
    if (confirm(`Delete profile "${profileName}"? This cannot be undone.`)) {
      deleteCalibrationProfile(profileId);
      this._showModeSelection();
    }
  }

  /** @private */
  _showProfileList() {
    this._title.textContent = 'All Calibration Profiles';

    const profiles = getProfileSummaries();
    const currentDeviceId = this._getCurrentDeviceId();

    // Check if current source has an active profile (for disable button)
    const hasActiveForCurrentSource = profiles.some(p =>
      p.deviceId === currentDeviceId && p.isActive
    );

    if (profiles.length === 0) {
      this._body.innerHTML = `
        <div class="cal-profile-list-empty">
          <p>No calibration profiles saved.</p>
          <div class="cal-actions">
            <button class="btn-ghost" id="calBack">← Back</button>
          </div>
        </div>
      `;
      this._body.querySelector('#calBack').onclick = () => this._showModeSelection();
      return;
    }

    // Sort: active first, then by date (newest first)
    profiles.sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return b.calibratedAt - a.calibratedAt;
    });

    const profileRows = profiles.map(p => {
      const date = new Date(p.calibratedAt);
      // ISO format: YYYY-MM-DD HH:mm
      const dateStr = date.toISOString().slice(0, 10);
      const timeStr = date.toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false
      });
      const standard = REFERENCE_STANDARDS[p.referenceStandard]?.name || p.referenceStandard;
      const isForCurrentDevice = p.deviceId === currentDeviceId;
      const sourceType = this._getSourceTypeLabel(p.deviceId, p.deviceLabel);
      const trimStr = p.trimOffset !== null && p.trimOffset !== undefined
        ? `${p.trimOffset > 0 ? '+' : ''}${p.trimOffset.toFixed(1)} dB`
        : '';

      // Is this profile active AND for the currently selected source?
      const isActiveAndCurrentSource = p.isActive && isForCurrentDevice;

      const activeClass = p.isActive ? 'cal-profile-active' : '';
      const currentClass = isForCurrentDevice ? 'cal-profile-current-device' : '';

      // Toggle button: ENABLE if inactive, DISABLE if active
      const toggleBtn = p.isActive
        ? `<button class="cal-row-btn cal-btn-toggle" data-profile-id="${this._escapeHtml(p.id)}" data-action="disable" title="Disable this profile">DISABLE</button>`
        : `<button class="cal-row-btn cal-btn-toggle" data-profile-id="${this._escapeHtml(p.id)}" data-action="enable" title="Enable this profile">ENABLE</button>`;

      return `
        <div class="cal-profile-row ${activeClass} ${currentClass}" data-profile-id="${this._escapeHtml(p.id)}">
          <div class="cal-profile-status">
            ${isActiveAndCurrentSource ? '<span class="cal-status-badge cal-active-source-badge">ACTIVE<br>SOURCE</span>' : ''}
            ${p.isActive ? '<span class="cal-status-badge cal-active-profile-badge">ACTIVE<br>PROFILE</span>' : ''}
          </div>
          <div class="cal-profile-main">
            <div class="cal-profile-row-top">
              <div class="cal-profile-name">${this._escapeHtml(p.profileName)}</div>
              ${trimStr ? `<div class="cal-profile-trim">${trimStr}</div>` : ''}
            </div>
            <div class="cal-profile-row-bottom">
              <div class="cal-profile-meta">
                <span class="cal-profile-source">${sourceType}</span>
                <span class="cal-profile-standard">${standard}</span>
                <span class="cal-profile-method">${p.method === 'auto' ? 'Auto' : 'Manual'}</span>
              </div>
              <div class="cal-profile-date">${dateStr} ${timeStr}</div>
            </div>
          </div>
          <div class="cal-profile-actions">
            ${toggleBtn}
            <button class="cal-row-btn cal-btn-delete-row" data-profile-id="${this._escapeHtml(p.id)}" title="Delete profile">DELETE</button>
          </div>
        </div>
      `;
    }).join('');

    // Check if any profile is active (for disable all button)
    const hasAnyActiveProfile = profiles.some(p => p.isActive);

    this._body.innerHTML = `
      <div class="cal-profile-list">
        <div class="cal-profile-list-header">
          <span>${profiles.length} profile${profiles.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="cal-profile-list-content">
          ${profileRows}
        </div>
        <div class="cal-actions cal-actions-split">
          <button class="btn-ghost" id="calBack">← Back</button>
          ${hasAnyActiveProfile ? `
            <button class="btn-ghost cal-btn-disable-all" id="calDisableAll">Disable All Input Profiles</button>
          ` : ''}
        </div>
      </div>
    `;

    this._body.querySelector('#calBack').onclick = () => this._showModeSelection();

    // Attach disable all profiles handler
    const disableAllBtn = this._body.querySelector('#calDisableAll');
    if (disableAllBtn) {
      disableAllBtn.onclick = () => {
        if (confirm('Disable all active calibration profiles?\nProfiles will not be deleted, just deactivated.')) {
          deactivateAllProfiles();
          this._showProfileList(); // Refresh
        }
      };
    }

    // Attach toggle (enable/disable) handlers
    this._body.querySelectorAll('.cal-btn-toggle').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const profileId = btn.dataset.profileId;
        const action = btn.dataset.action;
        if (action === 'enable') {
          setActiveProfile(profileId);
        } else {
          deactivateProfile(profileId);
        }
        this._showProfileList(); // Refresh list
      };
    });

    // Attach delete handlers
    this._body.querySelectorAll('.cal-btn-delete-row').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const profileId = btn.dataset.profileId;
        const profile = profiles.find(p => p.id === profileId);
        if (confirm(`Delete profile "${profile?.profileName}"?`)) {
          deleteCalibrationProfile(profileId);
          this._showProfileList(); // Refresh list
        }
      };
    });
  }

  /** @private */
  _getSourceTypeLabel(deviceId, deviceLabel) {
    if (deviceId === 'browser') return 'Browser';
    if (deviceId.startsWith('probe:')) return 'Remote';
    // For external devices, show shortened device label if available
    if (deviceLabel && deviceLabel !== 'External Device' && deviceLabel !== 'External Input') {
      // Truncate long device names
      const maxLen = 20;
      if (deviceLabel.length > maxLen) {
        return deviceLabel.slice(0, maxLen - 1) + '…';
      }
      return deviceLabel;
    }
    return 'External';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: AUTO-CALIBRATION
  // ═══════════════════════════════════════════════════════════════════════════

  /** @private */
  _showAutoSetup() {
    this._title.textContent = 'Auto-Calibration';
    this._currentMode = 'auto';

    const defaultName = generateProfileName(this._getCurrentDeviceLabel());

    this._body.innerHTML = `
      <div class="cal-setup">
        <div class="cal-step cal-step-active">
          <div class="cal-step-header">
            <span class="cal-step-num">1</span>
            <span class="cal-step-title">Configuration</span>
          </div>
          <div class="cal-step-body">
            <div class="cal-field">
              <label for="calRefStandard">Reference Standard</label>
              <select id="calRefStandard" class="cal-select">
                ${Object.entries(REFERENCE_STANDARDS).map(([key, std]) => `
                  <option value="${key}">${std.name} (${std.targetLufs} LUFS)</option>
                `).join('')}
              </select>
            </div>

            <div class="cal-field">
              <label for="calProfileName">Profile Name</label>
              <input type="text" id="calProfileName" class="cal-input"
                     value="${this._escapeHtml(defaultName)}" />
            </div>

            <div class="cal-info-box">
              <p><strong>Auto-calibration procedure:</strong></p>
              <ol>
                <li>Reference tone: ${CALIBRATION_TONE.frequency} Hz at ${CALIBRATION_TONE.level} dBFS</li>
                <li>Integration period: 30 seconds</li>
                <li>Trim offset calculated to achieve target loudness</li>
                <li>Profile saved for automatic application</li>
              </ol>
            </div>
          </div>
        </div>

        <div class="cal-step cal-step-pending">
          <div class="cal-step-header">
            <span class="cal-step-num">2</span>
            <span class="cal-step-title">Measurement</span>
          </div>
        </div>

        <div class="cal-step cal-step-pending">
          <div class="cal-step-header">
            <span class="cal-step-num">3</span>
            <span class="cal-step-title">Save Profile</span>
          </div>
        </div>

        <div class="cal-actions">
          <button class="btn-ghost" id="calBack">← Back</button>
          <button class="btn-active" id="calStart">Start Calibration</button>
        </div>
      </div>
    `;

    this._body.querySelector('#calBack').onclick = () => this._showModeSelection();
    this._body.querySelector('#calStart').onclick = () => this._startAutoCalibration();
  }

  /** @private */
  _startAutoCalibration() {
    const refStandard = this._body.querySelector('#calRefStandard').value;
    const rawName = this._body.querySelector('#calProfileName').value.trim() ||
      generateProfileName(this._getCurrentDeviceLabel());
    const profileName = getUniqueProfileName(rawName);

    // Change button to show calibrating state
    const startBtn = this._body.querySelector('#calStart');
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.innerHTML = '<span class="cal-dots">Calibrating</span>';
    }

    this.engine.startAutoCalibration(
      {
        deviceId: this._getCurrentDeviceId(),
        deviceLabel: this._getCurrentDeviceLabel(),
        referenceStandard: refStandard,
        profileName
      },
      (step, data) => this._handleAutoProgress(step, data),
      (profile) => this._handleComplete(profile),
      (error) => this._handleError(error)
    );
  }

  /** @private */
  _handleAutoProgress(step, data) {
    if (step === 'measure') {
      this._updateAutoMeasureUI(data);
    } else if (step === 'calculate') {
      this._showAutoResult(data);
    } else if (step === 'cancelled') {
      this._showModeSelection();
    }
  }

  /** @private */
  _updateAutoMeasureUI(data) {
    const steps = this._body.querySelectorAll('.cal-step');
    if (steps.length < 2) return;

    steps[0].className = 'cal-step cal-step-complete';
    steps[1].className = 'cal-step cal-step-active';

    const offsetStr = data.offset !== null
      ? `${data.offset > 0 ? '+' : ''}${data.offset.toFixed(1)} LU`
      : '--.-';

    const progressPct = (data.progress * 100).toFixed(0);
    const elapsedSec = (data.elapsed / 1000).toFixed(1);
    const durationSec = (data.duration / 1000).toFixed(0);

    steps[1].innerHTML = `
      <div class="cal-step-header">
        <span class="cal-step-num">2</span>
        <span class="cal-step-title">Measurement</span>
      </div>
      <div class="cal-step-body">
        <div class="cal-measure-display">
          <div class="cal-measure-primary">
            <div class="cal-measure-label">Integrated Loudness</div>
            <div class="cal-measure-value ${this._getLufsClass(data.offset)}">
              ${isFinite(data.integrated) ? data.integrated.toFixed(1) : '--.-'}
              <span class="cal-measure-unit">LUFS</span>
            </div>
          </div>

          <div class="cal-measure-secondary">
            <div class="cal-measure-item">
              <span class="cal-measure-label">Offset</span>
              <span class="cal-measure-value-sm ${data.offset > 0 ? 'cal-over' : 'cal-under'}">
                ${offsetStr}
              </span>
            </div>
            <div class="cal-measure-item">
              <span class="cal-measure-label">True Peak</span>
              <span class="cal-measure-value-sm">
                ${isFinite(data.truePeak) ? data.truePeak.toFixed(1) : '--.-'} dBTP
              </span>
            </div>
          </div>
        </div>

        <div class="cal-progress">
          <div class="cal-progress-bar">
            <div class="cal-progress-fill" style="width: ${progressPct}%"></div>
          </div>
          <div class="cal-progress-text">${elapsedSec}s / ${durationSec}s</div>
        </div>

        <div class="cal-confidence">
          <span class="cal-confidence-label">Stability:</span>
          <div class="cal-confidence-bar">
            <div class="cal-confidence-fill" style="width: ${data.confidence}%"></div>
          </div>
          <span class="cal-confidence-value">${data.confidence}%</span>
        </div>

        <div class="cal-measure-actions">
          <button class="btn-ghost" id="calCancel">Cancel</button>
          ${data.canFinishEarly ? `
            <button class="btn-ghost" id="calFinishEarly">Finish Early</button>
          ` : ''}
        </div>
      </div>
    `;

    this._body.querySelector('#calCancel').onclick = () => this.engine.cancel();

    const finishBtn = this._body.querySelector('#calFinishEarly');
    if (finishBtn) {
      finishBtn.onclick = () => this.engine.finishEarly();
    }
  }

  /** @private */
  _showAutoResult(data) {
    // Store pending profile for save
    this._pendingProfile = data.profile;

    const passedClass = data.passed ? 'cal-result-passed' : 'cal-result-warning';
    const passedIcon = data.passed ? '✓' : '⚠';
    const passedText = data.passed ? 'WITHIN TOLERANCE' : 'REVIEW RECOMMENDED';

    this._title.textContent = 'Review & Save';

    this._body.innerHTML = `
      <div class="cal-review">
        <div class="cal-result ${passedClass}">
          <div class="cal-result-status">
            <span class="cal-result-icon">${passedIcon}</span>
            <span class="cal-result-text">${passedText}</span>
          </div>
          <div class="cal-result-details">
            <div class="cal-result-row">
              <span>Target:</span>
              <span>${data.target} LUFS</span>
            </div>
            <div class="cal-result-row">
              <span>Measured:</span>
              <span>${data.measuredLufs.toFixed(1)} LUFS</span>
            </div>
            <div class="cal-result-row">
              <span>Deviation:</span>
              <span class="${Math.abs(data.deviation) < 0.5 ? 'cal-ok' : 'cal-warn'}">
                ${data.deviation > 0 ? '+' : ''}${data.deviation.toFixed(1)} LU
              </span>
            </div>
            <div class="cal-result-row cal-result-highlight">
              <span>Trim Offset:</span>
              <span>
                <strong>${data.trimOffset > 0 ? '+' : ''}${data.trimOffset.toFixed(1)} dB</strong>
              </span>
            </div>
            <div class="cal-result-row">
              <span>Confidence:</span>
              <span>${data.confidence}%</span>
            </div>
          </div>
        </div>

        <div class="cal-field">
          <label for="calFinalName">Profile Name</label>
          <input type="text" id="calFinalName" class="cal-input"
                 value="${this._escapeHtml(data.profile.profileName)}" />
        </div>

        <div class="cal-info-box cal-info-note">
          <p>This trim offset will be automatically applied when this input is selected.</p>
        </div>

        <div class="cal-actions">
          <button class="btn-ghost" id="calDiscard">Discard</button>
          <button class="btn-active" id="calSaveApply">Save & Apply</button>
        </div>
      </div>
    `;

    this._body.querySelector('#calDiscard').onclick = () => {
      this._pendingProfile = null;
      this._showModeSelection();
    };

    this._body.querySelector('#calSaveApply').onclick = () => {
      this._saveAndComplete();
    };
  }

  /** @private */
  _saveAndComplete() {
    if (!this._pendingProfile) return;

    // Update profile name from input
    const nameInput = this._body.querySelector('#calFinalName');
    if (nameInput) {
      const newName = nameInput.value.trim();
      if (newName) {
        this._pendingProfile.profileName = getUniqueProfileName(newName);
      }
    }

    // Save the profile
    saveCalibrationProfile(this._pendingProfile);

    // Show completion
    this._handleComplete(this._pendingProfile);
    this._pendingProfile = null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: MANUAL CALIBRATION
  // ═══════════════════════════════════════════════════════════════════════════

  /** @private */
  _showManualSetup() {
    this._title.textContent = 'Manual Calibration';
    this._currentMode = 'manual';

    const defaultName = generateProfileName(this._getCurrentDeviceLabel());

    this._body.innerHTML = `
      <div class="cal-setup">
        <div class="cal-step cal-step-active">
          <div class="cal-step-header">
            <span class="cal-step-num">1</span>
            <span class="cal-step-title">Setup</span>
          </div>
          <div class="cal-step-body">
            <div class="cal-field">
              <label for="calRefStandard">Reference Standard</label>
              <select id="calRefStandard" class="cal-select">
                ${Object.entries(REFERENCE_STANDARDS).map(([key, std]) => `
                  <option value="${key}">${std.name} (${std.targetLufs} LUFS)</option>
                `).join('')}
              </select>
            </div>

            <div class="cal-field">
              <label>Calibration Signal</label>
              <div class="cal-radio-group">
                <label class="cal-radio">
                  <input type="radio" name="calSignal" value="internal" checked />
                  <span>Internal generator (${CALIBRATION_TONE.frequency} Hz @ ${CALIBRATION_TONE.level} dBFS)</span>
                </label>
                <label class="cal-radio">
                  <input type="radio" name="calSignal" value="external" />
                  <span>External reference signal</span>
                </label>
              </div>
            </div>

            <div class="cal-field">
              <label for="calProfileName">Profile Name</label>
              <input type="text" id="calProfileName" class="cal-input"
                     value="${this._escapeHtml(defaultName)}" />
            </div>
          </div>
        </div>

        <div class="cal-step cal-step-pending">
          <div class="cal-step-header">
            <span class="cal-step-num">2</span>
            <span class="cal-step-title">Adjust Trim</span>
          </div>
        </div>

        <div class="cal-step cal-step-pending">
          <div class="cal-step-header">
            <span class="cal-step-num">3</span>
            <span class="cal-step-title">Verify & Save</span>
          </div>
        </div>

        <div class="cal-actions">
          <button class="btn-ghost" id="calBack">← Back</button>
          <button class="btn-active" id="calStart">Begin Adjustment</button>
        </div>
      </div>
    `;

    this._body.querySelector('#calBack').onclick = () => this._showModeSelection();
    this._body.querySelector('#calStart').onclick = () => this._startManualCalibration();
  }

  /** @private */
  _startManualCalibration() {
    const refStandard = this._body.querySelector('#calRefStandard').value;
    const rawName = this._body.querySelector('#calProfileName').value.trim() ||
      generateProfileName(this._getCurrentDeviceLabel());
    const profileName = getUniqueProfileName(rawName);
    const useExternal = this._body.querySelector('input[name="calSignal"]:checked').value === 'external';

    this.engine.startManualCalibration(
      {
        deviceId: this._getCurrentDeviceId(),
        deviceLabel: this._getCurrentDeviceLabel(),
        referenceStandard: refStandard,
        profileName,
        useExternalSignal: useExternal
      },
      (step, data) => this._handleManualProgress(step, data),
      (profile) => this._handleComplete(profile),
      (error) => this._handleError(error)
    );
  }

  /** @private */
  _handleManualProgress(step, data) {
    if (step === 'adjust') {
      this._updateManualAdjustUI(data);
    } else if (step === 'cancelled') {
      this._showModeSelection();
    }
  }

  /** @private */
  _updateManualAdjustUI(data) {
    const steps = this._body.querySelectorAll('.cal-step');
    if (steps.length < 2) return;

    steps[0].className = 'cal-step cal-step-complete';
    steps[1].className = 'cal-step cal-step-active';

    const offsetStr = data.offset !== null
      ? `${data.offset > 0 ? '+' : ''}${data.offset.toFixed(1)} LU`
      : '--.-';

    const onTarget = data.onTarget;
    const offsetPct = this._offsetToPercent(data.offset);

    // Get current trim from appState (simplified - would need proper getter)
    const currentTrim = 0; // Placeholder - engine should provide this

    steps[1].innerHTML = `
      <div class="cal-step-header">
        <span class="cal-step-num">2</span>
        <span class="cal-step-title">Adjust Trim</span>
      </div>
      <div class="cal-step-body">
        <div class="cal-manual-meters">
          <div class="cal-meter-row">
            <span class="cal-meter-label">M (Momentary)</span>
            <span class="cal-meter-value cal-meter-dim">
              ${isFinite(data.momentary) ? data.momentary.toFixed(1) : '--.-'} LUFS
            </span>
          </div>
          <div class="cal-meter-row">
            <span class="cal-meter-label">S (Short-term)</span>
            <span class="cal-meter-value">
              ${isFinite(data.shortTerm) ? data.shortTerm.toFixed(1) : '--.-'} LUFS
            </span>
          </div>
          <div class="cal-meter-row cal-meter-highlight">
            <span class="cal-meter-label">I (Integrated)</span>
            <span class="cal-meter-value cal-meter-large ${this._getLufsClass(data.offset)}">
              ${isFinite(data.integrated) ? data.integrated.toFixed(1) : '--.-'} LUFS
            </span>
          </div>
          <div class="cal-meter-row">
            <span class="cal-meter-label">True Peak</span>
            <span class="cal-meter-value cal-meter-dim">
              ${isFinite(data.truePeak) ? data.truePeak.toFixed(1) : '--.-'} dBTP
            </span>
          </div>
        </div>

        <div class="cal-offset-display ${onTarget ? 'cal-offset-on-target' : ''}">
          <div class="cal-offset-label">OFFSET FROM TARGET</div>
          <div class="cal-offset-value ${data.offset > 0 ? 'cal-over' : 'cal-under'}">
            ${offsetStr}
          </div>
          <div class="cal-offset-indicator">
            <div class="cal-offset-scale">
              <span>−6</span>
              <span>TARGET</span>
              <span>+6</span>
            </div>
            <div class="cal-offset-track">
              <div class="cal-offset-marker" style="left: ${offsetPct}%"></div>
              <div class="cal-offset-target"></div>
            </div>
          </div>
          ${onTarget ? `
            <div class="cal-offset-ok">✓ On target</div>
          ` : `
            <div class="cal-offset-hint">
              ${data.offset !== null && data.offset > 0 ? '↓ Decrease trim' : '↑ Increase trim'}
            </div>
          `}
        </div>

        <div class="cal-confidence cal-manual-confidence">
          <span class="cal-confidence-label">Stability:</span>
          <div class="cal-confidence-bar">
            <div class="cal-confidence-fill" style="width: ${data.confidence}%"></div>
          </div>
          <span class="cal-confidence-value">${data.confidence}%</span>
        </div>

        <div class="cal-manual-actions">
          <button class="btn-ghost" id="calCancel">Cancel</button>
          <button class="btn-ghost" id="calResetInt">Reset Integration</button>
          <button class="btn-active" id="calVerify" ${data.confidence < 50 ? 'disabled' : ''}>
            Verify & Save →
          </button>
        </div>

        ${data.confidence < 50 ? `
          <div class="cal-hint">Wait for stability to improve before saving.</div>
        ` : ''}
      </div>
    `;

    this._body.querySelector('#calCancel').onclick = () => this.engine.cancel();
    this._body.querySelector('#calResetInt').onclick = () => this.engine.resetIntegration();
    this._body.querySelector('#calVerify').onclick = () => {
      try {
        this.engine.finaliseManualCalibration();
      } catch (e) {
        this._handleError(e);
      }
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: COMPLETION
  // ═══════════════════════════════════════════════════════════════════════════

  /** @private */
  _handleComplete(profile) {
    const standard = REFERENCE_STANDARDS[profile.referenceStandard];

    this._body.innerHTML = `
      <div class="cal-complete">
        <div class="cal-complete-icon">✓</div>
        <div class="cal-complete-title">Calibration Saved</div>
        <div class="cal-complete-profile">${this._escapeHtml(profile.profileName)}</div>

        <div class="cal-complete-saved">
          Profile saved and will be automatically applied when this input is selected.
        </div>

        <div class="cal-complete-details">
          <div class="cal-complete-row">
            <span>Standard:</span>
            <span>${standard?.name || profile.referenceStandard}</span>
          </div>
          <div class="cal-complete-row">
            <span>Target:</span>
            <span>${profile.targetLufs} LUFS</span>
          </div>
          <div class="cal-complete-row">
            <span>Trim Offset:</span>
            <span><strong>${profile.trimOffset > 0 ? '+' : ''}${profile.trimOffset.toFixed(1)} dB</strong></span>
          </div>
          <div class="cal-complete-row">
            <span>Confidence:</span>
            <span>${profile.confidence}%</span>
          </div>
        </div>

        <div class="cal-actions">
          <button class="btn-ghost" id="calRecalibrate">Recalibrate</button>
          <button class="btn-active" id="calClose">Close</button>
        </div>
      </div>
    `;

    this._body.querySelector('#calClose').onclick = () => {
      this.hide(false); // Don't trigger onCancel for successful completion
      this.onComplete?.(profile);
    };

    this._body.querySelector('#calRecalibrate').onclick = () => {
      this._showModeSelection();
    };
  }

  /** @private */
  _handleError(error) {
    console.error('[CalibrationWizard] Error:', error);

    this._body.innerHTML = `
      <div class="cal-error">
        <div class="cal-error-icon">⚠</div>
        <div class="cal-error-title">Calibration Error</div>
        <div class="cal-error-message">${this._escapeHtml(error.message)}</div>
        <div class="cal-actions">
          <button class="btn-ghost" id="calBack">← Back</button>
        </div>
      </div>
    `;

    this._body.querySelector('#calBack').onclick = () => this._showModeSelection();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /** @private */
  _getCurrentDeviceId() {
    const mode = appState.get('inputMode');
    if (mode === InputMode.BROWSER) return 'browser';
    if (mode === InputMode.EXTERNAL) {
      // Check if this is actually a remote probe (inputMode set to EXTERNAL for remote)
      const remoteProbeId = appState.get('remoteProbeId');
      if (remoteProbeId) {
        return `probe:${remoteProbeId}`;
      }
      return appState.get('deviceId') || 'external-unknown';
    }
    if (mode === InputMode.GENERATOR) return 'generator';
    return 'unknown';
  }

  /** @private */
  _getCurrentDeviceLabel() {
    const mode = appState.get('inputMode');
    if (mode === InputMode.BROWSER) return 'Browser Tab Capture';
    if (mode === InputMode.EXTERNAL) {
      // Check if this is actually a remote probe
      const remoteProbeId = appState.get('remoteProbeId');
      if (remoteProbeId) {
        return appState.get('remoteProbeName') || 'Remote Probe';
      }
      return appState.get('deviceLabel') || 'External Device';
    }
    if (mode === InputMode.GENERATOR) return 'Internal Generator';
    return 'Unknown Input';
  }

  /** @private */
  _getLufsClass(offset) {
    if (offset === null || !isFinite(offset)) return '';
    if (Math.abs(offset) < 0.5) return 'cal-on-target';
    if (Math.abs(offset) < 2) return 'cal-close';
    return offset > 0 ? 'cal-over' : 'cal-under';
  }

  /** @private */
  _offsetToPercent(offset) {
    if (offset === null || !isFinite(offset)) return 50;
    // Map −6 to +6 LU range to 0-100%
    return Math.max(0, Math.min(100, ((offset + 6) / 12) * 100));
  }

  /** @private */
  _getProfileCount() {
    const data = getCalibrationProfiles();
    return Object.keys(data.profiles).length;
  }

  /** @private */
  _handleExport() {
    const count = this._getProfileCount();
    if (count === 0) {
      alert('No calibration profiles to export.');
      return;
    }
    downloadProfiles();
  }

  /** @private */
  async _handleImport() {
    const result = await importProfilesFromFile();

    if (result.errors.length > 0) {
      alert(`Import completed with warnings:\n${result.errors.join('\n')}`);
    }

    if (result.imported > 0) {
      alert(`Imported ${result.imported} profile(s).${result.skipped > 0 ? `\nSkipped ${result.skipped} (already up-to-date).` : ''}`);
      // Refresh the view to show updated profile info
      this._showModeSelection();
    } else if (result.skipped > 0) {
      alert(`No new profiles imported.\n${result.skipped} profile(s) already up-to-date.`);
    } else if (result.errors.length === 0) {
      // User cancelled file picker
    }
  }

  /** @private */
  _escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
