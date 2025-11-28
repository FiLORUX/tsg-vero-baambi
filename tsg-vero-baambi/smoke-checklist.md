# VERO-BAAMBI Smoke Test Checklist

> Manual verification checklist for broadcast-grade metering functionality.
> Run through this list after each significant change to ensure no regressions.

---

## Pre-Test Setup

- [ ] Clear browser cache and localStorage
- [ ] Use Chrome/Edge (best Web Audio support) or Firefox
- [ ] Ensure audio output device is working
- [ ] Have test audio files ready (sine wave, pink noise, speech, music)

---

## 1. Application Launch

### 1.1 Legacy Version (`audio-meters-grid.html`)
- [ ] Page loads without console errors
- [ ] All meter panels render correctly
- [ ] Default theme applied (dark mode)
- [ ] Header shows "VERO-BAAMBI" branding

### 1.2 Modular Version (`index.html`)
- [ ] Loading indicator appears
- [ ] ESM modules load without errors
- [ ] App transitions from loading to ready state
- [ ] Fallback link to legacy version works

---

## 2. Audio Source Selection

### 2.1 Test Tone Generator
- [ ] 1kHz sine wave generates cleanly
- [ ] Level control affects meter reading proportionally
- [ ] Stereo/mono toggle works
- [ ] No clicks or pops on start/stop

### 2.2 Microphone Input
- [ ] Permission prompt appears
- [ ] Audio capture starts after permission granted
- [ ] Meter responds to voice input
- [ ] Input device selector shows available devices

### 2.3 External Device (USB Audio)
- [ ] External devices appear in device list
- [ ] Device selection changes audio source
- [ ] Refresh button updates device list
- [ ] Hot-plug detection works (if supported)

---

## 3. Metering Accuracy

### 3.1 EBU R128 / LUFS
- [ ] 1kHz @ -23 LUFS shows -23.0 on meter
- [ ] Pink noise @ -23 LUFS shows -23.0 ±0.5
- [ ] Integrated LUFS accumulates correctly over time
- [ ] Short-term (3s) responds to level changes
- [ ] Momentary (400ms) shows transient peaks

### 3.2 True Peak
- [ ] True Peak reads higher than sample peak (intersample peaks)
- [ ] +3 dB digital sine shows > 0 dBTP
- [ ] True Peak scale matches EBU Tech 3341

### 3.3 PPM (Nordic Standard)
- [ ] Attack time: ~5ms (fast response)
- [ ] Decay: 20dB in 1.7s
- [ ] Scale markings at TEST, +3, 0, -6, -12, -18, -24

### 3.4 Phase Correlation
- [ ] Mono signal shows +1.0 (full correlation)
- [ ] L/R phase-inverted shows -1.0
- [ ] Stereo music shows typical 0.3-0.8 range
- [ ] Correlation meter responds smoothly

---

## 4. UI Interactions

### 4.1 Grid Layout
- [ ] Meters can be collapsed/expanded
- [ ] Collapsed state persists after refresh
- [ ] Grid reflows correctly on resize
- [ ] Touch gestures work on mobile

### 4.2 Settings Panel
- [ ] Settings panel opens/closes
- [ ] Reference level adjustment works
- [ ] Theme toggle (if implemented)
- [ ] Settings persist to localStorage

### 4.3 Responsive Design
- [ ] Desktop layout (1920×1080)
- [ ] Tablet layout (768×1024)
- [ ] Mobile layout (375×812)
- [ ] Landscape/portrait transitions

---

## 5. AudioWorklet Verification

### 5.1 Processor Loading
- [ ] AudioWorklet registers without error
- [ ] Worklet path resolves correctly (check console)
- [ ] No "Failed to load processor" errors

### 5.2 Heartbeat Monitoring
- [ ] Heartbeat messages received (~10Hz)
- [ ] No message queue buildup
- [ ] Processor survives device disconnect/reconnect

### 5.3 PCM Data (if enabled)
- [ ] PCM messages contain valid Float32Array data
- [ ] Sample rate matches AudioContext
- [ ] No detached buffer errors

---

## 6. Performance

### 6.1 CPU Usage
- [ ] Idle CPU < 5% (no audio playing)
- [ ] Active CPU < 20% (metering running)
- [ ] No memory leaks over 10+ minute session

### 6.2 Animation Smoothness
- [ ] Meter needle animation at 60fps
- [ ] No jank during level changes
- [ ] CSS transitions complete smoothly

### 6.3 Audio Quality
- [ ] No glitches or dropouts
- [ ] No added latency (transparent pass-through)
- [ ] No audible artifacts

---

## 7. Error Handling

### 7.1 Permission Denied
- [ ] Graceful handling if mic permission denied
- [ ] User-friendly error message displayed
- [ ] Other features remain usable

### 7.2 Device Disconnection
- [ ] USB unplug handled gracefully
- [ ] Error state shown to user
- [ ] Recovery when device reconnected

### 7.3 Context Suspension
- [ ] AudioContext suspends on tab background
- [ ] Resumes correctly when tab focused
- [ ] No errors on resume

---

## 8. Browser Compatibility

### 8.1 Chrome/Edge (Primary)
- [ ] All features functional
- [ ] AudioWorklet supported
- [ ] No deprecation warnings

### 8.2 Firefox
- [ ] Core metering works
- [ ] AudioWorklet supported (Firefox 76+)
- [ ] Note any differences

### 8.3 Safari
- [ ] Core metering works
- [ ] AudioWorklet supported (Safari 14.1+)
- [ ] Note any WebKit-specific issues

---

## 9. LocalStorage

### 9.1 Settings Persistence
- [ ] Collapsed meter state persists
- [ ] Reference level persists
- [ ] Device selection persists (if applicable)

### 9.2 Storage Version Migration
- [ ] STORAGE_VERSION matches expected value
- [ ] Migration runs on version mismatch
- [ ] Old settings preserved or gracefully cleared

---

## 10. Future: Remote Features (Phase 3+)

> These tests apply when remote/probe features are implemented.

### 10.1 Local-Only Mode (Default)
- [ ] No network requests in local mode
- [ ] Remote indicator shows "LOCAL"
- [ ] All features work offline

### 10.2 Probe Mode (when implemented)
- [ ] Probe broadcasts metrics
- [ ] No data sent without explicit opt-in
- [ ] Graceful fallback if broker unavailable

### 10.3 Client Mode (when implemented)
- [ ] Client receives metrics from probe
- [ ] Meter displays match probe readings
- [ ] Connection status indicator works

---

## Test Sign-Off

| Tester | Date | Version | Browser | Result |
|--------|------|---------|---------|--------|
| | | | | |

### Notes

```
(Add any observations, issues, or comments here)
```

---

*TSG Suite VERO-BAAMBI – Broadcast-grade metering for professional audio*
