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
 * SPECTRUM ANALYZER
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * 1/3-octave spectrum analyzer with RTW/TC-grade visual rendering.
 * 31 bands from 20 Hz to 20 kHz.
 *
 * @module ui/spectrum
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// 1/3-octave center frequencies (ISO 266)
const SPECTRUM_CENTER_FREQS = [
  20, 25, 31.5, 40, 50, 63, 80, 100,
  125, 160, 200, 250, 315, 400, 500, 630,
  800, 1000, 1250, 1600, 2000, 2500,
  3150, 4000, 5000, 6300, 8000, 10000,
  12500, 16000, 20000
];
const SPECTRUM_NUM_BANDS = SPECTRUM_CENTER_FREQS.length; // 31

// 1/3-octave factor: 2^(1/6) ≈ 1.1225
const THIRD_OCT_FACTOR = Math.pow(2, 1/6);

// RTW/TC Visual Constants (UI only)
const RTW_VISIBLE_TOP_DB = 9;       // Top of visual range
const RTW_VISIBLE_BOTTOM_DB = -48;  // Bottom of visual range
const RTW_RANGE_DB = RTW_VISIBLE_TOP_DB - RTW_VISIBLE_BOTTOM_DB; // 57 dB
const RTW_VISUAL_BOOST = 18;        // Boost to shift FFT values into visible range
const RTW_FALL_RATE = 12;           // Bar fall: 12 dB/s
const RTW_PEAK_HOLD_MS = 750;       // Peak hold: 600-900ms
const RTW_PEAK_FALL_RATE = 18;      // Peak marker fall: 18 dB/s
const RTW_DISPLAY_SMOOTH = 0.15;    // Visual smoothing factor (0.85/0.15 blend)

export class SpectrumAnalyzer {
  constructor(canvas, analyserL, analyserR, wrapperSelector) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.analyserL = analyserL;
    this.analyserR = analyserR;
    this.wrapperSelector = wrapperSelector;

    // FFT data buffers
    this.spectrumFreqBufL = new Float32Array(2048);
    this.spectrumFreqBufR = new Float32Array(2048);

    // Band values
    this.spectrumSmooth = new Float32Array(SPECTRUM_NUM_BANDS);
    this.spectrumPeakHold = new Float32Array(SPECTRUM_NUM_BANDS);

    // RTW/TC Visual Display State (UI only - does not affect DSP)
    this.spectrumDisplayVal = new Float32Array(SPECTRUM_NUM_BANDS);  // Smoothed display values
    this.spectrumPeakMarker = new Float32Array(SPECTRUM_NUM_BANDS);  // Peak marker positions
    this.spectrumPeakTimer = new Float32Array(SPECTRUM_NUM_BANDS);   // Peak hold timers

    // Initialize to floor
    for (let i = 0; i < SPECTRUM_NUM_BANDS; i++) {
      this.spectrumDisplayVal[i] = -100;
      this.spectrumPeakMarker[i] = -100;
      this.spectrumPeakTimer[i] = 0;
    }

    this.lastTime = 0;

    // Pre-computed bin-to-band mapping (computed once when sample rate changes)
    this._bandBinMapping = null;
    this._lastSampleRate = 0;
    this._lastFftSize = 0;
  }

  /**
   * Pre-compute bin ranges for each 1/3-octave band.
   * Called once when sample rate or FFT size changes.
   * @param {number} sampleRate - Audio sample rate
   * @param {number} fftSize - FFT size
   * @param {number} numBins - Number of FFT bins
   */
  _computeBinMapping(sampleRate, fftSize, numBins) {
    const binHz = sampleRate / fftSize;
    this._bandBinMapping = new Array(SPECTRUM_NUM_BANDS);

    for (let b = 0; b < SPECTRUM_NUM_BANDS; b++) {
      const centerFreq = SPECTRUM_CENTER_FREQS[b];
      const lowFreq = centerFreq / THIRD_OCT_FACTOR;
      const highFreq = centerFreq * THIRD_OCT_FACTOR;

      this._bandBinMapping[b] = {
        lowBin: Math.max(1, Math.floor(lowFreq / binHz)),
        highBin: Math.min(numBins - 1, Math.ceil(highFreq / binHz))
      };
    }

    this._lastSampleRate = sampleRate;
    this._lastFftSize = fftSize;
  }

  draw(containerEl, sampleRate) {
    if (!this.ctx || !this.analyserL || !this.analyserR) return;
    const canvas = this.canvas;
    if (!canvas) return;

    // Use wrapper for dimensions (canvas itself may report 0 in flex)
    const spectrumWrap = containerEl?.querySelector('.spectrumWrap');
    if (!spectrumWrap) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = spectrumWrap.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = rect.height;

    if (cssW < 1 || cssH < 1) return;

    const w = Math.floor(cssW * dpr);
    const h = Math.floor(cssH * dpr);

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    // Timing for peak falloff
    const now = performance.now();
    const deltaTime = this.lastTime > 0 ? (now - this.lastTime) / 1000 : 0.016;
    this.lastTime = now;

    // Get FFT data
    this.analyserL.getFloatFrequencyData(this.spectrumFreqBufL);
    this.analyserR.getFloatFrequencyData(this.spectrumFreqBufR);

    const sr = sampleRate || 48000;
    const fftSize = this.analyserL.fftSize;
    const numBins = this.spectrumFreqBufL.length;

    // Re-compute bin mapping only when sample rate or FFT size changes
    if (sr !== this._lastSampleRate || fftSize !== this._lastFftSize || !this._bandBinMapping) {
      this._computeBinMapping(sr, fftSize, numBins);
    }

    // Calculate band values using pre-computed 1/3-octave bin ranges
    for (let b = 0; b < SPECTRUM_NUM_BANDS; b++) {
      const { lowBin, highBin } = this._bandBinMapping[b];

      // Sum linear power (not dB - logarithmic values cannot be averaged)
      let powerSum = 0, count = 0;
      for (let i = lowBin; i <= highBin; i++) {
        const powerL = Math.pow(10, this.spectrumFreqBufL[i] / 10);
        const powerR = Math.pow(10, this.spectrumFreqBufR[i] / 10);
        powerSum += 0.5 * (powerL + powerR);
        count++;
      }

      const avgPower = count > 0 ? powerSum / count : 0;
      const bandDb = avgPower > 0 ? 10 * Math.log10(avgPower) : -100;

      // Store raw band value (DSP untouched)
      this.spectrumSmooth[b] = bandDb;
    }

    // =========================================================
    // RTW/TC-GRADE VISUAL RENDERING (UI ONLY - NO DSP CHANGES)
    // =========================================================

    // Layout calculations
    const paddingL = Math.round(28 * dpr);  // Left padding for dB labels
    const paddingR = Math.round(6 * dpr);
    const paddingT = Math.round(6 * dpr);
    const paddingB = Math.round(18 * dpr);  // Bottom padding for freq labels
    const barAreaW = w - paddingL - paddingR;
    const barAreaH = h - paddingT - paddingB;
    const gap = Math.round(1 * dpr);
    const barWidth = Math.max(2 * dpr, (barAreaW - gap * (SPECTRUM_NUM_BANDS - 1)) / SPECTRUM_NUM_BANDS);

    // Y-position helper: maps dB to pixel (top = +9dB, bottom = -36dB)
    function dbToY(db) {
      const clamped = Math.max(RTW_VISIBLE_BOTTOM_DB, Math.min(RTW_VISIBLE_TOP_DB, db));
      return paddingT + ((RTW_VISIBLE_TOP_DB - clamped) / RTW_RANGE_DB) * barAreaH;
    }
    const zeroLineY = dbToY(0);
    const bottomY = paddingT + barAreaH;

    // Draw gridlines first (behind bars)
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    const majorMarks = [6, 0, -6, -12, -18, -24, -30, -36, -42, -48];
    for (const mark of majorMarks) {
      const y = dbToY(mark);
      ctx.beginPath();
      ctx.moveTo(paddingL, y);
      ctx.lineTo(w - paddingR, y);
      ctx.stroke();
    }

    // Draw 0 dB reference line (red, thicker)
    ctx.strokeStyle = '#c5312f';
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    ctx.moveTo(paddingL, zeroLineY);
    ctx.lineTo(w - paddingR, zeroLineY);
    ctx.stroke();

    // Process and draw each band
    for (let b = 0; b < SPECTRUM_NUM_BANDS; b++) {
      const actualValue = this.spectrumSmooth[b];

      // RTW Ballistics: instant rise, 12 dB/s fall
      if (actualValue > this.spectrumDisplayVal[b]) {
        this.spectrumDisplayVal[b] = actualValue;  // Instant rise
      } else {
        this.spectrumDisplayVal[b] = Math.max(this.spectrumDisplayVal[b] - RTW_FALL_RATE * deltaTime, actualValue);
      }

      // Visual micro-jitter smoothing (0.85/0.15 blend)
      this.spectrumDisplayVal[b] = this.spectrumDisplayVal[b] * (1 - RTW_DISPLAY_SMOOTH) + actualValue * RTW_DISPLAY_SMOOTH;

      // Peak marker: hold then fall
      if (actualValue > this.spectrumPeakMarker[b]) {
        this.spectrumPeakMarker[b] = actualValue;
        this.spectrumPeakTimer[b] = RTW_PEAK_HOLD_MS;
      } else if (this.spectrumPeakTimer[b] > 0) {
        this.spectrumPeakTimer[b] -= deltaTime * 1000;
      } else {
        this.spectrumPeakMarker[b] -= RTW_PEAK_FALL_RATE * deltaTime;
      }

      // Calculate bar geometry (apply visual boost for display)
      const displayDb = this.spectrumDisplayVal[b] + RTW_VISUAL_BOOST;
      const barX = paddingL + b * (barWidth + gap);

      // LED-style rendering: 57 cells (1 dB each, from -48 to +9)
      const LED_CELLS = 57;
      const LED_GAP = Math.max(1, Math.round(1 * dpr));  // Gap between cells
      const cellH = (barAreaH - LED_GAP * (LED_CELLS - 1)) / LED_CELLS;

      // Draw LED cells from bottom to top
      for (let cell = 0; cell < LED_CELLS; cell++) {
        const cellDb = RTW_VISIBLE_BOTTOM_DB + cell;  // -36 + cell = dB value for this cell
        const cellY = bottomY - (cell + 1) * (cellH + LED_GAP) + LED_GAP;

        // Only draw lit cells (up to displayDb)
        if (cellDb < displayDb) {
          // Colour based on dB level
          if (cellDb >= 0) {
            ctx.fillStyle = '#ff3b2f';  // Red: above 0 dB
          } else if (cellDb >= -6) {
            ctx.fillStyle = '#ff9500';  // Orange: -6 to 0 dB
          } else {
            ctx.fillStyle = '#f2c74e';  // Yellow: below -6 dB
          }
          ctx.fillRect(barX, cellY, barWidth, cellH);
        }
      }

      // Peak-hold marker (white LED cell at peak position)
      const peakDb = this.spectrumPeakMarker[b] + RTW_VISUAL_BOOST;
      if (peakDb > RTW_VISIBLE_BOTTOM_DB) {
        const peakCell = Math.floor(peakDb - RTW_VISIBLE_BOTTOM_DB);
        if (peakCell >= 0 && peakCell < LED_CELLS) {
          const peakCellY = bottomY - (peakCell + 1) * (cellH + LED_GAP) + LED_GAP;
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.fillRect(barX, peakCellY, barWidth, cellH);
        }
      }
    }

    // Draw dB scale labels on left side
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `${Math.round(8 * dpr)}px ui-monospace, monospace`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const dbLabels = [6, 0, -12, -24, -36, -48];
    for (const mark of dbLabels) {
      const y = dbToY(mark);
      const label = mark > 0 ? `+${mark}` : `${mark}`;
      ctx.fillText(label, paddingL - 4 * dpr, y);
    }

    // Draw frequency axis labels (bottom)
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = `${Math.round(7 * dpr)}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const freqLabels = [
      { freq: 31.5, label: '31' },
      { freq: 63, label: '63' },
      { freq: 125, label: '125' },
      { freq: 250, label: '250' },
      { freq: 500, label: '500' },
      { freq: 1000, label: '1k' },
      { freq: 2000, label: '2k' },
      { freq: 4000, label: '4k' },
      { freq: 8000, label: '8k' },
      { freq: 16000, label: '16k' }
    ];
    for (const fl of freqLabels) {
      // Find band index for this frequency
      let bandIdx = SPECTRUM_CENTER_FREQS.findIndex(f => Math.abs(f - fl.freq) < fl.freq * 0.1);
      if (bandIdx >= 0) {
        const x = paddingL + bandIdx * (barWidth + gap) + barWidth / 2;
        ctx.fillText(fl.label, x, bottomY + 3 * dpr);
      }
    }
  }
}
