# Remote Calibration System

Technical documentation for remote probe calibration functionality.

## Overview

Remote calibration enables the VERO-BAAMBI client to calibrate a remote probe's input trim without transferring raw audio data. The calibration logic executes on the client whilst the probe remains a lightweight metrics transmitter.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (index.html)                            │
│                                                                             │
│  ┌─────────────────┐    ┌────────────────────┐    ┌──────────────────────┐ │
│  │ CalibrationEngine│◄──│ meterState (remote)│◄───│ handleRemoteMetrics()│ │
│  │                 │    └────────────────────┘    └──────────────────────┘ │
│  │  - reads LUFS-I │                                        ▲              │
│  │  - calculates Δ │                                        │              │
│  │  - sends trim   │                                        │              │
│  └────────┬────────┘                                        │              │
│           │                                                 │              │
│           ▼                                                 │              │
│  ┌─────────────────┐                                        │              │
│  │ MetricsReceiver │────────────────────────────────────────┤              │
│  │                 │                                        │              │
│  │  .sendTrim()    │──┐                                     │              │
│  └─────────────────┘  │                                     │              │
│                       │                                     │              │
└───────────────────────│─────────────────────────────────────│──────────────┘
                        │                                     │
                        ▼                                     │
              ┌─────────────────┐                             │
              │     BROKER      │                             │
              │  (server.js)    │                             │
              │                 │                             │
              │  relays setTrim │                             │
              │  relays metrics │                             │
              └────────┬────────┘                             │
                       │                                      │
                       ▼                                      │
              ┌─────────────────────────────────────────────────────────────┐
              │                        PROBE (probe.html)                   │
              │                                                             │
              │  ┌─────────────────┐    ┌─────────────────┐                 │
              │  │  ProbeSender    │    │  appState       │                 │
              │  │                 │    │                 │                 │
              │  │ #handleSetTrim()│───►│ browserTrim     │                 │
              │  │                 │    │ externalTrim    │                 │
              │  └────────┬────────┘    └────────┬────────┘                 │
              │           │                      │                          │
              │           │                      ▼                          │
              │           │             ┌─────────────────┐                 │
              │           │             │SourceController │                 │
              │           │             │  applies trim   │                 │
              │           │             └────────┬────────┘                 │
              │           │                      │                          │
              │           │                      ▼                          │
              │           │             ┌─────────────────┐                 │
              │           │             │   LUFSMeter     │                 │
              │           │             │   TruePeakMeter │                 │
              │           ▼             └────────┬────────┘                 │
              │  ┌─────────────────┐             │                          │
              │  │MetricsCollector │◄────────────┘                          │
              │  │  sends metrics  │─────────────────────────────────────►  │
              │  └─────────────────┘                          to broker     │
              └─────────────────────────────────────────────────────────────┘
```

## Data Flow

### Metrics Path (Probe → Client)

1. Probe captures audio from browser tab or external device
2. `LUFSMeter` computes momentary, short-term, and integrated loudness
3. `MetricsCollector.collect()` packages metrics with timestamp
4. `ProbeSender` transmits via WebSocket to broker
5. Broker relays to subscribed clients
6. `MetricsReceiver.onMetrics()` callback fires with parsed metrics
7. `handleRemoteMetrics()` in bootstrap.js populates `meterState`:
   - `meterState.integratedLufs` ← `metrics.lufs.integrated`
   - `meterState.shortTermLufs` ← `metrics.lufs.shortTerm`

### Trim Path (Client → Probe)

1. `CalibrationEngine` reads `meterState.integratedLufs`
2. Calculates offset: `trimDelta = targetLufs - currentLufs`
3. Calls `MetricsReceiver.sendTrim(probeId, newTrim)`
4. Broker relays `{ type: 'setTrim', trimDb, inputMode }` to probe
5. `ProbeSender.#handleSetTrim()` receives command
6. Updates `appState.browserTrim` or `appState.externalTrim` (SSOT)
7. `SourceController._handleStateChange()` applies new trim to gain node
8. Next metrics packet reflects adjusted level

## Implementation

### CalibrationEngine Extensions

The engine gains a remote mode configured via `setRemoteMode()`:

```javascript
calibrationEngine.setRemoteMode({
  enabled: true,
  probeId: 'uuid-here',
  metricsGetter: () => ({
    momentary: meterState.lufsM,      // if available
    shortTerm: meterState.shortTermLufs,
    integrated: meterState.integratedLufs,
    truePeak: Math.max(meterState.remoteTpL, meterState.remoteTpR)
  }),
  trimSender: (trimDb) => {
    remoteReceiver.sendTrim(selectedRemoteProbeId, trimDb);
  },
  getTrim: () => {
    // Remote probe's current trim (if tracked)
    return remoteReceiver.getMetrics(probeId)?.trim ?? 0;
  }
});
```

### Modified Methods

#### `getCurrentReadings()`

When remote mode is enabled, reads from `metricsGetter` instead of local meters:

```javascript
getCurrentReadings() {
  if (!this._isCalibrating) return null;

  if (this._remoteMode?.enabled) {
    const remote = this._remoteMode.metricsGetter();
    return {
      momentary: remote.momentary ?? -Infinity,
      shortTerm: remote.shortTerm ?? -Infinity,
      integrated: remote.integrated ?? -Infinity,
      offset: isFinite(remote.integrated)
        ? remote.integrated - this._config.targetLufs
        : null,
      truePeak: remote.truePeak ?? -Infinity,
      confidence: this._calculateConfidence()
    };
  }

  // Local mode (existing code)
  const readings = this._lufsMeter.getReadings();
  // ...
}
```

#### `adjustTrim()`

When remote mode is enabled, calls `trimSender` instead of local `_setTrim`:

```javascript
adjustTrim(trimDb) {
  if (!this._isCalibrating || this._mode !== 'manual') return;

  if (this._remoteMode?.enabled) {
    this._remoteMode.trimSender(trimDb);
  } else {
    this._setTrim?.(trimDb);
  }

  // Reset integration after trim change
  this._resetMeters?.();
  this._measurements = [];
  this._startTime = performance.now();
}
```

### Bootstrap Wiring

In `bootstrap.js`, when entering remote calibration:

```javascript
// When activeCapture === 'remote' and calibration starts
calibrationEngine.setRemoteMode({
  enabled: true,
  probeId: selectedRemoteProbeId,
  metricsGetter: () => ({
    momentary: parseFloat(lufsM?.dataset?.v) || -Infinity,
    shortTerm: meterState.shortTermLufs,
    integrated: meterState.integratedLufs,
    truePeak: Math.max(meterState.remoteTpL, meterState.remoteTpR)
  }),
  trimSender: (trimDb) => {
    remoteReceiver.sendTrim(selectedRemoteProbeId, trimDb);
  }
});
```

When calibration ends or switching away from remote:

```javascript
calibrationEngine.setRemoteMode({ enabled: false });
```

## Edge Cases

### Probe Disconnection During Calibration

If probe goes offline mid-calibration:
- `meterState` values freeze at last received values
- Stale detection triggers `probe.isOnline = false`
- UI should show warning and pause/cancel calibration
- `CalibrationEngine` can detect stale readings via timestamp check

### Network Latency

Remote calibration loop has inherent latency:
- Metrics transmission: ~50-100ms
- Broker relay: ~1-5ms
- Trim command: ~50-100ms
- Audio processing delay: ~20ms

Total round-trip: ~150-250ms

Convergence algorithm should:
- Wait for stable readings before adjusting
- Use larger step sizes for initial correction
- Fine-tune with smaller steps once within ±2 dB

### Trim Range Limits

Probe clamps trim to [-48, +24] dB range. If calibration requires trim outside this range, the source signal level is fundamentally wrong and hardware adjustment is required.

## Testing Checklist

### Automated Tests (test/remote-calibration-test.mjs)

Start system and run tests:
```bash
./tsg start &       # Start broker + GUI with dashboard
sleep 2
node test/remote-calibration-test.mjs
```

Or run tests directly (requires broker on port 8765):

- [x] Probe connects and registers with broker
- [x] Client subscribes to probe and receives metrics
- [x] CalibrationEngine reads remote metrics via metricsGetter
- [x] Trim commands sent via trimSender reach probe
- [x] Metrics update correctly after trim adjustment
- [x] Engine handles probe disconnect gracefully
- [x] Rapid trim adjustments all processed correctly
- [x] Extreme trim values (-48 to +24 dB) handled

### Manual Browser Tests

- [ ] Start system: `./tsg start` (shows TUI dashboard)
- [ ] Open http://localhost:3000/probe.html in browser, start capture
- [ ] Open http://localhost:3000/ (main client), connect to remote, select probe
- [ ] Start manual calibration in remote mode
- [ ] Verify LUFS-I updates in calibration UI
- [ ] Adjust trim slider, verify probe receives command
- [ ] Verify probe metrics reflect new trim
- [ ] Complete calibration, verify profile saved
- [ ] Disconnect probe mid-calibration, verify graceful handling

## Files Modified

| File | Change |
|------|--------|
| `src/calibration/calibration-engine.js` | Add `setRemoteMode()`, modify `getCurrentReadings()`, `adjustTrim()`, `_pollManualMeasurement()`, `_measureLoop()`, `_completeAutoCalibration()`, `finaliseManualCalibration()` |
| `src/app/bootstrap.js` | Wire remote mode when `activeCapture === 'remote'`, store probe info in appState, configure/disable engine remote mode |
| `src/ui/calibration-wizard.js` | Support `remoteProbeId`/`remoteProbeName` from appState for device identification |
| `test/remote-calibration-test.mjs` | Integration test for remote calibration flow |
| `docs/REMOTE-CALIBRATION.md` | This documentation |

## appState Keys

For remote calibration, two transient keys are used:
- `remoteProbeId` - Probe UUID (not persisted)
- `remoteProbeName` - Human-readable name (not persisted)

Cleared when switching away from remote mode or stopping remote capture.

---

*Last updated: 2024-12-30*
