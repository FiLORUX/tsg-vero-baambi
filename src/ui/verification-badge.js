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
 * VERIFICATION STATUS BADGE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Visual indicator showing meter verification status.
 * Persists verification results to localStorage.
 *
 * STATES
 * ──────
 *   Verified:    Green badge, shows date and pass count
 *   Not Verified: Amber badge, prompts user to verify
 *   Partial:     Amber badge, some tests failed
 *
 * @module ui/verification-badge
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'tsg_meterVerification';

/** Age threshold for stale verification (days) */
const STALE_THRESHOLD_DAYS = 30;

// ─────────────────────────────────────────────────────────────────────────────
// VERIFICATION STATUS BADGE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verification status badge component.
 *
 * @example
 * const badge = new VerificationStatusBadge(document.getElementById('verifyBadge'));
 * badge.onVerifyClick = () => openVerificationModal();
 */
export class VerificationStatusBadge {
  /**
   * @param {HTMLElement} container - Container element for badge
   */
  constructor(container) {
    /** @type {HTMLElement} */
    this.container = container;

    /** @type {Function|null} */
    this.onVerifyClick = null;

    this._render();
    this.update();
  }

  /**
   * Clean up (no subscriptions to clean).
   */
  dispose() {
    // No subscriptions to clean up
  }

  /**
   * Force update of badge state from localStorage.
   */
  update() {
    const stored = this._getStoredVerification();

    if (!stored) {
      this._setNotVerified();
      return;
    }

    // Calculate age
    const age = Date.now() - stored.verifiedAt;
    const daysOld = age / (1000 * 60 * 60 * 24);

    if (daysOld > STALE_THRESHOLD_DAYS) {
      this._setStale(stored, daysOld);
    } else if (stored.allPassed) {
      this._setVerified(stored, daysOld);
    } else {
      this._setPartial(stored, daysOld);
    }
  }

  /**
   * Save verification results.
   * @param {Array} results - Array of test results
   */
  saveResults(results) {
    const passed = results.filter(r => r.passed).length;
    const total = results.length;
    const allPassed = passed === total;

    const data = {
      verifiedAt: Date.now(),
      passed,
      total,
      allPassed,
      results
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('[VerificationBadge] Could not save verification results');
    }

    this.update();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE
  // ═══════════════════════════════════════════════════════════════════════════

  /** @private */
  _render() {
    this.container.innerHTML = `
      <div class="verify-badge-wrap">
        <button class="verify-badge" id="verifyBadgeBtn" title="Click to verify meters">
          <span class="verify-badge-title">Meter Verification Tool</span>
          <span class="verify-badge-status">
            <span class="verify-badge-icon"></span>
            <span class="verify-badge-text"></span>
          </span>
        </button>
      </div>
    `;

    this._badge = this.container.querySelector('#verifyBadgeBtn');
    this._icon = this.container.querySelector('.verify-badge-icon');
    this._text = this.container.querySelector('.verify-badge-text');

    this._badge.addEventListener('click', () => {
      this.onVerifyClick?.();
    });
  }

  /** @private */
  _getStoredVerification() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.warn('[VerificationBadge] Could not read stored verification');
    }
    return null;
  }

  /** @private */
  _formatAge(daysOld) {
    if (daysOld < 1) {
      return 'today';
    } else if (daysOld < 2) {
      return 'yesterday';
    } else {
      return `${Math.floor(daysOld)}d ago`;
    }
  }

  /** @private */
  _setVerified(data, daysOld) {
    this._badge.className = 'verify-badge verify-verified';
    this._icon.textContent = '✓';
    this._text.innerHTML = `<span class="verify-badge-detail">${data.passed}/${data.total} passed · ${this._formatAge(daysOld)}</span>`;
    this._badge.title = `All ${data.total} meter tests passed.\n` +
      `Verified: ${new Date(data.verifiedAt).toLocaleDateString()}`;
  }

  /** @private */
  _setStale(data, daysOld) {
    const passText = data.allPassed ? 'All passed' : `${data.passed}/${data.total}`;
    this._badge.className = 'verify-badge verify-stale';
    this._icon.textContent = '⚠';
    this._text.innerHTML = `<span class="verify-badge-detail">${passText} · ${Math.floor(daysOld)}d old</span>`;
    this._badge.title = `Verification is ${Math.floor(daysOld)} days old.\n` +
      `Recommend re-verification for accuracy.`;
  }

  /** @private */
  _setPartial(data, daysOld) {
    const failed = data.total - data.passed;
    this._badge.className = 'verify-badge verify-partial';
    this._icon.textContent = '⚠';
    this._text.innerHTML = `<span class="verify-badge-detail">${data.passed}/${data.total} passed · ${failed} failed</span>`;
    this._badge.title = `${failed} of ${data.total} tests failed.\n` +
      `Click to re-verify meters.`;
  }

  /** @private */
  _setNotVerified() {
    this._badge.className = 'verify-badge verify-not-verified';
    this._icon.textContent = '⚠';
    this._text.textContent = 'Not Verified';
    this._badge.title = 'Meters have not been verified.\n' +
      'Click to run verification tests.';
  }
}
