# VERO-BAAMBI

**Broadcast-style audio metering for production environments**

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

### Remote Features (Future)

When remote features are implemented (probe/client architecture), they will:

- Require explicit user opt-in
- Work over local network only by default
- Never transmit audio content, only metrics
- Degrade gracefully when broker unavailable
- Never compromise local-mode functionality

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

## Directory Structure

```
tsg-vero-baambi/
├── index.html                  # ESM entry point (modular version)
├── audio-meters-grid.html      # Legacy monolithic version (fallback)
├── external-meter-processor.js # AudioWorklet for external sources
├── README.md                   # This file
├── smoke-checklist.md          # Manual testing checklist
│
└── src/
    ├── main.js                 # Application entry, initialisation
    │
    ├── app/                    # Application integration layer
    │   ├── index.js            # Module exports
    │   ├── bootstrap.js        # Main initialisation & DOM wiring
    │   ├── state.js            # Reactive state management (localStorage-backed)
    │   ├── sources.js          # Unified input source controller
    │   ├── render-loop.js      # 60 Hz visual rendering (RAF-based)
    │   ├── measure-loop.js     # 20 Hz measurement updates
    │   ├── meter-state.js      # Shared meter state between loops
    │   ├── meter-switcher.js   # Physics-based 3D carousel (TP/RMS/PPM)
    │   ├── layout.js           # Responsive canvas sizing
    │   ├── helpers.js          # Display formatting utilities
    │   ├── drag-drop.js        # Drag-and-drop file handling
    │   ├── transition-guard.js # EBU pulse visual blanking
    │   ├── glitch-debug.js     # Buffer discontinuity detection
    │   ├── renderer.js         # Render loop orchestration
    │   └── ui.js               # UI event bindings
    │
    ├── config/
    │   └── storage.js          # LocalStorage versioning
    │
    ├── remote/
    │   └── types.js            # Metrics schema for probe/client
    │
    ├── metering/               # Loudness measurement algorithms
    │   ├── index.js            # Module exports
    │   ├── lufs.js             # EBU R128 LUFS meter
    │   ├── ppm.js              # IEC 60268-10 Type I PPM (Nordic)
    │   ├── true-peak.js        # ITU-R BS.1770-4 intersample peak
    │   └── correlation.js      # Phase correlation & stereo analysis
    │
    ├── generators/             # Signal generators for alignment
    │   ├── index.js            # Module exports
    │   ├── oscillators.js      # Sine, sweep, GLITS (EBU Tech 3304)
    │   ├── noise.js            # Pink, white, brown noise
    │   ├── lissajous.js        # Stereo test patterns
    │   ├── presets.js          # Generator preset configurations
    │   ├── thast-vector-text.js      # Vector text for goniometer
    │   └── thast-vector-worklet.js   # AudioWorklet for vector text
    │
    ├── audio/                  # Web Audio integration
    │   ├── index.js            # Module exports
    │   └── engine.js           # AudioContext management
    │
    ├── ui/                     # Display components
    │   ├── index.js            # Module exports
    │   ├── goniometer.js       # Stereo vectorscope (Lissajous)
    │   ├── correlation-meter.js # Phase correlation display
    │   ├── radar.js            # Loudness history radar
    │   ├── spectrum.js         # 1/3-octave spectrum analyser
    │   ├── bar-meter.js        # LED bar renderers (TP, RMS, PPM)
    │   ├── width-meter.js      # Stereo width indicator
    │   ├── rotation-meter.js   # Image rotation display
    │   ├── balance-meter.js    # L/R balance indicator
    │   ├── ms-meter.js         # Mid/Side level display
    │   ├── stereo-analysis.js  # Stereo analysis engine
    │   └── colours.js          # Meter colour schemes
    │
    └── utils/                  # Shared utilities
        ├── index.js            # Module exports
        ├── format.js           # Display formatting (fixed-width)
        └── math.js             # Mathematical utilities (dB, clamp)
```

---

## Standards Implementation

### Audio Metering

| Standard | Description | Implementation |
|----------|-------------|----------------|
| EBU R128 | Loudness normalisation | LUFS meters (integrated, short-term, momentary) |
| ITU-R BS.1770-4 | Loudness measurement algorithm | K-weighting filter, gated measurement |
| EBU Tech 3341 | Loudness metering guidance | True Peak, LRA display |
| IEC 60268-10 Type I | Nordic PPM ballistics | Targets 5ms attack, 20dB/1.7s decay |

### Signal Generators

| Type | Standard | Purpose |
|------|----------|---------|
| GLITS | EBU Tech 3304 | Line-up and identification |
| Stereo identification | EBU Tech 3304 | L/R channel verification (pulsed) |
| 1/3-octave sweep | — | Frequency response verification |
| Pink/white/brown noise | — | Acoustic measurement, system noise floor |
| Lissajous patterns | — | Vectorscope calibration |

### Reference Levels

| Context | Reference | Digital Equivalent |
|---------|-----------|-------------------|
| EBU R68 (Europe) | 0 dBu | −18 dBFS |
| SMPTE RP 155 (USA) | +4 dBu | −20 dBFS |
| Nordic PPM | TEST (+6 dBu) | −12 dBFS |

---

## Accuracy, Methods & Limitations

### What This Project Does

VERO-BAAMBI implements broadcast-standard metering algorithms in pure JavaScript/Web Audio:

- **K-weighting**: Two-stage biquad filter chain (high-pass at 38 Hz, high-shelf +4 dB at 4 kHz) approximating ITU-R BS.1770-4 pre-filter response. Exact BS.1770 coefficients for 48 kHz are included for reference.

- **LUFS measurement**: Gated loudness per BS.1770-4 with 400 ms momentary, 3 s short-term, and programme-integrated windows. Absolute gate at −70 LUFS, relative gate at −10 LU.

- **True Peak**: 4× oversampling using Hermite interpolation to estimate intersample peaks. This is a practical approximation — not a full polyphase FIR reconstruction, but sufficient for detecting most intersample overs in typical programme material.

- **PPM ballistics**: Targets IEC 60268-10 Type I (Nordic) with 5 ms integration time and 20 dB/1.7 s linear decay. Implemented in JavaScript requestAnimationFrame loop, so timing precision depends on browser scheduling.

### Validated Against

- 1 kHz sine wave reference signals at known levels
- EBU R128 test sequences (manual comparison)
- Cross-checked against hardware meters (RTW, TC Electronic) in production environments

### What This Project Does NOT Provide

- **Formal certification**: No third-party laboratory has certified this implementation against ITU-R or EBU specifications.
- **Guaranteed timing precision**: Web Audio and requestAnimationFrame introduce scheduling variability. Attack/decay times are targeted, not guaranteed to laboratory precision.
- **Multi-channel support**: Currently stereo only. BS.1770 5.1/7.1 channel weightings are not implemented.
- **Sample rates beyond 48 kHz**: K-weighting coefficients are optimised for 48 kHz. Other rates use browser BiquadFilter approximations.

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

Runs synthetic signal tests against metering modules. All tests should pass before release.

### Manual Verification

Open `tools/verify-audio.html` in a browser for interactive verification with test tones.

See `docs/verification.md` for detailed test procedures using reference signals.

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

### Optional Dev Tools

For enhanced development experience, you can optionally use:

- **Live Server**: Auto-reload on file changes
- **TypeScript**: JSDoc type checking (no compilation)
- **ESLint**: Code style enforcement

```bash
# Example: Using VSCode Live Server extension
# Just right-click index.html and "Open with Live Server"
```

### Testing

See `smoke-checklist.md` for manual testing procedures.

```bash
# Serve files locally
python3 -m http.server 8080

# Run through the smoke checklist at http://localhost:8080/
```

---

## Architecture Notes

### AudioWorklet Path Resolution

AudioWorklet processors must be loaded via URL. The modular version uses `import.meta.url` for reliable path resolution:

```javascript
// Correct: Works regardless of deployment path
const WORKLET_PATH = new URL('../external-meter-processor.js', import.meta.url).href;

// Incorrect: Breaks if app is in subdirectory
const WORKLET_PATH = '/external-meter-processor.js';
```

### LocalStorage Versioning

Settings are stored with a version number to enable migration:

```javascript
// config/storage.js
export const STORAGE_VERSION = 1;
```

When the version changes, the migration logic can transform old settings to the new format.

### Feature Flags (Remote Features)

Remote features are controlled by explicit flags that default to disabled:

```javascript
// Remote features are never enabled by default
const REMOTE_ENABLED = localStorage.getItem('vero_remote_enabled') === 'true';
```

---

## Licence

MIT Licence. See `LICENCE` file.

Part of TSG Suite.
Maintained by David Thåst · https://github.com/FiLORUX

---

*Built with the assumption that behaviour should be predictable, output should be verifiable, and silence should mean silence.*
