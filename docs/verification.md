# VERO-BAAMBI Verification Procedures

This document describes how to verify VERO-BAAMBI metering accuracy against reference signals.

## Built-in Self-Test

The recommended verification method is the integrated meter verification system, accessible via the **VERIFY METERS** button in the sidebar.

### What It Tests

The self-test runs five automated tests using internal reference signals:

| Test | Signal | Expected | Tolerance |
|------|--------|----------|-----------|
| LUFS Integrated | Pink noise @ −23 LUFS | −23.0 LUFS | ±0.3 LU |
| PPM Alignment | 1 kHz sine @ −18 dBFS | 0 PPM (TEST) | ±1.0 PPM |
| Stereo Decorrelation | 997 Hz L + 1003 Hz R | ρ ≈ 0 | ±0.3 |
| Mono Correlation | L=R 1 kHz sine | ρ = +1.0 | ±0.05 |
| Intersample Peak | Clipped sine (Gibbs phenomenon) | TP > 0 dBTP | — |

### How It Works

1. All external sources are muted during verification
2. Internal test signals are injected directly into the analysis chain
3. Each meter is reset before its corresponding test
4. Readings are sampled from the actual meter state (not theoretical values)
5. Results are compared against EBU/ITU reference tolerances

### Technical Notes

- **Signal isolation**: Test signals bypass external sources entirely; they connect directly to the analysis gain stage
- **Meter state**: The verification reads actual meter output, not calculated expectations. This validates the complete signal chain including K-weighting, ballistics, and interpolation.
- **ISP detection**: The intersample peak test uses a clipped sine wave. Clipping creates discontinuities that produce genuine Gibbs phenomenon overshoot, which the Annex 2 polyphase filter reconstructs.
- **PPM reset**: Between tests, all meters are reset. This prevents the slow PPM decay (11.76 dB/s per IEC 60268-10) from carrying residual levels between tests.

---

## Additional Verification Methods

### Automated Tests (Node.js)

```bash
node tests/metering-verification.js
node tests/true-peak-test.js
```

The first tests pure mathematical functions: dB conversions, RMS calculation, correlation, true-peak sanity, PPM decay rate. The second synthesises EBU Tech 3341 Table 1 cases 15 to 23 and asserts the +0.2/−0.4 dB true-peak tolerance.

### Browser Tests

```bash
npm run test:browser
```

Drives the real Web Audio pipeline in headless Chromium (needs the `playwright-core` dev dependency and `npx playwright-core install chromium`, or `CHROMIUM_PATH`): the stereo-sampler AudioWorklet against `TruePeakDetector` bit for bit at 44.1, 48, 96 and 192 kHz; EBU Tech 3341 cases 15 to 23 in real time with the main thread blocked for one second across the signal; the four Intersample Peak Demo presets through the application's generator, measure loop and TPmax display; the built-in Meter Verification Tool; and the remote chain, from the probe page through a local broker into the application's remote mode, including a scripted probe whose level drops while the received TPmax must hold, and a switch to a second probe that must start a new TPmax.

```bash
npm run test:browser:tauri
```

Runs the application in Tauri mode against a mocked native engine: packets in the engine's binary layout whose level fields describe a −18 dBFS sine while their display snapshots carry a spliced −40 dBFS one. Nordic PPM, dBFS (RMS), Sample Peak and True Peak must read the engine's values, a full-scale sample that falls between two snapshots must reach the Sample Peak meter, and the Nordic PPM must clamp to its display range as in local metering. The window that rebuilds sample peak and RMS from the engine's packets is tested in Node (`node tests/level-window-test.js`, part of `npm test`).

```bash
npm run test:browser:ppm
```

Plays a 1 kHz tone at 0 dBFS through the application's generator, stops it, and times the displayed return on every animation frame: the Nordic PPM must fall 20 dB in 1.7 s ±0.3 s and the BBC PPM 24 dB in 2.8 s ±0.3 s, with the stereo-sampler AudioWorklet and again with the sampler blocked, where the application feeds its own detectors from the analyser. The detector arithmetic and the feed are tested in Node (`node tests/ppm-feed-test.js`, part of `npm test`).

Open `tools/verify-audio.html` in a modern browser and click "Run All Tests".

Tests Web Audio integration: sine RMS measurement, K-weighting frequency response, stereo correlation.

---

## Manual Verification with Test Signals

### Reference Equipment

For accurate verification, you need:
- Calibrated audio interface (minimum 24-bit, 48kHz)
- Reference level test tones (EBU R128 test sequences recommended)
- Optional: Reference hardware meter (RTW, TC Electronic, DK-Audio)

### Test Procedure: LUFS Accuracy

1. **Generate reference tone**: 1kHz sine at -23 dBFS (peak)
2. **Expected reading**: -23.0 LUFS ±0.5 LU
3. **Play for at least 3 seconds** for short-term to stabilise
4. **Compare** integrated LUFS after 60 seconds

**EBU R128 test signals** (if available):
- Tech 3341 pink noise at -23 LUFS: Verify integrated reading
- Gated speech material: Compare to reference meter

### Test Procedure: True Peak

Use the generator's **Intersample Peak Demo** presets. Each has a fixed phase against the sample grid, so both the sample peak and the true peak are known exactly:

| Preset | Signal | Sample peak | True peak | Reads |
|--------|--------|-------------|-----------|-------|
| No ISP | 1 kHz, 0 dBFS | 0.0 dBFS | 0.0 dBTP | 0.0 dBTP |
| Mild ISP | fs/8 at 67.5° | −0.7 dBFS | 0.0 dBTP | −0.0 dBTP |
| Moderate ISP | fs/6 at 60° | −1.2 dBFS | 0.0 dBTP | −0.3 dBTP |
| Maximum ISP | fs/4 at 45°, samples +1, +1, −1, −1 | 0.0 dBFS | +3.0 dBTP | +3.1 dBTP |

Reset R128 after selecting a preset: switching presets starts the new waveform abruptly, and that onset has a genuinely higher true peak (up to +3.2 dBTP for Maximum ISP).

#### True Peak Algorithm

VERO-BAAMBI measures true peak with a single method, the ITU-R BS.1770-4 Annex 2 polyphase FIR:

| Property | Value |
|----------|-------|
| Filter | 48-tap FIR interpolation filter from the Annex 2 table, four 12-tap branches |
| Over-sampling | 4× up to 48 kHz, 2× (branches 0 and 2) above; the Tech 3341 cases, which scale with fs, pass at 48, 96 and 192 kHz |
| Conformance | EBU Tech 3341 Table 1 cases 15 to 23 within +0.2/−0.4 dB (`node tests/true-peak-test.js`) |
| Feed | Every sample, in the stereo-sampler AudioWorklet; independent of frame rate, dropped frames and background-tab throttling. The ScriptProcessor fallback measures on the main thread and skips, without splicing, any block a stalled thread misses. Analyser windows only without a sampler; the Rust engine's per-sample peaks in Tauri mode |
| Ballistics | TPmax, peak hold and the over indication from the unsmoothed peak; the bar rises instantly and falls 20 dB in 1.7 s |
| Cost | 48 multiply-accumulates per input sample and channel at 4× |

The synthesised Tech 3341 signals were cross-checked against two independent implementations that pass the official EBU files:

| Case | VERO-BAAMBI | libebur128 1.2.6 | FFmpeg 6.1 `ebur128` | Required |
|------|-------------|------------------|----------------------|----------|
| 15 | −6.22 | −6.02 | −6.0 | −6.0 +0.2/−0.4 |
| 16 | −5.98 | −6.05 | −6.0 | −6.0 +0.2/−0.4 |
| 17 | −6.31 | −6.01 | −6.0 | −6.0 +0.2/−0.4 |
| 18 | −6.03 | −6.02 | −6.0 | −6.0 +0.2/−0.4 |
| 19 | +3.03 | +2.95 | +3.0 | +3.0 +0.2/−0.4 |
| 20 | −0.15 | −0.13 | −0.1 | 0.0 +0.2/−0.4 |
| 21 | −0.08 | −0.08 | −0.1 | 0.0 +0.2/−0.4 |
| 22 | −0.20 | −0.18 | −0.1 | 0.0 +0.2/−0.4 |
| 23 | −0.08 | −0.08 | −0.1 | 0.0 +0.2/−0.4 |

The lower readings of cases 15 and 17 are the passband ripple of the tabulated Annex 2 filter, which the EBU tolerance explicitly includes.

To check the official files, download the [EBU loudness test set](https://tech.ebu.ch/publications/ebu_loudness_test_set), unpack it and run:

```bash
npm run test:ebu-files -- /path/to/ebu-loudness-test-set
```

The test finds cases 15 to 23 by their Tech 3341 number in the file name, reads 16-, 24- and 32-bit PCM or float WAV, and asserts the +0.2/−0.4 dB tolerance.

The `truePeakMode` key in application state remains for persisted settings; `polyphase` is its only value.

### Test Procedure: PPM Ballistics

1. **Attack test**: Apply sudden 1kHz burst
   - Meter should reach -1 dB of final value within 5ms ±1ms
   - (Browser timing variance may extend this)

2. **Decay test**: Remove signal after steady-state
   - 20 dB drop should occur in 1.7s ±0.2s
   - Measure time from peak to -20 dB below peak
   - Automated for the displayed Nordic and BBC readings: `npm run test:browser:ppm`

### Test Procedure: Stereo Correlation

1. **Mono test**: Route same signal to L and R
   - Expected: +1.0 correlation ±0.01

2. **Inverted test**: Route inverted signal to R
   - Expected: -1.0 correlation ±0.01

3. **Stereo width test**: Normal stereo material
   - Typical music: +0.3 to +0.8
   - Wide mix: +0.2 to +0.5

---

## Reference Values

### Sine Wave Levels

| Peak Amplitude | Peak dBFS | RMS dBFS |
|---------------|-----------|----------|
| 1.0           | 0.0       | -3.01    |
| 0.5           | -6.02     | -9.03    |
| 0.1           | -20.0     | -23.01   |

### K-Weighting Response (48kHz)

| Frequency | Gain |
|-----------|------|
| 100 Hz    | ~0 dB |
| 1000 Hz   | 0 dB (reference) |
| 4000 Hz   | ~+2 dB |
| 10000 Hz  | ~+4 dB |

### PPM Ballistics (IEC 60268-10 Type I)

| Parameter | Specification |
|-----------|---------------|
| Attack time | 5 ms ±0.5 ms |
| Fall time | 20 dB in 1.7s ±0.3s |
| Decay rate | ~11.76 dB/s |

---

## Standards Compliance Verification

For rigorous validation against broadcast standards:

| Measurement | Method | Reference |
|-------------|--------|-----------|
| PPM ballistics | 1 kHz burst signal, measure attack/decay timing | IEC 60268-10 Type I |
| K-weighting | Swept sine, compare frequency response curve | ITU-R BS.1770-4 |
| LUFS gating | EBU R128 test sequences (available from EBU) | EBU Tech 3341 |
| True Peak | Intersample peak test files (0 dBFS sine → >0 dBTP expected) | ITU-R BS.1770-4 Annex 2 |

---

## Troubleshooting

### Readings differ from hardware

- Check sample rate: K-weighting is optimised for 48kHz
- Check audio routing: Ensure signal reaches browser without processing
- Check reference level: Verify input isn't clipping

### PPM timing seems off

- The detectors run on the audio clock (in the stereo-sampler AudioWorklet), so their attack and return do not depend on the frame rate
- The display samples them once per animation frame (16-17ms typical) and shows the largest reading since the previous frame
- Use hardware meter for critical timing verification

### LUFS readings fluctuate

- Integrated LUFS requires settling time (10-20 seconds minimum)
- Short-term (3s) and Momentary (400ms) are expected to fluctuate
- Check for intermittent signal dropouts

---

## Known Limitations

1. **Sample rate**: K-weighting coefficients optimised for 48kHz only
2. **Timing precision**: Browser scheduling introduces ±2ms jitter
3. **Bit depth**: Web Audio operates in 32-bit float internally
4. **Multi-channel**: Stereo only; no 5.1/7.1 support
5. **True Peak near Nyquist**: the Annex 2 filter rolls off above 20 kHz and 4× over-sampling under-reads a tone at fs/2 by up to 0.69 dB (Annex 2 Attachment 1); programme content at those frequencies is far below full scale

For regulatory compliance or delivery QC, verify against certified hardware.
