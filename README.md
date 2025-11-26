# VERO-BAAMBI

**Broadcast-grade audio metering for professional environments**

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

4. **Predictable behavior**
   - Same code runs in development and production
   - No environment-specific branches in core logic
   - Feature flags are explicit, never hidden

5. **Verifiable output**
   - Metering accuracy can be verified with reference signals
   - Compliant with EBU R128, ITU-R BS.1770-4, IEC 60268-10
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
    ├── main.js                 # Application entry, initialization
    ├── config/
    │   └── storage.js          # LocalStorage versioning
    ├── remote/
    │   └── types.js            # Metrics schema for probe/client
    ├── metering/               # (Phase 2+) EBU R128, LUFS, True Peak
    ├── audio/                  # (Phase 2+) AudioContext, worklets
    ├── stereo/                 # (Phase 2+) Correlation, phase meters
    ├── ui/                     # (Phase 2+) DOM rendering, components
    └── utils/                  # (Phase 2+) Shared utilities
```

---

## Standards Compliance

### Audio Metering

| Standard | Description | Implementation |
|----------|-------------|----------------|
| EBU R128 | Loudness normalisation | LUFS meters, integrated/short-term/momentary |
| ITU-R BS.1770-4 | Loudness measurement algorithm | K-weighting filter, gated measurement |
| EBU Tech 3341 | Loudness metering specification | True Peak, LRA |
| IEC 60268-10 Type I | Nordic PPM ballistics | 5ms attack, 20dB/1.7s decay |

### Reference Levels

| Context | Reference | Digital Equivalent |
|---------|-----------|-------------------|
| EBU R68 (Europe) | 0 dBu | -18 dBFS |
| SMPTE RP 155 (USA) | +4 dBu | -20 dBFS |
| Nordic PPM | TEST (+6 dBu) | -12 dBFS |

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

## License

Part of TSG Suite.
Maintained by David Thåst · https://github.com/FiLORUX

---

*Built with the assumption that behaviour should be predictable, output should be verifiable, and silence should mean silence.*
