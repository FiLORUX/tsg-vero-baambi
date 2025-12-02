# VERO-BAAMBI Verification Procedures

This document describes how to verify VERO-BAAMBI metering accuracy against reference signals.

## Quick Verification

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

For regulatory compliance or delivery QC, verify against certified hardware.
