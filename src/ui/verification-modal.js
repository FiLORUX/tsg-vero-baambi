/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * TSG Suite – broadcast tools for alignment, metering, and signal verification
 * Maintained by David Thåst  ·  https://github.com/FiLORUX
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * VERIFICATION MODAL UI
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Modal dialog for meter verification test progress and results.
 *
 * @module ui/verification-modal
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { MeterVerification, VERIFICATION_TESTS } from '../verification/index.js';

/**
 * VerificationModal - UI for running and displaying meter verification tests.
 */
export class VerificationModal {
  constructor(options = {}) {
    this.container = options.container || document.body;
    this.audioContext = options.audioContext;
    this.masterGain = options.masterGain;
    this.getMeterReadings = options.getMeterReadings;
    this.resetMeters = options.resetMeters || null;
    this.onStart = options.onStart || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onAbort = options.onAbort || (() => {});

    this.modal = null;
    this.verification = null;
    this.isOpen = false;
    this._verificationStarted = false;

    this.createModal();
  }

  /**
   * Create the modal DOM structure.
   */
  createModal() {
    this.modal = document.createElement('div');
    this.modal.className = 'verify-modal';
    this.modal.innerHTML = `
      <div class="verify-modal-backdrop"></div>
      <div class="verify-modal-content">
        <div class="verify-modal-header">
          <h2>Meter Verification</h2>
          <button class="verify-modal-close" title="Close">×</button>
        </div>
        <div class="verify-modal-body">
          <div class="verify-intro">
            <p>Automated self-test verifies meter accuracy using internal reference signals.</p>
          </div>
          <div class="verify-progress" style="display:none">
            <div class="verify-progress-bar">
              <div class="verify-progress-fill"></div>
            </div>
            <div class="verify-progress-text">Initializing...</div>
          </div>
          <div class="verify-tests">
            ${VERIFICATION_TESTS.map(test => `
              <div class="verify-test" data-test-id="${test.id}">
                <div class="verify-test-status">○</div>
                <div class="verify-test-info">
                  <div class="verify-test-name">${test.name}</div>
                  <div class="verify-test-desc">${test.description}</div>
                </div>
                <div class="verify-test-result"></div>
              </div>
            `).join('')}
          </div>
          <div class="verify-summary" style="display:none">
            <div class="verify-summary-icon"></div>
            <div class="verify-summary-text"></div>
          </div>
        </div>
        <div class="verify-modal-footer">
          <button class="verify-btn verify-btn-start">Start Verification</button>
          <button class="verify-btn verify-btn-abort" style="display:none">Abort</button>
          <button class="verify-btn verify-btn-close" style="display:none">Close</button>
        </div>
      </div>
    `;

    this.container.appendChild(this.modal);

    // Event listeners
    this.modal.querySelector('.verify-modal-backdrop').onclick = () => this.close();
    this.modal.querySelector('.verify-modal-close').onclick = () => this.close();
    this.modal.querySelector('.verify-btn-start').onclick = () => this.startVerification();
    this.modal.querySelector('.verify-btn-abort').onclick = () => this.abort();
    this.modal.querySelector('.verify-btn-close').onclick = () => this.close();
  }

  /**
   * Open the modal.
   */
  open() {
    this.resetUI();
    this.modal.classList.add('open');
    this.isOpen = true;
  }

  /**
   * Close the modal.
   */
  close() {
    if (this.verification && this.verification.isRunning) {
      this.verification.abort();
    }
    // Ensure sources are restored if verification was started
    if (this._verificationStarted) {
      this.onAbort();
      this._verificationStarted = false;
    }
    this.modal.classList.remove('open');
    this.isOpen = false;
  }

  /**
   * Reset UI to initial state.
   */
  resetUI() {
    this.modal.querySelector('.verify-intro').style.display = '';
    this.modal.querySelector('.verify-progress').style.display = 'none';
    this.modal.querySelector('.verify-summary').style.display = 'none';
    this.modal.querySelector('.verify-btn-start').style.display = '';
    this.modal.querySelector('.verify-btn-abort').style.display = 'none';
    this.modal.querySelector('.verify-btn-close').style.display = 'none';

    // Reset test items
    this.modal.querySelectorAll('.verify-test').forEach(el => {
      el.classList.remove('running', 'passed', 'failed');
      el.querySelector('.verify-test-status').textContent = '○';
      el.querySelector('.verify-test-result').textContent = '';
    });
  }

  /**
   * Start the verification process.
   */
  async startVerification() {
    this._verificationStarted = true;
    this.onStart();

    this.modal.querySelector('.verify-intro').style.display = 'none';
    this.modal.querySelector('.verify-progress').style.display = '';
    this.modal.querySelector('.verify-btn-start').style.display = 'none';
    this.modal.querySelector('.verify-btn-abort').style.display = '';

    this.verification = new MeterVerification({
      audioContext: this.audioContext,
      masterGain: this.masterGain,
      getMeterReadings: this.getMeterReadings,
      resetMeters: this.resetMeters,
      onTestStart: (test) => this.onTestStart(test),
      onTestComplete: (result) => this.onTestComplete(result),
      onAllComplete: (results) => this.onAllTestsComplete(results),
      onProgress: (pct, text) => this.updateProgress(pct, text)
    });

    await this.verification.runAll();
  }

  /**
   * Abort verification.
   */
  abort() {
    if (this.verification) {
      this.verification.abort();
    }
    // Restore sources when aborted
    if (this._verificationStarted) {
      this.onAbort();
      this._verificationStarted = false;
    }
    this.showSummary(false, 'Verification aborted');
  }

  /**
   * Update progress bar.
   */
  updateProgress(pct, text) {
    this.modal.querySelector('.verify-progress-fill').style.width = `${pct}%`;
    this.modal.querySelector('.verify-progress-text').textContent = text;
  }

  /**
   * Handle test start.
   */
  onTestStart(test) {
    const el = this.modal.querySelector(`[data-test-id="${test.id}"]`);
    if (el) {
      el.classList.add('running');
      el.querySelector('.verify-test-status').textContent = '◉';
    }
  }

  /**
   * Handle test completion.
   */
  onTestComplete(result) {
    const el = this.modal.querySelector(`[data-test-id="${result.testId}"]`);
    if (el) {
      el.classList.remove('running');
      el.classList.add(result.passed ? 'passed' : 'failed');
      el.querySelector('.verify-test-status').textContent = result.passed ? '✓' : '✗';

      // Show measurement if available
      let resultText = result.passed ? 'PASS' : 'FAIL';
      if (result.measurements) {
        const m = result.measurements;
        if (m.integrated) resultText = `${m.integrated.measured.toFixed(1)} LUFS`;
        else if (m.ppm) resultText = `${m.ppm.measured.toFixed(1)} PPM`;
        else if (m.correlation) resultText = `ρ = ${m.correlation.measured.toFixed(2)}`;
        else if (m.truePeak) resultText = `${m.truePeak.measured.toFixed(1)} dBTP`;
      }
      el.querySelector('.verify-test-result').textContent = resultText;
    }
  }

  /**
   * Handle all tests complete.
   */
  onAllTestsComplete(results) {
    // Clear the flag so close() doesn't call onAbort again
    this._verificationStarted = false;

    const passedCount = results.filter(r => r.passed).length;
    const allPassed = passedCount === results.length;

    this.showSummary(allPassed,
      allPassed
        ? `All ${results.length} tests passed. Meters are verified.`
        : `${passedCount}/${results.length} tests passed. See details above.`
    );

    this.onComplete(results);
  }

  /**
   * Show summary.
   */
  showSummary(success, text) {
    const summary = this.modal.querySelector('.verify-summary');
    summary.style.display = '';
    summary.querySelector('.verify-summary-icon').textContent = success ? '✓' : '⚠';
    summary.querySelector('.verify-summary-icon').className = 'verify-summary-icon ' + (success ? 'success' : 'warning');
    summary.querySelector('.verify-summary-text').textContent = text;

    this.modal.querySelector('.verify-progress').style.display = 'none';
    this.modal.querySelector('.verify-btn-abort').style.display = 'none';
    this.modal.querySelector('.verify-btn-close').style.display = '';
  }

  /**
   * Dispose of the modal.
   */
  dispose() {
    if (this.verification) {
      this.verification.abort();
    }
    if (this.modal && this.modal.parentNode) {
      this.modal.parentNode.removeChild(this.modal);
    }
  }
}
