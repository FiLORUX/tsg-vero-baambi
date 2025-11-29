# Changelog

All notable changes to VERO-BAAMBI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- Standardised British English spelling throughout

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
