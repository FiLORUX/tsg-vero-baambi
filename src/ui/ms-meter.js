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
 * M/S METER
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * DOM-based Mid/Side meter. Updates width percentage on fill elements.
 *
 * @module ui/ms-meter
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export class MSMeter {
  constructor(msFillM, msFillS, msValueM, msValueS) {
    this.msFillM = msFillM;
    this.msFillS = msFillS;
    this.msValueM = msValueM;
    this.msValueS = msValueS;
  }

  formatDb(value) {
    if (!isFinite(value) || value <= -59) return '  −∞';
    return value.toFixed(1).padStart(6);
  }

  update(midDb, sideDb) {
    if (!this.msFillM || !this.msFillS) return;

    // Map dB to percentage (0 = -60dB, 100% = 0dB)
    const midPct = Math.max(0, Math.min(100, (midDb + 60) / 60 * 100));
    const sidePct = Math.max(0, Math.min(100, (sideDb + 60) / 60 * 100));

    this.msFillM.style.width = midPct + '%';
    this.msFillS.style.width = sidePct + '%';

    if (this.msValueM) this.msValueM.textContent = this.formatDb(midDb) + ' dB';
    if (this.msValueS) this.msValueS.textContent = this.formatDb(sideDb) + ' dB';
  }
}
