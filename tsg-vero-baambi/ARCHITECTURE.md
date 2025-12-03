# Architecture

This document describes the design principles and architectural decisions behind VERO-BAAMBI.

---

## Design Philosophy

### Local-First, Zero-Dependency

VERO-BAAMBI is built on the principle that **local operation is the primary mode**, not a fallback. This manifests in several ways:

1. **No npm dependencies** — The entire application runs from static files with no build step required.

2. **No CDN imports** — All code ships with the repository. Network availability is never assumed.

3. **Works offline** — Full functionality without network access, including from `file://` protocol.

4. **No analytics or telemetry** — Audio data never leaves the device.

This approach was chosen because broadcast environments often have:
- Air-gapped networks
- Strict security policies prohibiting external dependencies
- Requirements for predictable, auditable behaviour
- Need for rapid deployment without toolchain setup

### Separation of Concerns

The codebase is organised into distinct layers:

```
┌─────────────────────────────────────────────────────────────────┐
│                          index.html                              │
│                      (DOM structure only)                        │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                         src/app/                                 │
│              Application Integration Layer                       │
│    bootstrap.js · state.js · sources.js · render-loop.js        │
└─────────────────────────────────────────────────────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
┌─────────────────────┐ ┌─────────────────┐ ┌─────────────────────┐
│    src/metering/    │ │    src/ui/      │ │  src/generators/    │
│   DSP Algorithms    │ │   Rendering     │ │  Signal Sources     │
│   (pure functions)  │ │   (Canvas)      │ │  (Web Audio)        │
└─────────────────────┘ └─────────────────┘ └─────────────────────┘
              │                  │                  │
              └──────────────────┼──────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                        src/utils/                                │
│              Pure Utilities (math, format)                       │
└─────────────────────────────────────────────────────────────────┘
```

**Key principle**: Lower layers have no knowledge of higher layers. Metering algorithms don't know about UI. UI components don't know about application state management.

---

## Module Architecture

### Application Layer (`src/app/`)

| Module | Responsibility |
|--------|----------------|
| `bootstrap.js` | DOM wiring, AudioContext setup, initialisation sequence |
| `state.js` | Centralised application state with localStorage persistence |
| `sources.js` | Audio input management (browser capture, external devices, generators) |
| `render-loop.js` | 60 Hz visual rendering via requestAnimationFrame |
| `measure-loop.js` | 20 Hz measurement updates (LUFS integration) |
| `meter-state.js` | Shared state between render and measure loops |

**Initialisation Order** (critical for correctness):

```javascript
// 1. Create AudioContext
const ac = new AudioContext({ sampleRate: 48000 });

// 2. Create metering instances (pure DSP)
const lufsMeter = new LUFSMeter({ sampleRate: ac.sampleRate });

// 3. Create UI components (DOM references required)
const goniometer = new Goniometer(canvas);

// 4. Initialise loops with dependencies
initRenderLoop({ dom, meters, uiComponents, ... });

// 5. Start loops
startRenderLoop();
startMeasureLoop();
```

### Metering Layer (`src/metering/`)

Pure DSP implementations with no DOM or Web Audio dependencies.

| Module | Standard | Description |
|--------|----------|-------------|
| `lufs.js` | EBU R128 / ITU-R BS.1770-4 | K-weighted loudness measurement |
| `true-peak.js` | ITU-R BS.1770-4 | 4× oversampled intersample peak detection |
| `ppm.js` | IEC 60268-10 Type I | Nordic PPM with correct attack/decay ballistics |
| `correlation.js` | — | Phase correlation, stereo width, balance |

**Design decision**: These modules accept `Float32Array` sample buffers and return numerical values. They have no side effects and can be tested in isolation.

### UI Layer (`src/ui/`)

Canvas-based rendering components.

| Module | Description |
|--------|-------------|
| `goniometer.js` | Stereo vectorscope (Lissajous figure) |
| `radar.js` | Loudness history with polar sweep |
| `spectrum.js` | 1/3-octave analyser (RTW/TC style) |
| `bar-meter.js` | LED-style bar meters |
| `correlation-meter.js` | Phase correlation display |

**Design decision**: UI components are instantiated with a canvas element and expose a `draw()` method. They don't manage their own animation loop — the application layer coordinates all rendering.

### Generator Layer (`src/generators/`)

Signal generators for alignment and testing.

| Module | Signals |
|--------|---------|
| `oscillators.js` | Sine, sweep, GLITS (EBU Tech 3304) |
| `noise.js` | Pink, white, brown (spectrally correct) |
| `lissajous.js` | Stereo test patterns |
| `thast-vector-text.js` | Vector text for goniometer branding |

---

## Data Flow

### Audio Signal Path

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│   Source    │──▶│  TrimGain   │──▶│  Splitter   │
│ (capture/   │   │ (input dB)  │   │   (L/R)     │
│  generator) │   └─────────────┘   └──────┬──────┘
└─────────────┘                            │
                                    ┌──────┴──────┐
                                    ▼             ▼
                              ┌─────────┐   ┌─────────┐
                              │ mixL    │   │ mixR    │
                              │ (GainNode)  │ (GainNode)
                              └────┬────┘   └────┬────┘
                                   │             │
                              ┌────┴────┐   ┌────┴────┐
                              │analyserL│   │analyserR│
                              └────┬────┘   └────┴────┘
                                   │             │
                                   └──────┬──────┘
                                          ▼
                                   ┌─────────────┐
                                   │   bufL/R    │
                                   │(Float32Array)│
                                   └──────┬──────┘
                                          │
              ┌───────────────────────────┼───────────────────────────┐
              ▼                           ▼                           ▼
       ┌─────────────┐            ┌─────────────┐            ┌─────────────┐
       │ LUFSMeter   │            │ Goniometer  │            │ Spectrum    │
       │ (20 Hz)     │            │ (60 Hz)     │            │ (60 Hz)     │
       └─────────────┘            └─────────────┘            └─────────────┘
```

**Key insight**: Buffers are sampled once per frame and shared across all consumers. This ensures all meters see identical data and prevents timing skew between L/R channels.

### Measurement vs Render Loop

| Loop | Frequency | Purpose |
|------|-----------|---------|
| Measure | 20 Hz | LUFS integration, LRA calculation, threshold gating |
| Render | 60 Hz | Visual updates (canvas drawing, DOM text) |

**Rationale**: LUFS integration requires precise 400 ms windows. Running at display refresh rate would waste CPU. Conversely, visual meters need 60 fps for smooth ballistics animation.

---

## State Management

### Application State (`src/app/state.js`)

Centralised state store with localStorage persistence:

```javascript
const appState = new StateStore('tsg-vero', {
  targetLufs: -23,
  truePeakLimit: -1,
  // ...
});

// Read
const target = appState.get('targetLufs');

// Write (automatically persists)
appState.set({ targetLufs: -24 });
```

**Design decision**: State changes are synchronous and immediately persisted. No pub/sub or reactive bindings — the application explicitly reads state when needed.

### Meter State (`src/app/meter-state.js`)

Shared mutable state for inter-loop communication:

```javascript
export const meterState = {
  radarHistory: [],
  tpPeakHoldL: -Infinity,
  lastRenderTime: 0,
  // ...
};
```

**Design decision**: This is intentionally mutable global state. The alternative (message passing between loops) would add complexity without benefit, since both loops run on the main thread.

---

## Error Handling

### AudioContext Errors

```javascript
try {
  ac = new AudioContext({ sampleRate: 48000 });
} catch (e) {
  // Show user-friendly error, halt initialisation
}
```

### Graceful Degradation

- If a canvas element is missing, the corresponding UI component is not instantiated
- If `getDisplayMedia` fails, error is displayed but other sources remain available
- Malformed audio data results in `--.-` display rather than NaN or Infinity

---

## Performance Considerations

### Frame Budget

At 60 fps, each frame has ~16.6 ms. Budget allocation:

| Task | Budget |
|------|--------|
| Buffer sampling | < 1 ms |
| Metering calculations | < 2 ms |
| Canvas rendering | < 8 ms |
| DOM updates | < 2 ms |
| Margin | 3 ms |

### Optimisations

1. **Pre-computed bin mapping** — Spectrum analyser computes FFT bin ranges once when sample rate changes

2. **Typed arrays** — All audio buffers are `Float32Array` for cache-friendly iteration

3. **Canvas state batching** — Fill style changes are minimised within draw loops

4. **Conditional rendering** — Components check visibility before expensive operations

---

## Remote Architecture

The remote metering module enables distributed audio monitoring across network:

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   Probe     │────────▶│   Broker    │◀────────│   Client    │
│ (probe.html │ WebSocket│ (broker/   │ WebSocket│ (index.html │
│  captures   │  10 Hz   │  server.js)│  10 Hz   │  displays   │
│  & meters)  │  metrics │  relays    │  metrics │  metrics)   │
└─────────────┘         └─────────────┘         └─────────────┘
```

### Module Structure (`src/remote/`)

| Module | Responsibility |
|--------|----------------|
| `types.js` | `RemoteMetrics` schema — LUFS M/S/I, True Peak, PPM, stereo values |
| `transport/websocket-client.js` | Auto-reconnecting WebSocket with exponential backoff |
| `probe/probe-sender.js` | Collects metrics at 10 Hz, streams to broker |
| `probe/metrics-collector.js` | Gathers values from metering instances |
| `client/metrics-receiver.js` | Receives metrics, manages probe subscriptions |
| `ui/remote-panel.js` | Toggle controls, probe list, status display |

### Data Flow

```
Probe (source machine):
  AudioContext → LUFSMeter/PPMMeter/etc → MetricsCollector → ProbeSender → WebSocket

Broker (relay server):
  WebSocket ← Probe metrics
  WebSocket → Client metrics (broadcast to subscribers)

Client (display machine):
  WebSocket → MetricsReceiver → UI update callbacks → DOM/Canvas
```

### Key Design Decisions

1. **Metrics only, never audio** — Only numerical values transmitted (~200 bytes/message)
2. **10 Hz update rate** — Balances responsiveness with bandwidth
3. **Message queuing** — Buffers during disconnection, flushes on reconnect
4. **Heartbeat** — 5-second interval for connection health monitoring
5. **Probe ID** — UUID + user-editable name for multi-probe environments

**Key constraint**: Remote features are opt-in and have zero impact on local-mode functionality.

---

## Testing Strategy

### Unit Tests (`tests/metering-verification.js`)

Synthetic signal tests against metering algorithms:

- 1 kHz sine at -18 dBFS should read -18.0 LUFS (±0.1 dB)
- Full-scale sine should read 0.0 dBTP (±0.1 dB)
- Known intersample peak should be detected

### Manual Testing (`smoke-checklist.md`)

Browser-based verification with real audio sources.

### CI (`github/workflows/ci.yml`)

Automated syntax checking, linting, and unit tests on push.

---

*Built with the assumption that behaviour should be predictable, output should be verifiable, and silence should mean silence.*
