# TSG Suite - Multi-Device Sync Guide

## 🎯 Overview

TSG Lineup now supports **frame-accurate timecode synchronization** across multiple devices using WebRTC. This enables broadcast-grade sync testing without expensive hardware.

## 🚀 Quick Start

### Method 1: QR Code Handshake (Recommended)

**Master Device (Laptop/Primary Display):**

1. Open TSG Lineup with master parameters:
   ```
   tsg-lineup.html?room=studio-a&role=master&state=sync
   ```

2. Master automatically generates QR code and displays on screen

3. Press **[Q]** to toggle QR code visibility

4. QR code contains WebRTC offer - ready to scan!

**Slave Device (iPad/Phone/Secondary Display):**

1. Open camera app and scan QR code from master

2. Camera detects data URL and opens browser

3. Paste offer data in console:
   ```javascript
   initSlave("PASTE_SCANNED_OFFER_HERE")
   ```

4. Slave generates answer QR code - press **[Q]** to show

5. Master scans slave's QR code and runs:
   ```javascript
   acceptAnswer("PASTE_SCANNED_ANSWER_HERE")
   ```

6. ✅ **Connection established!** Devices synced.

---

### Method 2: Manual Console Exchange (Fallback)

**Master Device:**

1. Open TSG Lineup with master parameters:
   ```
   tsg-lineup.html?room=studio-a&role=master&state=sync
   ```

2. Open browser console (F12 or Cmd+Option+I)

3. Master automatically initializes and displays offer data in console

4. Copy the full offer data from console

**Slave Device:**

1. Open TSG Lineup on second device:
   ```
   tsg-lineup.html?room=studio-a&state=sync
   ```

2. Open browser console

3. Initialize as slave with master's offer:
   ```javascript
   initSlave("PASTE_MASTER_OFFER_HERE")
   ```

4. Slave displays answer data in console

5. Copy the answer data

**Complete Handshake:**

1. On **master** device console, run:
   ```javascript
   acceptAnswer("PASTE_SLAVE_ANSWER_HERE")
   ```

2. ✅ **Connection established!** Devices synced.

## 📊 UI Indicators

**Top-right corner displays:**
- 🟢 MASTER / SLAVE - Connection role
- Connection status (🔴 Disconnected, 🟡 Connecting, 🟢 Connected)
- Sync offset (slaves only): `Δ 12.5ms (0.6f)`
- RTT and latency: `RTT 24.5ms → 12.3ms latency`
- Room name: `Room: studio-a`

**QR Code Overlay:**
- Press **[Q]** to show/hide QR code with WebRTC handshake data
- Full-screen overlay with scannable QR code
- Instructions for scanning with slave/master device
- Press **[Q]** again to hide and return to test pattern

## ⌨️ Keyboard Shortcuts

| Key | Action |
|-----|--------|
| **Q** | Toggle QR code overlay (show/hide sync handshake) |

## 🎛️ URL Parameters

| Parameter | Values | Description |
|-----------|--------|-------------|
| `room` | any string | Room ID (enables sync mode) |
| `role` | `master`, `auto` | Master auto-initializes, auto waits for console |
| `latency` | number (seconds) | Device-specific audio/video delay compensation |
| `state` | `sync` | Start in SYNC mode (recommended for testing) |

### Examples

**Master with 120ms iPad speaker latency compensation:**
```
?room=studio-a&role=master&state=sync&latency=-0.120
```

**Slave with 200ms Bluetooth speaker delay:**
```
?room=studio-a&latency=-0.200&state=sync
```

## 🔧 Advanced Usage

### Console Commands

```javascript
// Initialize as master (if not auto-started)
await initMaster()

// Initialize as slave
await initSlave("offer_data_from_master")

// Accept slave's answer (master only)
await acceptAnswer("answer_data_from_slave")

// Check connection state
console.log(connectionState) // 'disconnected', 'connecting', 'connected', 'failed'

// Check current sync offset (slave only)
console.log(syncOffset) // in seconds
```

### Latency Compensation

Different devices have different audio/video latency:

- **iPad speakers**: ~120ms
- **HDMI displays**: ~50-100ms
- **Bluetooth speakers**: ~150-250ms
- **USB audio interfaces**: ~10-30ms

**Negative values = compensate forward** (audio is late, move it earlier)

## 📡 How It Works

### Architecture

```
┌─────────────────────────────────────────┐
│ MASTER (First device)                   │
│ - Runs getCentralSeconds() as truth     │
│ - Broadcasts timecode every 17ms        │
│ - Sends state + countdown               │
└──────────────┬──────────────────────────┘
               │ WebRTC DataChannel
               │ (P2P, no backend)
               ▼
┌──────────────────────────────────────────┐
│ SLAVE (All other devices)                │
│ - Receives master timecode               │
│ - Calculates offset (exponential smooth) │
│ - Applies correction to getCentralSeconds│
│ - Syncs SYNC pattern timing              │
└──────────────────────────────────────────┘
```

### Sync Accuracy

- **Broadcast interval**: 17ms (~60 updates/second)
- **Network delay compensation**: RTT/2 estimation
- **Smoothing**: Exponential averaging (α = 0.1)
- **Expected accuracy**: ±1 frame (typ. <40ms)

### Offline Operation

- Uses browser-native WebRTC (no external servers)
- STUN servers only for NAT traversal
- Works on Raspberry Pi, iPad, phone, laptop
- Single self-contained HTML file

## 🎬 Use Cases

### Broadcast Engineering

- Multi-camera lip sync verification
- Audio/video offset testing across displays
- Field production sync reference
- Remote monitoring sync check

### Live Production

- Multi-screen timecode sync
- Countdown sync across control room
- Backup monitor sync verification
- Mobile device as sync reference

## 🎯 Auto-Latency Detection (v2 Feature!)

The slave automatically measures network latency using RTT (Round-Trip Time):

**How it works:**
1. Slave receives timecode packets with timestamp
2. Calculates RTT = receiveTime - sendTime
3. Keeps rolling average of last 20 samples (outliers > 200ms excluded)
4. Estimates one-way latency = RTT / 2
5. Displays in UI: `RTT 24.5ms → 12.3ms latency` (orange text)

**Benefits:**
- ✅ No manual latency measurement needed for network delay
- ✅ Automatic compensation for WiFi jitter
- ✅ Real-time feedback on connection quality
- ✅ Visual indicator of network health

**Note:** This measures NETWORK latency only. Device-specific audio/video latency (speakers, displays) still requires manual `?latency=` parameter.

**Example:**
```
Slave UI shows:
🟢 SLAVE
Δ 5.2ms (0.3f)                    ← Sync offset (corrected)
RTT 18.3ms → 9.2ms latency       ← Auto-detected network latency
Room: studio-a
```

## 🔍 Troubleshooting

### Connection fails

- Check that both devices are on same network
- Try refreshing both pages
- Check browser console for errors
- Verify STUN servers are reachable

### Sync offset too large

- Check displayed RTT - high values (>100ms) indicate poor network
- Adjust `latency` parameter for device-specific delays
- Check network stability (WiFi vs Ethernet)
- Verify both devices are in SYNC mode
- Re-establish connection

### Audio/video not synced

- Check RTT display - should be <50ms on local network
- Device latency varies by hardware (use `?latency=` for speakers/displays)
- Auto-detected network latency handles WiFi delay automatically
- Measure actual device latency with external tools if needed
- Test with known-good reference

## 🚧 Future Enhancements

- [ ] Visual QR code display (currently console-based) - Deferred to external library
- [ ] Multi-slave support (1 master, N slaves) - Requires major refactoring
- [ ] WebRTC mesh networking
- [x] ~~Automatic latency detection~~ - **IMPLEMENTED!** RTT-based network latency
- [ ] Device latency auto-detection (audio/video delay)
- [ ] Sync quality metrics visualization
- [ ] Connection recovery/reconnect

## 📚 Technical Details

**WebRTC DataChannel:**
- `ordered: false` - Allow out-of-order delivery for lower latency
- `maxRetransmits: 0` - Don't retransmit old packets

**Sync Message Format:**
```javascript
{
  type: 'TIMECODE_SYNC',
  masterTime: 1234.567,     // getCentralSeconds() from master
  state: 2,                 // STATE_SYNC
  countdown: 120.5,         // countdown value (if active)
  timestamp: 987654.321     // performance.now() for RTT calculation
}
```

**Offset Calculation:**
```javascript
networkDelay = (receiveTime - sendTime) / 2000  // RTT/2 in seconds
masterTime = received.masterTime + networkDelay + userLatency
offset = masterTime - localTime
smoothOffset += (offset - smoothOffset) * 0.1  // Exponential smoothing
```

## 🎓 Standards Compliance

- **EBU Tech 3299**: Colour bar standard maintained
- **SMPTE 12M-2**: Drop-frame timecode support
- **Rec.709**: Broadcast-safe color space
- **EBU R68**: Audio level standards (-17.7 dBFS, -14.9 dBFS, -6.4 dBFS)

---

**Generated with TSG Suite - Thåst Signal Generator**
*Broadcast-grade test signal generation in a single HTML file*
