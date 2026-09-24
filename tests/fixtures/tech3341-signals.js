/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * EBU Tech 3341 true-peak test signals (Table 1, cases 15–23)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Synthesis of the true-peak minimum-requirement signals exactly as EBU
 * Tech 3341 Table 1 describes them, shared by the Node conformance test
 * (tests/true-peak-test.js) and the browser test
 * (tests/browser/true-peak-browser.js). Pure ES module without Node or DOM
 * dependencies, so the same code runs in both environments.
 *
 * Verified against two independent BS.1770 implementations that pass the
 * official EBU files: libebur128 1.2.6 and the FFmpeg 6.1 ebur128 filter both
 * read all nine synthesised cases within +0.2/−0.4 dB of the table values.
 *
 * @module tests/fixtures/tech3341-signals
 * @see EBU Tech 3341 (2023) Table 1, cases 15–23
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { amplitudeToDbTP } from '../../src/metering/true-peak.js';

export /**
 * EBU Tech 3341 Table 1 tolerance for the true-peak cases.
 *
 * @param {number} readingDb - Meter reading in dBTP
 * @param {number} expectedDb - Expected maximum true-peak level in dBTP
 * @returns {boolean} True when the reading lies within +0.2/−0.4 dB
 */
function withinEbuTolerance(readingDb, expectedDb) {
  return readingDb <= expectedDb + 0.2 && readingDb >= expectedDb - 0.4;
}

/**
 * Cases 15 to 19 for a given sample rate: stereo sines at fs/4, fs/6 and
 * fs/8 with the amplitudes and phases of Table 1.
 *
 * @param {number} sampleRate - Sample rate fs in Hz
 * @returns {Array<{id: number, frequency: number, amplitude: number, phaseDegrees: number, expectedDb: number}>}
 */
export function tech3341SineCases(sampleRate) {
  return [
    { id: 15, frequency: sampleRate / 4, amplitude: 0.50, phaseDegrees: 0.0, expectedDb: -6.0 },
    { id: 16, frequency: sampleRate / 4, amplitude: 0.50, phaseDegrees: 45.0, expectedDb: -6.0 },
    { id: 17, frequency: sampleRate / 6, amplitude: 0.50, phaseDegrees: 60.0, expectedDb: -6.0 },
    { id: 18, frequency: sampleRate / 8, amplitude: 0.50, phaseDegrees: 67.5, expectedDb: -6.0 },
    { id: 19, frequency: sampleRate / 4, amplitude: 1.41, phaseDegrees: 45.0, expectedDb: 3.0 }
  ];
}

export /**
 * Stereo sine wave as Tech 3341 describes it for cases 15 to 19: amplitude in
 * FFS, phase in degrees, and a 10 ms linear fade-in and fade-out. The duration
 * does not matter for the measurement; one second is used.
 *
 * @param {Object} spec - Signal specification
 * @param {number} spec.sampleRate - Sample rate in Hz
 * @param {number} spec.frequency - Frequency in Hz
 * @param {number} spec.amplitude - Amplitude in FFS (1.0 = full scale)
 * @param {number} spec.phaseDegrees - Initial phase in degrees
 * @returns {{ left: Float32Array, right: Float32Array }} Stereo signal
 */
function stereoSine({ sampleRate, frequency, amplitude, phaseDegrees }) {
  const length = sampleRate;
  const fade = Math.round(sampleRate * 0.010);
  const phase = (phaseDegrees * Math.PI) / 180;
  const left = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    let gain = 1;
    if (i < fade) gain = i / fade;
    else if (i >= length - fade) gain = (length - 1 - i) / fade;
    left[i] = amplitude * gain * Math.sin((2 * Math.PI * frequency * i) / sampleRate + phase);
  }

  return { left, right: Float32Array.from(left) };
}

/**
 * Blackman-windowed sinc low-pass kernel with unity DC gain.
 *
 * @param {number} taps - Kernel length (odd)
 * @param {number} cutoffNormalised - Cut-off as a fraction of the sample rate
 * @returns {Float64Array} Kernel
 */
function lowPassKernel(taps, cutoffNormalised) {
  const kernel = new Float64Array(taps);
  const centre = (taps - 1) / 2;
  let sum = 0;

  for (let i = 0; i < taps; i++) {
    const x = i - centre;
    const sinc = x === 0
      ? 2 * cutoffNormalised
      : Math.sin(2 * Math.PI * cutoffNormalised * x) / (Math.PI * x);
    const window = 0.42
      - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1))
      + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
    kernel[i] = sinc * window;
    sum += kernel[i];
  }

  for (let i = 0; i < taps; i++) kernel[i] /= sum;
  return kernel;
}

export /**
 * Cases 20 to 23: a stereo sine at fs/6, 0.50 FFS, containing a single period
 * of a sine at fs/4 with amplitude 1.00, phase-continuous on both sides. The
 * signal is synthesised at 4·fs, low-pass (anti-alias) filtered at fs/2 and
 * downsampled to fs with an offset of 0 to 3 samples at the 4·fs rate, with a
 * short fade-in and fade-out.
 *
 * At 4·fs the carrier spans 24 samples per period and the fs/4 period 16. The
 * burst begins at a positive-going zero crossing of the carrier, and the
 * carrier resumes from phase zero when the burst has completed its period, so
 * the waveform is continuous in value and phase at both junctions.
 *
 * @param {number} sampleRate - Target sample rate fs in Hz
 * @param {number} offset - Downsampling offset at the 4·fs rate (0 to 3)
 * @returns {{ left: Float32Array, right: Float32Array, referencePeakDb: number }}
 *   Stereo signal and the true peak of the band-limited 4·fs signal in dBTP
 */
function tech3341Case20(sampleRate, offset) {
  const rate4 = 4 * sampleRate;
  const length = Math.round(rate4 * 0.2);
  const carrierPeriod = 24;
  const burstPeriod = 16;
  const burstStart = Math.floor(length / 2 / carrierPeriod) * carrierPeriod;
  const source = new Float64Array(length);

  for (let i = 0; i < length; i++) {
    if (i < burstStart) {
      source[i] = 0.5 * Math.sin((2 * Math.PI * i) / carrierPeriod);
    } else if (i < burstStart + burstPeriod) {
      source[i] = Math.sin((2 * Math.PI * (i - burstStart)) / burstPeriod);
    } else {
      source[i] = 0.5 * Math.sin((2 * Math.PI * (i - burstStart - burstPeriod)) / carrierPeriod);
    }
  }

  const fade = Math.round(rate4 * 0.010);
  for (let i = 0; i < fade; i++) {
    source[i] *= i / fade;
    source[length - 1 - i] *= i / fade;
  }

  // Anti-alias at fs/2 before decimation, as the table prescribes.
  const kernel = lowPassKernel(511, 0.5 / 4);
  const centre = (kernel.length - 1) / 2;
  const filtered = new Float64Array(length);
  let referencePeak = 0;

  for (let i = 0; i < length; i++) {
    let acc = 0;
    const lo = Math.max(0, i + centre - (length - 1));
    const hi = Math.min(kernel.length - 1, i + centre);
    for (let k = lo; k <= hi; k++) acc += kernel[k] * source[i + centre - k];
    filtered[i] = acc;
    const abs = Math.abs(acc);
    if (abs > referencePeak) referencePeak = abs;
  }

  const decimatedLength = Math.floor((length - offset) / 4);
  const left = new Float32Array(decimatedLength);
  for (let n = 0; n < decimatedLength; n++) left[n] = filtered[4 * n + offset];

  return { left, right: Float32Array.from(left), referencePeakDb: amplitudeToDbTP(referencePeak) };
}
