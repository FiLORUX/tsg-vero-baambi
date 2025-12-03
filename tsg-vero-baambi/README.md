# VERO-BAAMBI

**Broadcast audio metering for production environments**

> A local-first, dependency-free implementation of EBU R128 loudness metering,
> True Peak detection, and Nordic PPM — designed for verification and monitoring
> in broadcast workflows.

> *VERO* – "true" in Italian and Esperanto
> *BAAMBI* – Broadcast Audio Alignment & Metering for Broadcast Infrastructure

Part of the TSG Suite – tools for alignment, metering, and signal verification.

---

## Local-First Manifesto

This application is built on the principle that **local operation is not a fallback – it is the primary mode**.

### Core Principles

1. **Zero external dependencies for core functionality**
   - No CDN imports, no npm packages in production
   - No build step required – works from any static file server
   - No analytics, no tracking, no phone-home

2. **Privacy by design**
   - All audio processing happens in-browser
   - No audio data leaves the device
   - Settings stored locally in browser storage
   - Remote features are opt-in, never opt-out

3. **Offline-capable by default**
   - Full functionality without network access
   - No service worker required for basic operation
   - Works from `file://` protocol for testing

4. **Predictable behaviour**
   - Same code runs in development and production
   - No environment-specific branches in core logic
   - Feature flags are explicit, never hidden

5. **Verifiable output**
   - Metering accuracy can be verified with reference signals
   - Implements EBU R128, ITU-R BS.1770-4, IEC 60268-10 algorithms
   - Calibration against known test signals documented

### Remote Features

Remote metering is now fully implemented with a probe/broker/client architecture:

- **Explicit user opt-in** — disabled by default, enabled via UI toggle
- **Local network first** — broker runs on localhost, configurable for LAN
- **Metrics only** — no audio content transmitted, only numerical values (LUFS, True Peak, PPM, stereo)
- **Graceful degradation** — queues messages during disconnection, auto-reconnects with exponential backoff
- **Zero impact on local mode** — remote features are additive, local operation unaffected

See `src/remote/` for implementation and `broker/` for the relay server.

---

## Quick Start

### Option 1: Legacy Monolithic Version

Open `audio-meters-grid.html` directly in a browser.

```bash
# From this directory
open audio-meters-grid.html

# Or serve locally
python3 -m http.server 8080
# Then visit http://localhost:8080/audio-meters-grid.html
```

### Option 2: Modular ESM Version

Open `index.html` via a local server (required for ES modules).

```bash
# Serve the directory
python3 -m http.server 8080

# Visit http://localhost:8080/
```

---

## Standards Implementation

### Loudness Metering (EBU R128 / ITU-R BS.1770-4)

| Parameter | Standard | Implementation |
|-----------|----------|----------------|
| K-weighting pre-filter | ITU-R BS.1770-4 §2.1 | Two-stage biquad: high-pass (fc=38 Hz, Q=0.5) + high-shelf (+4 dB @ 4 kHz) |
| Momentary loudness (M) | EBU Tech 3341 | 400 ms sliding window, gated |
| Short-term loudness (S) | EBU Tech 3341 | 3 s sliding window, gated |
| Integrated loudness (I) | ITU-R BS.1770-4 §4 | Programme-length, dual-gated |
| Absolute gate | ITU-R BS.1770-4 §4.1 | −70 LUFS |
| Relative gate | ITU-R BS.1770-4 §4.2 | −10 LU below ungated integrated |
| Loudness Range (LRA) | EBU Tech 3342 | 95th − 10th percentile of gated short-term |
| Target loudness | EBU R128 | −23 LUFS (±1 LU tolerance) |

### True Peak Detection (ITU-R BS.1770-4 Annex 2)

| Parameter | Standard | Implementation |
|-----------|----------|----------------|
| Oversampling | ITU-R BS.1770-4 Annex 2 | 4× using Hermite interpolation |
| Maximum permitted level | EBU R128 | −1 dBTP |
| Streaming headroom | Industry practice | −2 dBTP (lossy codec margin) |

**Implementation note:** ITU-R BS.1770-4 Annex 2 specifies polyphase FIR reconstruction for laboratory-grade measurement. This implementation uses 4-point Hermite interpolation, which:
- Provides sufficient accuracy (±0.5 dB) for broadcast monitoring
- Requires ~8× less computation than polyphase FIR
- May miss edge-case intersample peaks in near-Nyquist content

Polyphase FIR coefficients and implementation guidance are documented in `true-peak.js` for future laboratory-grade implementation if required.

### PPM Metering (IEC 60268-10 Type I / Nordic)

| Parameter | Standard | Implementation |
|-----------|----------|----------------|
| Integration time | IEC 60268-10 Type I | 5 ms (quasi-peak) |
| Rise time to −1 dB | IEC 60268-10 Type I | 5 ms ± 0.5 ms |
| Fall time | IEC 60268-10 Type I | 20 dB in 1.7 s (≈11.76 dB/s linear) |
| Scale range | Nordic convention | −36 to +9 PPM (45 dB) |
| Peak hold | RTW/DK convention | 3 s |
| Detector model | IEC 60268-10 | RC circuit (default) or window-max |

**Quasi-peak detector:** Two modes are available:
- **RC detector** (default): Models analogue rectifier + RC network per IEC 60268-10. Attack time constant τ ≈ 1.7 ms (−1 dB in 5 ms), decay τ ≈ 740 ms. Provides smooth, "analogue" response with correct tone-burst behaviour.
- **Window mode**: Simplified maximum-within-window approach. Faster computation but may over-read fast transients by ~1 dB.

### Reference Levels (EBU R68 / Alignment)

| Context | Analogue Reference | Digital Reference | PPM Reading |
|---------|-------------------|-------------------|-------------|
| EBU alignment tone | 0 dBu | −18 dBFS | 0 PPM |
| Nordic TEST level | +6 dBu | −12 dBFS | +6 PPM (TEST) |
| Permitted Maximum Level (PML) | +9 dBu | −9 dBFS | +9 PPM |
| SMPTE alignment (USA) | +4 dBu | −20 dBFS | — |

**Conversion formula:** PPM = dBFS + 18 (per EBU R68 alignment where 0 dBu = −18 dBFS)

### Stereo Analysis

| Measurement | Standard/Method | Range |
|-------------|-----------------|-------|
| Phase correlation | Pearson correlation coefficient | −1 (antiphase) to +1 (mono) |
| L/R balance | RMS level difference | −1 (full left) to +1 (full right) |
| Stereo width | M/S energy ratio (Side/Mid) | 0 (mono) to >1 (wide) |
| Mono compatibility threshold | Broadcast practice | Correlation < −0.3 = warning |

### Signal Generators

| Type | Standard | Purpose |
|------|----------|---------|
| GLITS | EBU Tech 3304 | Line-up and identification |
| Stereo identification | EBU Tech 3304 | L/R channel verification (pulsed) |
| Reference tones | — | 1 kHz @ −18 dBFS (EBU), −20 dBFS (SMPTE) |
| Pink/white/brown noise | — | Acoustic measurement, system noise floor |
| Lissajous patterns | — | Vectorscope/goniometer calibration |

---

## Accuracy, Methods & Limitations

### K-Weighting Filter

The K-weighting implementation uses Web Audio API `BiquadFilterNode` for real-time efficiency:

- **Stage 1:** High-pass filter (fc=38 Hz, Q=0.5)
- **Stage 2:** High-shelf filter (+4 dB @ 4 kHz)

Exact ITU-R BS.1770-4 biquad coefficients for 48 kHz are included in `k-weighting.js` for reference and offline processing. The Web Audio approximation may deviate by ≤0.1 dB from the specification at extreme frequencies.

**Sample rate consideration:** Coefficients are calculated for 48 kHz. At 44.1 kHz, expect minor deviation (typically <0.2 dB) in high-frequency response.

### PPM Ballistics

PPM timing is implemented using `requestAnimationFrame` scheduling, not hardware timers. Practical implications:

- Attack time (5 ms) depends on audio buffer size and frame timing
- Decay rate (11.76 dB/s) is calculated per-frame using elapsed time
- Browser throttling (background tabs) will affect ballistics accuracy

For critical monitoring, use dedicated hardware meters.

### True Peak Interpolation

The 4× oversampling uses Hermite interpolation between sample points:

```
Interpolation points: t = 0.25, 0.50, 0.75 between each sample pair
```

This catches most intersample peaks but may miss edge cases that a full polyphase FIR would detect. Typical deviation from "true" True Peak: <0.5 dB for normal programme material.

### What This Project Does NOT Provide

- **Formal certification:** No third-party laboratory has certified this implementation
- **Guaranteed timing precision:** Web browser scheduling is not deterministic
- **Multi-channel support:** Stereo only; BS.1770 5.1/7.1 channel weights not implemented
- **Regulatory compliance:** Not suitable as sole evidence for delivery QC

### Practical Positioning

This tool is designed for:

- Quick verification during production
- Confidence monitoring alongside dedicated hardware
- Educational understanding of broadcast metering concepts
- Environments where installing dedicated software is impractical

It is **not** intended to replace certified measurement equipment for delivery QC or regulatory compliance.

---

## Verification

### Automated Tests

```bash
node tests/metering-verification.js
```

Runs 35 synthetic signal tests against metering modules covering:

- dB/gain conversions
- RMS calculation (sine wave at 0.707× peak)
- Pearson correlation (mono, antiphase, uncorrelated)
- Hermite interpolation accuracy
- PPM ballistics (5 ms attack, 20 dB/1.7 s decay)
- True Peak intersample detection
- LUFS integration windows (400 ms, 3 s)
- Stereo width and balance calculations

### Manual Verification

Open `tools/verify-audio.html` in a browser for interactive verification with test tones.

See `docs/verification.md` for detailed test procedures using reference signals.

---

## Directory Structure

```
tsg-vero-baambi/
├── index.html                  # ESM entry point (modular version)
├── audio-meters-grid.html      # Legacy monolithic version (fallback)
├── probe.html                  # Remote probe application
├── external-meter-processor.js # AudioWorklet for external sources
├── README.md                   # This file
├── smoke-checklist.md          # Manual testing checklist
│
├── broker/                     # Remote metering relay server
│   ├── server.js               # Minimal WebSocket broker (Node.js)
│   └── package.json            # Broker dependencies (ws only)
│
└── src/
    ├── main.js                 # Application entry, initialisation
    │
    ├── metering/               # Measurement algorithms
    │   ├── lufs.js             # EBU R128 / ITU-R BS.1770-4 loudness
    │   ├── ppm.js              # IEC 60268-10 Type I PPM (Nordic)
    │   ├── true-peak.js        # ITU-R BS.1770-4 Annex 2 intersample peak
    │   ├── k-weighting.js      # ITU-R BS.1770-4 pre-filter
    │   └── correlation.js      # Phase correlation & stereo analysis
    │
    ├── generators/             # Signal generators
    │   ├── oscillators.js      # Sine, sweep, GLITS (EBU Tech 3304)
    │   ├── noise.js            # Pink, white, brown noise
    │   └── lissajous.js        # Stereo test patterns
    │
    ├── ui/                     # Display components
    │   ├── goniometer.js       # Stereo vectorscope (Lissajous)
    │   ├── correlation-meter.js # Phase correlation display
    │   ├── bar-meter.js        # LED bar renderers (TP, RMS, PPM)
    │   └── spectrum.js         # 1/3-octave spectrum analyser
    │
    ├── app/                    # Application integration
    │   ├── bootstrap.js        # Main initialisation & DOM wiring
    │   ├── render-loop.js      # 60 Hz visual rendering (RAF-based)
    │   └── measure-loop.js     # 20 Hz measurement updates
    │
    ├── stereo/                 # Stereo analysis (legacy location)
    │   └── correlation.js      # Duplicate of metering/correlation.js
    │
    └── remote/                 # Remote metering module
        ├── index.js            # Remote module exports
        ├── types.js            # Metrics schema (RemoteMetrics type)
        ├── transport/          # WebSocket communication
        │   ├── index.js        # Transport exports
        │   └── websocket-client.js # Auto-reconnect WebSocket wrapper
        ├── probe/              # Metrics sender (source side)
        │   ├── index.js        # Probe exports
        │   ├── probe-sender.js # Streams metrics to broker
        │   └── metrics-collector.js # Gathers meter values
        ├── client/             # Metrics receiver (display side)
        │   ├── index.js        # Client exports
        │   └── metrics-receiver.js # Receives and distributes metrics
        └── ui/                 # Remote UI components
            ├── index.js        # UI exports
            ├── remote-panel.js # Toggle and status panel
            └── remote-panel.css # Panel styling
```

---

## Browser Compatibility

| Browser | Minimum Version | Notes |
|---------|-----------------|-------|
| Chrome | 66+ | Full AudioWorklet support |
| Edge | 79+ | Chromium-based |
| Firefox | 76+ | AudioWorklet since 76 |
| Safari | 14.1+ | AudioWorklet since 14.1 |

---

## Development

### No Build Required

The application runs directly from source files. No transpilation, bundling, or build process needed.

### CI Pipeline

GitHub Actions runs on every push:

- **ESLint:** Code style enforcement
- **Syntax check:** `node --check` on all source files
- **Type check:** `tsc --noEmit --checkJs --strict` on metering modules
- **Tests:** 35 metering algorithm verification tests

### Optional Dev Tools

For enhanced development experience:

- **Live Server:** Auto-reload on file changes
- **TypeScript:** JSDoc type checking without compilation
- **ESLint:** Code style enforcement

---

## Licence

MIT Licence. Copyright 2025 David Thåst.

Part of TSG Suite.
Maintained by David Thåst · https://github.com/FiLORUX

---

*Built with the assumption that behaviour should be predictable, output should be verifiable, and silence should mean silence.*
