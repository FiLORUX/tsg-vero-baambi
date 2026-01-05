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
- **ISP detection**: The intersample peak test uses a clipped sine wave. Clipping creates discontinuities that produce genuine Gibbs phenomenon overshoot, detectable by both Hermite and polyphase algorithms.
- **PPM reset**: Between tests, all meters are reset. This prevents the slow PPM decay (11.76 dB/s per IEC 60268-10) from carrying residual levels between tests.

---

## Additional Verification Methods

### Automated Tests (Node.js)

```bash
node tests/metering-verification.js
```

Tests pure mathematical functions: dB conversions, RMS calculation, correlation, Hermite interpolation, PPM decay rate.

### Browser Tests

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

1. **Generate intersample peak test signal**: Two frequencies near Nyquist that constructively interfere
2. **Compare sample peak vs True Peak**: True Peak should exceed sample peak
3. **Known intersample over**: Use +3 dBTP test signal; verify detection

#### True Peak Algorithm Modes

VERO-BAAMBI offers two True Peak detection algorithms:

| Mode | Algorithm | Accuracy | CPU Cost | Use Case |
|------|-----------|----------|----------|----------|
| `hermite` | Catmull-Rom spline | ±0.5 dB typical | ~24 FLOPs/sample | Real-time monitoring (default) |
| `polyphase` | ITU-R BS.1770-4 Annex 2 FIR | <0.1 dB | ~48 FLOPs/sample | Laboratory-grade measurement |

**Polyphase Implementation:**
- 4-phase × 12-tap FIR filter (48-tap prototype at 4× oversampling)
- Coefficients derived from ITU-R BS.1770-4 Annex 2
- DC gain normalised to unity per phase
- Compliant with EBU Tech 3341 Section 3.5

**Mode Selection:**
The algorithm mode is stored in application state (`truePeakMode`) and persists across sessions. Both algorithms produce identical results for low-frequency signals; differences manifest primarily near Nyquist where the polyphase filter's flat frequency response provides superior accuracy.

### Test Procedure: PPM Ballistics

1. **Attack test**: Apply sudden 1kHz burst
   - Meter should reach -1 dB of final value within 5ms ±1ms
   - (Browser timing variance may extend this)

2. **Decay test**: Remove signal after steady-state
   - 20 dB drop should occur in 1.7s ±0.2s
   - Measure time from peak to -20 dB below peak

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

- Browser requestAnimationFrame has variable timing (16-17ms typical)
- Exact 5ms attack is not guaranteed in browser environment
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
5. **True Peak polyphase mode**: Higher computational cost (~2× versus Hermite); use for verification rather than continuous monitoring on constrained devices

For regulatory compliance or delivery QC, verify against certified hardware.
