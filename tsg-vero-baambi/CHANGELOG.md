# Changelog

All notable changes to VERO-BAAMBI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Repository now mirrored from monorepo source

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
- **Enforced British English exclusively** — removed all American spelling aliases
  - Functions: `getCorrelationColour`, `normalise`, `normaliseAngle`
  - Variables: `centreX`, `centreY`, `colour`, `colours`
  - No legacy aliases for backwards compatibility (no external consumers)
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
