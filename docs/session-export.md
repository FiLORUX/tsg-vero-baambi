# Session Export

Export accumulated loudness measurements in EBU R128-compliant formats.

---

## Overview

VERO-BAAMBI continuously accumulates loudness data from the moment measurement begins. The session export module provides two standards-compliant output formats:

| Format | Standard | Use Case |
|--------|----------|----------|
| JSON | EBU R128 terminology | Internal QC, archiving, automation |
| XML | ITU-R BS.2076 (ADM) | Regulatory delivery, broadcast QC systems |

---

## Session Duration

Unlike radar history (limited to 30–600 seconds), session export uses **continuously accumulated data**:

| Parameter | Data Source | Duration |
|-----------|-------------|----------|
| Integrated (I) | LUFS meter | Entire session |
| Loudness Range (LRA) | LUFS meter | Entire session |
| True Peak Max | meterState | Entire session |
| Session duration | meterState | Wall-clock time |

**Session length is unlimited.** A 4-hour broadcast will produce a complete report.

---

## Exported Parameters

### Loudness (EBU R128 / ITU-R BS.1770-4)

| Parameter | Unit | Description |
|-----------|------|-------------|
| `integrated` | LUFS | Gated programme loudness |
| `range` | LU | Loudness Range (EBU Tech 3342) |
| `target` | LUFS | Target loudness (default: −23) |
| `deviation` | LU | Difference from target |

### True Peak (ITU-R BS.1770-4)

| Parameter | Unit | Description |
|-----------|------|-------------|
| `max` | dBTP | Maximum True Peak (both channels) |
| `maxLeft` | dBTP | Maximum True Peak (left channel) |
| `maxRight` | dBTP | Maximum True Peak (right channel) |

### Session Metadata

| Parameter | Format | Description |
|-----------|--------|-------------|
| `start` | ISO 8601 | Session start time |
| `end` | ISO 8601 | Session end time |
| `duration` | HH:MM:SS | Active duration |
| `pausedSeconds` | seconds | Total paused time |

---

## JSON Format

### Example Output

```json
{
  "format": "EBU R128 Session Report",
  "version": "1.0",
  "generated": "2026-01-04T14:30:00.000Z",
  "generator": "TSG VERO-BAAMBI",

  "session": {
    "start": "2026-01-04T12:00:00.000Z",
    "end": "2026-01-04T14:30:00.000Z",
    "duration": "2:30:00",
    "durationSeconds": 9000,
    "pausedSeconds": 120
  },

  "loudness": {
    "integrated": -23.1,
    "integratedUnit": "LUFS",
    "range": 8.2,
    "rangeUnit": "LU",
    "target": -23,
    "targetUnit": "LUFS",
    "deviation": -0.1,
    "deviationUnit": "LU"
  },

  "truePeak": {
    "max": -1.5,
    "maxLeft": -1.5,
    "maxRight": -2.1,
    "unit": "dBTP"
  },

  "compliance": {
    "integratedWithinTolerance": true,
    "truePeakBelowLimit": true,
    "toleranceUsed": "±1.0 LU",
    "truePeakLimit": "-1.0 dBTP"
  },

  "reference": {
    "standard": "EBU R128",
    "meteringSpec": "EBU Tech 3341",
    "loudnessRange": "EBU Tech 3342",
    "truePeak": "ITU-R BS.1770-4",
    "gating": "ITU-R BS.1770-4 §5"
  }
}
```

### Compliance Flags

The `compliance` section provides quick pass/fail indicators:

| Flag | Condition | EBU R128 Requirement |
|------|-----------|----------------------|
| `integratedWithinTolerance` | \|I − target\| ≤ 1.0 LU | Programme loudness ±1 LU |
| `truePeakBelowLimit` | TP ≤ −1.0 dBTP | Maximum permitted level |

---

## XML Format (ADM)

### Standards Compliance

The XML export follows:

- **ITU-R BS.2076** — Audio Definition Model
- **EBU Tech 3364** — ADM Metadata Specification
- **EBU Tech 3293** — EBUCore Metadata Set

### Example Output

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ebuCoreMain xmlns="urn:ebu:metadata-schema:ebucore"
             xmlns:adm="urn:ebu:metadata-schema:adm">

  <coreMetadata>
    <title>VERO-BAAMBI Loudness Report</title>
    <creator>TSG VERO-BAAMBI</creator>
    <date>
      <created>2026-01-04T12:00:00.000Z</created>
      <modified>2026-01-04T14:30:00.000Z</modified>
    </date>
    <duration>PT2H30M0S</duration>

    <format>
      <audioFormat>
        <adm:audioFormatExtended>

          <adm:audioProgramme audioProgrammeID="APR_1001"
                              audioProgrammeName="VERO-BAAMBI Session"
                              start="PT0S"
                              end="PT2H30M0S">

            <adm:loudnessMetadata loudnessMethod="ITU-R BS.1770"
                                  loudnessRecType="EBU R128"
                                  loudnessCorrectionType="file">
              <adm:integratedLoudness>-23.1</adm:integratedLoudness>
              <adm:loudnessRange>8.2</adm:loudnessRange>
              <adm:maxTruePeak>-1.5</adm:maxTruePeak>
              <adm:maxMomentary>-18.2</adm:maxMomentary>
              <adm:maxShortTerm>-20.1</adm:maxShortTerm>
            </adm:loudnessMetadata>

          </adm:audioProgramme>

        </adm:audioFormatExtended>
      </audioFormat>
    </format>

  </coreMetadata>

</ebuCoreMain>
```

### loudnessMetadata Attributes

| Attribute | Value | Description |
|-----------|-------|-------------|
| `loudnessMethod` | `ITU-R BS.1770` | Measurement algorithm |
| `loudnessRecType` | `EBU R128` | Target recommendation |
| `loudnessCorrectionType` | `file` | Correction applied to file |

### loudnessMetadata Elements

| Element | Unit | Description |
|---------|------|-------------|
| `integratedLoudness` | LUFS | Gated programme loudness |
| `loudnessRange` | LU | EBU Tech 3342 LRA |
| `maxTruePeak` | dBTP | Maximum True Peak |
| `maxMomentary` | LUFS | Maximum momentary loudness |
| `maxShortTerm` | LUFS | Maximum short-term loudness |

---

## API Reference

### Import

```javascript
import {
  getSessionData,
  generateJSON,
  generateXML,
  downloadSessionJSON,
  downloadSessionXML
} from './app/session-export.js';
```

### getSessionData(lufsMeter, targetLufs)

Collect accumulated session data from meters.

```javascript
const data = getSessionData(lufsMeter, -23);
console.log(data.integrated);    // -23.1
console.log(data.truePeakMax);   // -1.5
console.log(data.durationFormatted); // "2:30:00"
```

### generateJSON(data)

Generate JSON string from session data.

```javascript
const data = getSessionData(lufsMeter, -23);
const json = generateJSON(data);
```

### generateXML(data, options)

Generate ADM-compliant XML from session data.

```javascript
const data = getSessionData(lufsMeter, -23);
const xml = generateXML(data, {
  programmeName: 'Evening News',
  programmeId: 'APR_2001'
});
```

### downloadSessionJSON(lufsMeter, targetLufs, filename)

Download session data as JSON file.

```javascript
downloadSessionJSON(lufsMeter, -23, 'my-session.json');
// Triggers download: my-session.json
```

### downloadSessionXML(lufsMeter, targetLufs, filename, options)

Download session data as XML file.

```javascript
downloadSessionXML(lufsMeter, -23, 'my-session.xml', {
  programmeName: 'Documentary'
});
// Triggers download: my-session.xml
```

---

## GUI Integration

Session capture is available via the **Session Capture** panel in the sidebar menu.

### Controls

| Control | Action |
|---------|--------|
| Start Session | Begin capturing (resets integrated values) |
| Stop Session | Stop capturing (data preserved for export) |
| Export JSON | Download session as JSON file |
| Export XML | Download session as ADM-compliant XML file |
| Enable capture | Toggle whether `C` key controls session capture |

### Header Indicator

When capture is enabled, a **Capture** badge appears in the header (matching the Calibrated badge style):

| State | Appearance |
|-------|------------|
| Ready | Grey badge with duration field |
| Capturing | Red badge with running duration counter |

### Keyboard Shortcut

| Key | Behaviour |
|-----|-----------|
| `C` | Toggle session capture (when hotkey enabled) |

---

## Regulatory Acceptance

### JSON Format

| Use Case | Acceptance |
|----------|------------|
| Internal QC | ✓ Recommended |
| Archiving | ✓ Recommended |
| Automation scripts | ✓ Recommended |
| EBU/regulatory delivery | ⚠ Check requirements |

### XML Format (ADM)

| Use Case | Acceptance |
|----------|------------|
| EBU member delivery | ✓ Per EBU Tech 3364 |
| BWF embedding | ✓ Via axml chunk |
| Broadcast QC systems | ✓ Standard format |
| Regulatory submission | ✓ Check local requirements |

---

## Comparison with Radar Export

| Aspect | Radar Export | Session Export |
|--------|--------------|----------------|
| Duration limit | 30–600 seconds | Unlimited |
| Data source | radarHistory buffer | LUFS meter accumulators |
| Short-term history | ✓ Included | Current values only |
| Integrated (I) | Passed in | From LUFS meter |
| LRA | Passed in | From LUFS meter |
| True Peak | Passed in | From meterState |
| Format | JSON only | JSON + XML (ADM) |

---

## References

- [EBU R128](https://tech.ebu.ch/publications/r128) — Loudness normalisation
- [EBU Tech 3341](https://tech.ebu.ch/publications/tech3341) — Loudness Metering
- [EBU Tech 3342](https://tech.ebu.ch/publications/tech3342) — Loudness Range
- [EBU Tech 3364](https://tech.ebu.ch/publications/tech3364) — ADM Metadata
- [ITU-R BS.1770-4](https://www.itu.int/rec/R-REC-BS.1770/) — Loudness algorithms
- [ITU-R BS.2076](https://www.itu.int/rec/R-REC-BS.2076/) — Audio Definition Model
- [EBU ADM Guidelines](https://adm.ebu.io/) — loudnessMetadata reference

---

*Document version: 1.0*
*Last updated: 2026-01-04*
