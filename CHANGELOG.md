# Changelog

All notable changes to VERO-BAAMBI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **EBU Tech 3341 play/pause** — tap for toggle, hold >300ms for momentary pause
- **K-weighting signal chain** — ITU-R BS.1770-4 pre-filter (high-pass 38 Hz + high-shelf +4 dB @ 4 kHz)
- **Broker URL validation** — `validateBrokerUrl()` with helpful error messages for ws:// and wss://
- **Production deployment docs** — nginx, systemd, Docker Compose, HTTPS reverse proxy configurations
- **Probe name persistence** — broker remembers probe names after disconnect/reconnect
- **Broker rate limiting** — 100 messages/second per connection, sliding window
- **Dynamic radar tooltip** — 60 Hz updates showing LUFS value and time offset on hover
- **Radar settings persistence** — sweep time and history duration saved to localStorage
- **CRT phosphor glow effect** — radar segments with authentic phosphor bloom
- **Continuous radar segments** — dynamic Catmull-Rom interpolation for smooth curves
- **Keyboard shortcuts documentation** — `docs/shortcuts.md` and sidebar help panel
- **JSON session export** — EBU R 128 format summary via `getSessionSummary()` API
- **Meter verification suite** — 5 automated tests (LUFS, PPM, correlation, ISP)
- **K-weighting visualisation** — toggle overlay in spectrum analyser
- **Calibration system** — auto/manual workflows with device-keyed profile storage
- **Loudness history strip** — configurable duration (1–10 min) with S/I overlay
- **REST API** — `/probes`, `/metrics` (Prometheus), `/health` endpoints
- **Wallboard view** — `wallboard.html` for NOC displays with alert indicators
- **Remote control** — `control.html` for headless probe operation

### Changed
- Renamed `SpectrumAnalyzer` → `SpectrumAnalyser` (British English consistency)
  - Constant: `SPECTRUM_CENTER_FREQS` → `SPECTRUM_CENTRE_FREQS`
  - Variables: `spectrumAnalyzerUI` → `spectrumAnalyserUI`, `centerFreq` → `centreFreq`
  - DOM ID: `spectrumAnalyzer` → `spectrumAnalyser`
- **Radar fade zone** — reduced to 3 LU from donut edge (was 30 LU)
- **BBC PPM display** — removed dBu unit (IEC 60268-10 Type IIa is dimensionless)
- **R128 panel hierarchy** — visual weight for M (small) / S (medium) / I (large)
- **Removed drag-and-drop panels** — fixed layout for broadcast consistency

### Fixed
- **BBC PPM input** — uses sample peak (max |sample|) not True Peak per IEC 60268-10 Type IIa
- **Radar pause/resume** — gap handling preserves smoothing, segments continue ageing during pause
- **Verification signal isolation** — `muteAllSources()` catches all generator signals
- **ISP verification test** — uses clipped 500 Hz sine for Gibbs phenomenon (was 12 kHz)
- **True Peak verification** — polyphase mode during tests for laboratory-grade accuracy
- **K-weighting applied** — LUFS meter now receives K-weighted samples (was unweighted)
- **PPM reset** — full state reset between verification tests
- **Boot timing** — 777ms splash masks canvas oval-to-circle glitch

## [2.2.0] - 2024-12-10

### Changed
- **BREAKING: Redesigned meter state API** with unit-prefixed property names for clarity:
  - TruePeak: `dbtpLeft`, `dbtpRight`, `dbtpHoldLeft`, `dbtpHoldRight`, `dbtpMax`
  - TruePeak: `isOver` → `isOverLeft`, `isOverRight`, `isOverAny` (per-channel detection)
  - PPM: `dbfsLeft`, `dbfsRight`, `dbfsHoldLeft`, `dbfsHoldRight`
  - PPM: `ppmScaleLeft`, `ppmScaleRight`, `ppmScaleHoldLeft`, `ppmScaleHoldRight`
  - Stereo: `correlationRaw` → `correlationInstant`
- Design principle: unit as prefix (`dbtp*`, `dbfs*`, `ppmScale*`) eliminates ambiguity

## [2.1.1] - 2024-12-10

### Added
- API reference documentation (`docs/api.md`)

### Changed
- **Standardised meter state property names** for consistency across all meters:
  - PPM: `displayL/R` → `left/right`, `peakHoldL/R` → `peakLeft/Right`, `ppmL/R` → `ppmLeft/Right`
  - TruePeak: `peakHoldL/R` → `peakLeft/Right`, `maxPeak` → `max`
- Removed duplicate `src/stereo/` module (functionality in `src/metering/correlation.js`)

## [2.1.0] - 2024-12-10

### Added
- **Remote metering module** — complete probe/broker/client architecture for distributed monitoring
  - WebSocket transport with auto-reconnect and exponential backoff
  - Probe sender collecting LUFS/True Peak/PPM/Stereo metrics at 10 Hz
  - Client receiver with subscription management and latency tracking
  - Minimal Node.js broker server for relay functionality
  - UI panel component with toggle controls and status display
- `probe.html` — standalone remote probe application
- BS.1770-4 calibration constant (−0.691 dB) for LUFS calculation
- IEC 60268-10 RC detector model for PPM (analogue-accurate ballistics)
- Strict JSDoc type annotations for TypeScript validation
- Expanded test coverage (35 tests across all metering algorithms)

### Changed
- Renamed functions and variables for consistency
  - Functions: `getCorrelationColour`, `normalise`, `normaliseAngle`
  - Variables: `centreX`, `centreY`, `colour`, `colours`
- Remote features now opt-in and fully functional (previously marked "Future")
- Directory structure updated with `broker/` and `src/remote/` modules

### Fixed
- Source switching from remote mode preserves user gesture for getDisplayMedia
- Goniometer output scale in probe mode (0.501 for −6 dBFS alignment)

## [2.0.0] - 2024-12-05

### Added
- Complete ESM modular architecture
- Automated metering verification tests
- Frame-rate independent display timing
- Comprehensive documentation with accuracy limitations
- CONTRIBUTING.md, SECURITY.md, LICENCE files
- Application integration layer (state, sources, renderer)

### Changed
- Refactored monolithic codebase into domain modules
- Softened compliance claims to reflect practical (non-certified) status
- Improved K-weighting documentation with sample rate limitations

### Fixed
- Goniometer phosphor decay now frame-rate independent
- PPM ballistics timing precision improved
- Import path errors in state management

## [1.0.0] - 2024-01-01

### Added
- Initial monolithic implementation
- EBU R128 LUFS metering (Momentary, Short-term, Integrated)
- True Peak detection with 4× Hermite interpolation
- Nordic PPM with IEC 60268-10 Type I ballistics
- Stereo phase correlation meter
- Loudness radar display
- M/S goniometer / vectorscope
- Local-first architecture with localStorage persistence
