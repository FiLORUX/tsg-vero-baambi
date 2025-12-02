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
 * STEREO ANALYSIS ENGINE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Computes stereo analysis metrics from L/R sample buffers:
 * - Width (Side energy relative to total)
 * - Mid/Side levels in dB
 * - Rotation from covariance matrix principal axis
 *
 * @module ui/stereo-analysis
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// Smoothing and timing parameters
const SMOOTH_ALPHA = 0.15;
const PEAK_HOLD_SEC = 3;
const ROTATION_HISTORY_LEN = 25;
const ROTATION_SMOOTH_ALPHA = 0.04;
const ROTATION_DEADZONE = 0.05;

export class StereoAnalysisEngine {
  constructor() {
    // State variables
    this.midLevel = -60;
    this.sideLevel = -60;
    this.width = 0;
    this.widthPeak = 0;
    this.widthPeakTime = 0;
    this.rotation = 0;
    this.rotationHistory = [];
  }

  // Process a block of L/R samples and update all metrics
  analyze(bufL, bufR) {
    const n = Math.min(bufL.length, bufR.length);
    if (n === 0) return;

    let sumM2 = 0, sumS2 = 0;
    let sumLL = 0, sumRR = 0, sumLR = 0;

    for (let i = 0; i < n; i++) {
      const L = bufL[i], R = bufR[i];
      const M = (L + R) * 0.5;
      const S = (R - L) * 0.5;
      sumM2 += M * M;
      sumS2 += S * S;
      sumLL += L * L;
      sumRR += R * R;
      sumLR += L * R;
    }

    const rmsM = Math.sqrt(sumM2 / n);
    const rmsS = Math.sqrt(sumS2 / n);
    const eps = 1e-10;

    // Width: Side energy relative to total
    const newWidth = rmsS / (rmsM + rmsS + eps);
    this.width += SMOOTH_ALPHA * (newWidth - this.width);

    // Peak-hold for width display
    const now = performance.now() / 1000;
    if (this.width > this.widthPeak) {
      this.widthPeak = this.width;
      this.widthPeakTime = now;
    } else if (now - this.widthPeakTime > PEAK_HOLD_SEC) {
      this.widthPeak = this.width;
      this.widthPeakTime = now;
    }

    // M/S levels in dB
    const newMidDb = rmsM > eps ? 20 * Math.log10(rmsM) : -60;
    const newSideDb = rmsS > eps ? 20 * Math.log10(rmsS) : -60;
    this.midLevel += SMOOTH_ALPHA * (newMidDb - this.midLevel);
    this.sideLevel += SMOOTH_ALPHA * (newSideDb - this.sideLevel);

    // Rotation from covariance matrix principal axis
    const angle = 0.5 * Math.atan2(2 * sumLR, sumLL - sumRR);
    let rawRotation = angle / (Math.PI / 4);
    rawRotation = Math.max(-1, Math.min(1, rawRotation));

    // Dead-zone to suppress noise near centre
    if (Math.abs(rawRotation) < ROTATION_DEADZONE) {
      rawRotation = 0;
    }

    // Slow smoothing for trend visualisation
    this.rotation += ROTATION_SMOOTH_ALPHA * (rawRotation - this.rotation);

    // Trail history
    this.rotationHistory.push(this.rotation);
    if (this.rotationHistory.length > ROTATION_HISTORY_LEN) {
      this.rotationHistory.shift();
    }
  }

  getWidth() { return this.width; }
  getWidthPeak() { return this.widthPeak; }
  getMidLevel() { return this.midLevel; }
  getSideLevel() { return this.sideLevel; }
  getRotation() { return this.rotation; }
  getRotationHistory() { return this.rotationHistory; }
}
