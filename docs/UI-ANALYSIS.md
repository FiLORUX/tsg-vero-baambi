# VERO-BAAMBI UI Architecture Analysis

Deep analysis of UI patterns, layout strategies, and remote control architecture for broadcast audio metering.

**Date:** 2025-12-31
**Status:** Analysis Complete
**Author:** Development Team

---

## Executive Summary

This document presents empirical research and architectural analysis for two UI decisions:

1. **Drag-and-Drop Panel Layout** — Should all panels be draggable?
2. **Remote Control Architecture** — How to enable settings control from a secondary device?

**Conclusions:**
- Drag-and-drop should be **removed** (not extended) — broadcast operators need predictability
- Remote control should use **existing broker infrastructure** — minimal new code, zero breaking changes

---

## Part 1: Drag-and-Drop Layout Analysis

### Current Implementation

The existing system (`src/app/drag-drop.js`, ~340 lines) provides:

| Feature | Status |
|---------|--------|
| HTML5 native drag-drop | Implemented |
| Touch support | Implemented |
| Canvas state preservation | Implemented |
| Transition animations | Implemented |

**Draggable elements:** Only 2 of ~10 panels
- `#spatialMeter` — XY/Goniometer
- `#loudnessMeter` — LUFS Radar

**Non-draggable elements:**
- Sidebar cards (Input Sources, Metering Settings, Status)
- Meter switcher (TP/RMS/Nordic/BBC)
- R128 value panel
- Stereo correlation widget
- Loudness history strip

### Industry Research

#### Professional Audio Metering Software (2024)

| Product | Layout Approach | Drag-Drop |
|---------|----------------|-----------|
| SSL Meter Pro | Fixed, resizable 50-200% | No |
| NUGEN VisLM | Fixed, resizable | No |
| RME DigiCheck NG | Modular, 1-4 panes | Yes |
| Evergreen Meter Bridge | Fully customisable | Yes |
| IK Metering | Fixed presets | No |

**Pattern observed:** High-end *mastering/post* tools offer customisation. *Broadcast monitoring* tools use fixed layouts — operators should not configure during live transmission.

#### Cognitive Load Research

From Nielsen Norman Group research on drag-drop UX:

> "You need clear evidence that users expect drag-and-drop... there is no reasonable alternative with lower interaction cost."

Key findings from UX research:

1. **Extraneous cognitive load** increases when users must configure instead of work
2. **Muscle memory** is disrupted when element positions change
3. **Inconsistent interaction patterns** (some draggable, some not) create confusion
4. Broadcast operators value **predictability over flexibility**

### Use Case Analysis

#### Broadcast/Live Monitoring (Primary Use Case)
- Operator observes, rarely interacts during transmission
- Meters must be readable at distance (1-3 metres)
- Panic scenario: Must know exactly where each meter is
- Shift handover: Next operator expects identical layout

#### Studio/Post-Production (Secondary Use Case)
- Single user, consistent daily setup
- Time to configure between sessions
- Personal optimisation valued

**Conclusion:** VERO-BAAMBI's primary audience is broadcast → fixed layout is correct.

### Recommendation: Remove Drag-and-Drop

**Arguments against extending drag-drop:**

1. **Cognitive load:** Every draggable element is potential misconfiguration
2. **Consistency violation:** 2 draggable + 8 fixed = confusing UX
3. **Broadcast reality:** Operators want predictability, not flexibility
4. **Development cost:** ~40-60h for robust implementation
5. **Maintenance burden:** More edge cases, more bug reports

**Arguments for removal:**

1. **Code simplification:** -340 lines of complex event handling
2. **Consistent UX:** All panels behave identically
3. **Reduced testing surface:** No drag-drop edge cases
4. **Performance:** No drag event listeners, no layout freeze logic

### Alternative: Layout Presets

If flexibility is desired without drag-drop:

```
[Standard] [Compact] [Loudness Focus] [Custom ▼]
```

- 3-4 predefined layouts
- "Custom" opens modal for panel visibility selection
- Stored in localStorage
- Zero drag-drop, maximum control

---

## Part 2: Remote Control Architecture

### Requirements

Enable settings control from secondary device (laptop/tablet) while primary device (NUC) runs headless metering.

```
┌─────────────────┐         ┌─────────────────┐
│  NUC (Primary)  │◄───────►│ Laptop (Control)│
│  - Metering     │   LAN   │  - Settings UI  │
│  - Audio I/O    │         │  - Calibration  │
│  - probe.html   │         │  - control.html │
└─────────────────┘         └─────────────────┘
```

### Existing Infrastructure

VERO-BAAMBI already has:

| Component | Purpose | Status |
|-----------|---------|--------|
| `broker/server.js` | WebSocket hub for probe→client metrics | Production |
| `broker/rest-api.js` | HTTP endpoints for status polling | Production |
| `src/app/state.js` | Centralised state with persistence | Production |
| `probe.html` | Headless metering page | Production |

**Gap:** Settings changes do not propagate over network.

### Industry Precedent

| Solution | Architecture | Server Required |
|----------|--------------|-----------------|
| OBS WebSocket | WebSocket API in host | Plugin only |
| REAPER Web Interface | Built-in HTTP server | Built-in |
| TouchDAW | RTP-MIDI over WiFi | Initial config |

### Proposed Architecture

Extend existing broker with control commands:

```
┌─────────────────────────────────────────────────────┐
│                    NUC (Headless)                   │
│  ┌─────────────┐    ┌─────────────┐                 │
│  │ probe.html  │───►│   Broker    │◄─── REST API    │
│  │ (Chromium)  │    │ (Node.js)   │     :8766       │
│  └─────────────┘    └─────────────┘                 │
│         │                  │                        │
│         │ WS :8765         │ WS :8765               │
│         ▼                  ▼                        │
└─────────────────────────────────────────────────────┘
                             │
                             │ LAN
                             ▼
              ┌─────────────────────────────────────┐
              │       Laptop (Controller)           │
              │  ┌───────────────────────────────┐  │
              │  │        control.html           │  │
              │  │   - Settings panel            │  │
              │  │   - Calibration UI            │  │
              │  │   - Read-only meters          │  │
              │  └───────────────────────────────┘  │
              └─────────────────────────────────────┘
```

### Message Protocol

```javascript
// Controller → Broker → Probe
{ type: 'control', probeId: 'x', command: 'setTrim', value: -2.5 }
{ type: 'control', probeId: 'x', command: 'setTarget', value: -23 }
{ type: 'control', probeId: 'x', command: 'calibrate', method: 'auto' }
{ type: 'control', probeId: 'x', command: 'resetIntegration' }

// Probe → Broker → Controller (acknowledgement)
{ type: 'controlAck', probeId: 'x', command: 'setTrim', value: -2.5, success: true }
```

### Implementation Estimate

| Component | Effort |
|-----------|--------|
| Broker control message handler | 2h |
| Probe control command listener | 2h |
| control.html with settings UI | 8h |
| Testing and debugging | 4h |
| **Total** | **16h** |

### Alternatives Considered

#### WebRTC Peer-to-Peer
- **Pro:** No server required
- **Con:** Complex signaling, NAT issues
- **Verdict:** Rejected — WebSocket simpler

#### mDNS Auto-discovery
- **Pro:** Zero-configuration
- **Con:** Not reliable on enterprise networks
- **Verdict:** Optional future enhancement

---

## Decision Matrix

| Option | Complexity | Breaks Existing | Recommended |
|--------|------------|-----------------|-------------|
| Extend drag-drop to all panels | High | Yes (UX) | No |
| Remove drag-drop entirely | Low | No | **Yes** |
| Extend broker for control | Low-Medium | No | **Yes** |
| WebRTC peer-to-peer | High | No | No |

---

## References

- Nielsen Norman Group: Drag-Drop UX Best Practices
- Cognitive Load Theory in UI Design (Aufait UX)
- RME DigiCheck NG Documentation
- NUGEN VisLM Product Documentation
- OBS WebSocket Protocol Specification
- REAPER Web Interface Documentation
- UX Collective: Drag-and-Drop for Design Systems

---

## Related Documents

- [PROJECT-A-DRAG-DROP-REMOVAL.md](./PROJECT-A-DRAG-DROP-REMOVAL.md) — Implementation plan for drag-drop removal
- [PROJECT-B-REMOTE-CONTROL.md](./PROJECT-B-REMOTE-CONTROL.md) — Implementation plan for remote control feature
