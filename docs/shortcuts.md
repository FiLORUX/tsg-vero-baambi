# Keyboard Shortcuts

VERO-BAAMBI supports keyboard shortcuts for efficient broadcast workflow.

---

## Global Shortcuts

These shortcuts work anywhere in the application (except when focused on input fields).

| Key | Action | Notes |
|-----|--------|-------|
| `Space` | Play/Pause measurement | Toggle (tap) or momentary (hold >300ms) |
| `P` | Play/Pause measurement | Same behaviour as Space |
| `R` | Reset integrated | Resets I and LRA; visual feedback on button |
| `C` | Session capture toggle | When hotkey enabled in Session Capture panel |
| `Tab` | Toggle sidebar menu | Show/hide settings panel |
| `F` | Toggle fullscreen | Uses native Fullscreen API |

---

## Meter Selection

Switch between meter modes instantly using number keys.

| Key | Meter Mode | Description |
|-----|------------|-------------|
| `1` | True Peak | ITU-R BS.1770-4 intersample detection |
| `2` | RMS | Root mean square level display |
| `3` | Sample Peak | IEC 60268-18 / AES17 |
| `4` | Nordic PPM | IEC 60268-10 Type I |
| `5` | BBC PPM | IEC 60268-10 Type IIa |

---

## History Trace Toggles

Toggle visibility of loudness history traces.

| Key | Trace | Description |
|-----|-------|-------------|
| `S` | Short-term | 3-second integrated loudness |
| `M` | Momentary | 400ms integrated loudness |
| `I` | Integrated | Programme loudness (gated) |
| `T` | True Peak | Maximum true peak level |
| `K` | K-weighting | Frequency weighting curve overlay |

---

## Play/Pause Behaviour

The play/pause function follows EBU Tech 3341 recommendations:

**Tap (short press <300ms):**
- Toggles between play and pause states
- State persists after key release

**Hold (long press >300ms):**
- Momentary pause while held
- Automatically resumes on key release
- Useful for checking readings without losing context

This dual behaviour mirrors professional hardware implementations where momentary hold allows quick inspection without disrupting the measurement session.

---

## Tab Navigation (Accessibility)

When the meter tab bar has focus, additional navigation is available:

| Key | Action |
|-----|--------|
| `←` `→` | Navigate between tabs |
| `↑` `↓` | Navigate between tabs (alternative) |
| `Home` | Jump to first tab |
| `End` | Jump to last tab |
| `Enter` / `Space` | Activate focused tab |

---

## Input Field Shortcuts

When focused on numeric input fields:

| Key | Action |
|-----|--------|
| `Enter` | Apply value and blur field |

---

## Browser Shortcuts (Not Overridden)

These standard browser shortcuts are preserved:

| Key | Action |
|-----|--------|
| `Cmd+R` / `Ctrl+R` | Browser refresh (not intercepted) |
| `Cmd+F` / `Ctrl+F` | Browser find (not intercepted) |

---

## Future Considerations

| Key | Proposed Action | Status |
|-----|-----------------|--------|
| `Esc` | Close modal dialogs | Standard behaviour |
| `?` | Show shortcuts help | Not implemented |

---

## Implementation Reference

Keyboard handling is implemented in:
- `src/app/bootstrap.js` — Global shortcuts (R, C, Tab, F, 1-5, S/M/I/T/K, Space/P)
- `src/app/bargraph-meter.js` — Tab navigation (arrows, Home/End)

All shortcuts:
- Skip processing when focus is on `input`, `textarea`, or `select` elements
- Prevent default browser behaviour where appropriate
- Provide visual feedback on associated UI elements
