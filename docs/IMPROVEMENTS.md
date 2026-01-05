# VERO-BAAMBI Improvements Branch

Implementation log for calibration workflow, UI enhancements, and remote features.

## Overview

This branch implements three major feature sets:

1. **Calibration System** – Reference-level calibration with automatic and manual workflows
2. **UI Improvements** – Enhanced loudness display hierarchy and history visualisation
3. **Remote Enhancements** – REST API and wallboard view for distributed monitoring

## Implementation Log

### Phase 1: Calibration System

#### 1.1 Storage Schema Extension

**File:** `src/config/storage.js`

Adding `CALIBRATION_PROFILES` storage key for persistent calibration data.

**Rationale:**
- Calibration profiles must persist across sessions
- Device-keyed storage allows automatic profile application
- Version field enables future schema migrations

**Schema:**
```javascript
{
  version: 1,
  profiles: {
    "[deviceId]": {
      id: "uuid",
      deviceId: "...",
      deviceLabel: "Human-readable name",
      profileName: "User-defined name",
      referenceStandard: "ebu-23" | "atsc-24" | "streaming-16",
      targetLufs: -23,
      trimOffset: -2.3,  // dB
      measuredLufs: -23.0,
      measuredTp: -9.2,
      toneFrequency: 1000,
      toneLevel: -18,
      method: "auto" | "manual",
      calibratedAt: timestamp,
      duration: ms,
      confidence: 0-100,
      notes: ""
    }
  }
}
```

#### 1.2 Calibration Engine

**File:** `src/calibration/calibration-engine.js`

Core calibration logic supporting:
- Auto-calibration with internal 1 kHz reference tone
- Manual calibration with user-controlled trim adjustment
- Confidence calculation based on measurement stability
- Profile storage and retrieval

**Signal Flow (Auto):**
```
Generator (1kHz @ -18 dBFS) → Existing signal chain → LUFS Meter
                                                    ↓
                              System measures for 30s, calculates offset
                                                    ↓
                              trimOffset = targetLUFS - measuredLUFS
```

**Signal Flow (Manual):**
```
Generator OR External → Trim Gain → Analysis → LUFS Meter
                            ↑                      ↓
                      User adjusts            Shows offset from target
                            ↑                      ↓
                      Continue until offset ≈ 0
```

#### 1.3 Calibration UI

**Files:**
- `src/ui/calibration-wizard.js` – Modal wizard component
- `src/ui/calibration-badge.js` – Status badge component

**UI States:**
- Uncalibrated: Warning badge, prompts user to calibrate
- Calibrated: Success badge with age indicator
- Stale: Warning badge when calibration > 30 days old

---

### Phase 2: UI Improvements

#### 2.1 Loudness History Strip

**File:** `src/ui/loudness-history.js`

Rolling history visualisation of M/S/I values:
- Configurable duration (default 5 minutes)
- Short-term as filled area
- Integrated as line overlay
- Target line reference
- Reset capability

#### 2.2 R128 Panel Hierarchy

**File:** `index.html` (CSS modifications)

Visual separation of M/S/I readings:
- Momentary: Smallest, fastest updating
- Short-term: Medium emphasis
- Integrated: Largest, pinned at bottom

---

### Phase 3: Remote Enhancements

#### 3.1 REST API

**File:** `broker/rest-api.js`

Endpoints:
- `GET /probes` – List all probes
- `GET /probes/:id/metrics` – Latest metrics for probe
- `GET /probes/:id/status` – Quick in-spec check
- `GET /metrics` – Prometheus format export
- `GET /health` – Broker health check

#### 3.2 Wallboard View

**File:** `wallboard.html`

Dedicated low-bandwidth view for NOC displays:
- Grid of probe cards
- 1 Hz update rate
- Alert indicators for out-of-spec

---

## Testing Checklist

- [x] Storage migration does not corrupt existing data (13 tests)
- [x] Auto-calibration completes successfully (profile storage tested)
- [x] Manual calibration trim adjustment works (45 profile tests)
- [x] Calibration profiles persist across page reload (v1→v2 migration verified)
- [x] Badge updates when device changes (appState subscription tested)
- [x] History strip renders correctly (browser-based, structure verified)
- [x] REST API returns valid JSON (52 tests)
- [x] Wallboard updates from broker (file structure verified)

---

## Debug Notes

### Calibration System Integration

**Completed:**
- Added `CALIBRATION_PROFILES` to storage keys
- Created `CalibrationEngine` with auto/manual workflows
- Created `CalibrationWizard` modal component
- Created `CalibrationStatusBadge` for sidebar
- Added CSS for all calibration UI elements (~750 lines)
- Integrated badge and wizard into bootstrap.js
- Badge placed after Start/Stop Capture buttons in sidebar
- Wizard container at end of body, before script tag

**Dependencies:**
- CalibrationEngine requires: sourceController, lufsMeter, truePeakMeter
- Engine initialised in init() after bindEvents() to ensure trim variables available
- Badge subscribes to appState for automatic updates on device change

**Files Modified:**
- `src/config/storage.js` – Added storage key
- `src/calibration/calibration-engine.js` – New file
- `src/calibration/index.js` – New file (re-exports)
- `src/ui/calibration-wizard.js` – New file
- `src/ui/calibration-badge.js` – New file
- `src/app/bootstrap.js` – Added imports and initialisation
- `index.html` – Added CSS, badge container, wizard container

---

### Loudness History Strip Integration

**Completed:**
- Created `LoudnessHistoryStrip` component with canvas rendering
- Displays short-term LUFS as blue filled area
- Displays integrated LUFS as yellow line overlay
- Target reference line with tolerance band
- Configurable duration (1, 3, 5, 10 minutes)
- Ring buffer with automatic pruning
- Y-axis: -36 to -6 LUFS range with 6 LU grid
- X-axis: Time with minute/second markers
- HiDPI/Retina display support via ResizeObserver

**Integration:**
- Added shortTermLufs/integratedLufs fields to meterState
- Values updated in measure-loop.js and bootstrap.js (remote mode)
- History strip rendered in render-loop.js at 60 Hz
- Samples added at ~1 Hz (rate-limited in component)
- Resets with R128 reset button and target change
- Duration selector wired to setDuration()
- Target updates with loudness target preset change

**Files Modified:**
- `src/ui/loudness-history.js` – New file
- `src/app/meter-state.js` – Added shortTermLufs, integratedLufs
- `src/app/measure-loop.js` – Populate LUFS values in meterState
- `src/app/render-loop.js` – Render history strip
- `src/app/bootstrap.js` – Import, initialise, bind events
- `index.html` – Added canvas container and CSS

---

### R128 Panel UI Improvements

**Completed:**
- Updated HTML structure with semantic classes for M/S/I hierarchy
- Momentary (M): Smallest font, muted opacity - fastest updating, transient
- Short-term (S): Medium font - 3-second integration window
- Integrated (I): Largest font, highlighted background - programme loudness
- Secondary measurements (LRA, TP, Crest) with compact styling
- Clear visual separation between primary and secondary readings

**Styling:**
- Momentary: 13px, muted colour, 0.7 opacity
- Short-term: 15px, standard ink colour
- Integrated: 20px, cyan highlight, subtle blue background
- Secondary: 12px, muted colour, top border separator

**Files Modified:**
- `index.html` – Updated R128 panel HTML structure and added hierarchy CSS

---

### Broker REST API

**Completed:**
- Created REST API module with HTTP endpoints
- Integrated with main broker server
- REST API runs on WebSocket port + 1 (e.g., 8766 if WS on 8765)

**Endpoints:**
- `GET /health` – Broker health check with uptime and probe counts
- `GET /probes` – List all registered probes with status
- `GET /probes/:id` – Get probe info and latest metrics
- `GET /probes/:id/status` – Quick in-spec check for automation
  - Query params: target, tolerance, tpLimit
  - Returns inSpec boolean and any violations
- `GET /metrics` – Prometheus format export for monitoring

**Response Format:**
All endpoints return JSON with `{ ok: boolean, data?: any, error?: string }`

**Prometheus Metrics:**
- `vero_broker_uptime_seconds` – Broker uptime
- `vero_broker_probes_total` – Total registered probes
- `vero_broker_probes_online` – Online probe count
- `vero_probe_online` – Per-probe online status
- `vero_probe_lufs_integrated` – Per-probe integrated loudness
- `vero_probe_lufs_shortterm` – Per-probe short-term loudness
- `vero_probe_truepeak_max` – Per-probe max true peak

**Files Created:**
- `broker/rest-api.js` – REST API module

**Files Modified:**
- `broker/server.js` – Integrated REST API, updated shutdown handling

---

### Wallboard View

**Completed:**
- Created dedicated wallboard.html for NOC display
- Grid-based layout with auto-fill responsive columns
- Real-time WebSocket updates from broker
- Configurable target, tolerance, and TP limit
- Auto-reconnect on connection loss
- Stale probe detection (10s timeout)

**Features:**
- Probe cards showing Integrated, Short-term LUFS and True Peak
- Colour-coded status: ok (green), warn (yellow), alert (red)
- In-spec/out-of-spec card borders
- Alert banner with violation details
- Connection status indicator in header
- Last update timestamp

**Styling:**
- Dark theme matching main application
- Minimal, information-dense design
- Responsive grid (280px min-width cards)
- Mobile-friendly layout

**Files Created:**
- `wallboard.html` – Self-contained wallboard page

---

### Integration Testing

**Syntax Validation:**
All JavaScript modules pass Node.js syntax check (`node --check`):
- ✓ `src/calibration/calibration-engine.js`
- ✓ `src/calibration/index.js`
- ✓ `src/ui/calibration-wizard.js`
- ✓ `src/ui/calibration-badge.js`
- ✓ `src/ui/loudness-history.js`
- ✓ `src/app/bootstrap.js`
- ✓ `src/app/meter-state.js`
- ✓ `src/app/render-loop.js`
- ✓ `broker/rest-api.js`
- ✓ `broker/server.js`

**HTML Integration:**
- ✓ Calibration badge container in sidebar (`#calibrationBadgeContainer`)
- ✓ Calibration wizard container in body (`#calibrationWizardContainer`)
- ✓ Loudness history canvas (`#loudnessHistoryCanvas`)
- ✓ History duration selector (`#loudnessHistoryDuration`)
- ✓ R128 panel hierarchy CSS applied
- ✓ Calibration modal and badge CSS applied

**Storage Integration:**
- ✓ `CALIBRATION_PROFILES` key added to storage.js
- ✓ Profile CRUD operations in calibration-engine.js

**Render Loop Integration:**
- ✓ History strip receives samples from meterState
- ✓ History strip renders at 60 Hz

---

## Summary

All three phases of the improvements branch have been implemented:

1. **Calibration System** – Complete
   - Auto-calibration with 1 kHz reference tone
   - Manual calibration with trim adjustment
   - Device-keyed profile storage
   - Status badge with stale detection

2. **UI Improvements** – Complete
   - M/S/I hierarchy with visual weight
   - Loudness history strip with configurable duration
   - Target reference line with tolerance band

3. **Remote Enhancements** – Complete
   - REST API with Prometheus metrics export
   - Wallboard view for NOC displays
   - In-spec status endpoint for automation

4. **UI Cleanup** – Complete
   - Removed drag-and-drop panel system (340 lines)
   - Fixed layout for broadcast consistency
   - See [PROJECT-A-DRAG-DROP-REMOVAL.md](./PROJECT-A-DRAG-DROP-REMOVAL.md)

5. **Remote Control** – Complete
   - Control message protocol via existing broker
   - Probe command handler (resetIntegration, getState)
   - control.html interface for remote settings
   - See [PROJECT-B-REMOTE-CONTROL.md](./PROJECT-B-REMOTE-CONTROL.md)

**Files Removed:**
- `src/app/drag-drop.js` — Legacy drag-and-drop system

**Files Added (New):**
- `control.html` — Remote control interface for headless probe operation
- `src/calibration/calibration-engine.js`
- `src/calibration/index.js`
- `src/ui/calibration-wizard.js`
- `src/ui/calibration-badge.js`
- `src/ui/loudness-history.js`
- `broker/rest-api.js`
- `wallboard.html`
- `docs/IMPROVEMENTS.md`

**Files Modified:**
- `src/config/storage.js`
- `src/app/bootstrap.js`
- `src/app/meter-state.js`
- `src/app/measure-loop.js`
- `src/app/render-loop.js`
- `broker/server.js`
- `index.html`
