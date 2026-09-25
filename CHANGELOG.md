# Changelog

All notable changes to VERO-BAAMBI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **True-peak browser verification** · `npm run test:browser` drives headless Chromium: worklet bit-exactness at 44.1 to 192 kHz, Tech 3341 cases 15 to 23 in real time across a main-thread stall, the ISP presets through the application, and the built-in Meter Verification Tool. The synthesised Tech 3341 signals (`tests/fixtures/tech3341-signals.js`) were cross-checked against libebur128 1.2.6 and FFmpeg 6.1, both within tolerance on all nine cases. `BROWSER=firefox` and `BROWSER=webkit` run the same suite in Gecko and in WebKit, the engine behind Safari.
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
- **Meter verification signal** · the in-app pink-noise test now scales its noise by 0.0297 (0.042/√2) so it still reads −23 LUFS with the corrected channel summation
- **Stereo loudness summation** · `LUFSMeter.calculateBlockEnergy()` now sums the left and right mean-square energies per ITU-R BS.1770-4 (Σ Gᵢ·zᵢ, G = 1.0) instead of averaging them. Every stereo reading was 3.01 LU low: EBU Tech 3341 test case 1 (stereo 1 kHz sine at −23 dBFS) read −26.0 LUFS and now reads −23.0. Calibration profiles created before this change carry a trim offset that is 3.01 dB off for stereo sources; re-run calibration after updating. The tests now pin BS.1770-4 §4 (single-channel 0 dBFS sine → −3.01 LKFS, stereo → 0.0) and EBU Tech 3341 cases 1 and 2 with deterministic sines instead of a self-tuned pink-noise level
- **True Peak TPmax, hold and over from unsmoothed peaks** · the meter smoothed every reading in dB before deriving peak hold, TPmax and the over indication, so transients under-read: EBU Tech 3341 case 20 read −1.6 dBTP at 60 fps and −3.6 dBTP at 30 fps against 0.0, and a 20 ms burst at 0 dBTP never tripped the −1 dBTP over. TPmax, hold and over now take the unsmoothed peak; the bar rises instantly and falls 20 dB in 1.7 s on the meter's clock. The `smoothing` option is replaced by `releaseDbPerSecond`; `getState()` adds `dbtpMaxLeft` and `dbtpMaxRight`. A non-finite sample reads as a +60 dBTP over that a reset clears.
- **Sample-complete True Peak** · the stereo-sampler AudioWorklet measures the Annex 2 true peak of every sample, silence included, and posts the maxima about every 10 ms. The meter no longer depends on the UI frame rate: with the main thread blocked for one second across cases 20 to 23, TPmax still reads within tolerance, where analyser windows see nothing of the signal. A reset discards reports already in flight. The ScriptProcessor fallback measures its blocks on the main thread and detects a block it missed, so the join is never read as a peak. The probe page uses the same feed.
- **Remote TPmax** · the receiver showed the current bar reading as TPmax; it now keeps the running maximum, which starts afresh for a new probe. The probe's metrics collector reads every peak since its previous transmission through a dedicated peak reader instead of sampling the falling bar, and discards what accumulated while it was not transmitting. The radar peak indicator now clears after its hold in remote and Tauri mode as well.
- **Remote metrics reached the display at all** · the probe page called `stereoAnalysis.analyze()`, renamed to `analyse()`, so its metrics loop threw before every transmission; and the receiver tested values with the global `isFinite`, which accepts the `null` that JSON makes of −Infinity, so an empty LRA threw on every message. Both paths now run end to end (`npm run test:browser`, section 5).
- **Remote probe going offline** · clearing the remote displays called `update()` on the width and balance meters, which have no such method, so the probe-list listener threw whenever the selected probe went offline, and stopping remote capture skipped its button and control updates. The width meter now draws empty and the balance meter gains `reset()`, which centres it at once. `npm run test:browser` section 5 takes the selected probe offline and asserts that the displays clear without listener errors.
- **Tauri mode drew no meters** · the render loop was initialised with an argument shape it does not read, so every frame threw before drawing; the measure loop was then re-initialised with an incompatible set, so every tick threw; the R128 reset stayed disabled, and its handler called a radar method that does not exist; and the status line read `Tauri: [object Object]`. Tauri mode now shares the browser mode's render-loop dependencies, keeps the measure loop's module-level initialisation, enables the reset once capture runs and names the backend. Verified end to end on Linux: JACK into the Rust engine, binary IPC into the WebView, with TPmax after each R128 reset reading +3.03 dBTP for Tech 3341 case 19, −0.20 for case 22 and +0.01 for a 20 ms burst at 0 dBTP.
- **Tauri True Peak** · the bar was measured in JavaScript on spliced 512-sample display snapshots, whose joins read as peaks. The meter is now fed with the Rust engine's per-sample peaks, the largest since the previous frame, and applies the same ballistics, hold and TPmax as local metering. The engine's TPmax no longer decays.
- **Intersample Peak Demo presets** · presets labelled 0 dBFS played at −18 dBFS (`parseFloat(x) || -18` discarded a level of 0). ISP Max generated alternating ±1, a tone at fs/2 whose true peak is 0 dBTP, not +3.01; it now generates +1, +1, −1, −1 (fs/4 at 45°, +3.01 dBTP). Mild and Moderate were sines started at phase zero with no inter-sample peak at all; they are now fs/8 at 67.5° and fs/6 at 60°, the Tech 3341 geometry, with truthful labels.
- **True Peak by the ITU-R BS.1770-4 Annex 2 polyphase FIR** · the meter now over-samples with the 48-tap filter tabulated in Annex 2 (four 12-tap branches) instead of Catmull-Rom interpolation, which read EBU Tech 3341 case 16 at −7.1 dBTP and case 19 at +1.9 dBTP against −6.0 and +3.0. Cases 15 to 23 now read within +0.2/−0.4 dB (`tests/true-peak-test.js`, part of `npm test`). The over-sampling ratio follows the sample rate (4× up to 48 kHz, 2× above, so the rate-relative Tech 3341 cases also pass at 96 and 192 kHz), `TruePeakDetector` carries eleven samples of history across gap-free blocks, and `TruePeakMeter({ contiguous: true })` uses it; the default window semantics match the rolling analyser feed. Removed: `hermiteInterpolate`, `OVERSAMPLE_FACTOR`, `calculateTruePeakPolyphase`, `calculateTruePeakWithMode`, `calculateTruePeakStereoWithMode` and `TRUE_PEAK_MODE.HERMITE`; `oversamplingFactor()` and `BS1770_TRUE_PEAK_COEFFICIENTS` replace them.
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
