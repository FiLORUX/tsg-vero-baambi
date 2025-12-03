# API Reference

Complete API documentation for VERO-BAAMBI metering modules.

---

## Metering Modules

### LUFSMeter

EBU R128 / ITU-R BS.1770-4 loudness measurement.

```javascript
import { LUFSMeter } from './src/metering/lufs.js';

const meter = new LUFSMeter({ sampleRate: 48000 });
```

#### Constructor Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sampleRate` | number | 48000 | Audio sample rate in Hz |

#### Methods

##### `update(leftBuffer, rightBuffer)`

Process audio samples through K-weighting filter and update loudness values.

- `leftBuffer`: `Float32Array` - Left channel samples
- `rightBuffer`: `Float32Array` - Right channel samples

##### `getState()` → `LUFSMeterState`

Returns current loudness readings:

```javascript
{
  momentary: number,   // 400ms window (LUFS)
  shortTerm: number,   // 3s window (LUFS)
  integrated: number,  // Programme-length gated (LUFS)
  lra: number          // Loudness Range (LU)
}
```

##### `reset()`

Reset all measurements and history.

---

### TruePeakMeter

ITU-R BS.1770-4 Annex 2 intersample peak detection with 4× Hermite interpolation.

```javascript
import { TruePeakMeter } from './src/metering/true-peak.js';

const meter = new TruePeakMeter({
  sampleRate: 48000,
  peakHoldSeconds: 3,
  limit: -1  // dBTP
});
```

#### Constructor Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sampleRate` | number | 48000 | Audio sample rate in Hz |
| `peakHoldSeconds` | number | 3 | Peak hold duration |
| `limit` | number | -1 | Over-limit threshold (dBTP) |

#### Methods

##### `update(leftBuffer, rightBuffer)`

Process audio samples and detect intersample peaks.

##### `getState()` → `TruePeakMeterState`

```javascript
{
  dbtpLeft: number,      // Current left True Peak (dBTP)
  dbtpRight: number,     // Current right True Peak (dBTP)
  dbtpHoldLeft: number,  // Peak hold left (dBTP, 3s)
  dbtpHoldRight: number, // Peak hold right (dBTP, 3s)
  dbtpMax: number,       // Maximum since reset (dBTP)
  isOverLeft: boolean,   // Left exceeded limit
  isOverRight: boolean,  // Right exceeded limit
  isOverAny: boolean     // Either channel exceeded limit
}
```

##### `reset()`

Reset peak hold and over indicator.

---

### PPMMeter

IEC 60268-10 Type I (Nordic) quasi-peak programme meter.

```javascript
import { PPMMeter } from './src/metering/ppm.js';

const meter = new PPMMeter({
  sampleRate: 48000,
  peakHoldSeconds: 3,
  useRCDetector: true
});
```

#### Constructor Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sampleRate` | number | 48000 | Audio sample rate in Hz |
| `peakHoldSeconds` | number | 3 | Peak hold duration |
| `useRCDetector` | boolean | true | Use RC detector (analogue-accurate) |

#### Methods

##### `update(leftBuffer, rightBuffer)`

Process audio samples through quasi-peak detector.

##### `getState()` → `PPMMeterState`

```javascript
{
  dbfsLeft: number,         // Current left level (dBFS)
  dbfsRight: number,        // Current right level (dBFS)
  dbfsHoldLeft: number,     // Peak hold left (dBFS, 3s)
  dbfsHoldRight: number,    // Peak hold right (dBFS, 3s)
  ppmScaleLeft: number,     // Current left (Nordic PPM, -36 to +9)
  ppmScaleRight: number,    // Current right (Nordic PPM)
  ppmScaleHoldLeft: number, // Peak hold left (Nordic PPM)
  ppmScaleHoldRight: number,// Peak hold right (Nordic PPM)
  isSilentLeft: boolean,    // Left below scale minimum
  isSilentRight: boolean    // Right below scale minimum
}
```

##### `resetPeakHold()`

Reset peak hold values only.

---

### StereoMeter

Phase correlation, balance, and stereo width analysis.

```javascript
import { StereoMeter } from './src/metering/correlation.js';

const meter = new StereoMeter({ smoothingMs: 100 });
```

#### Constructor Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `smoothingMs` | number | 100 | Display smoothing in ms |

#### Methods

##### `update(leftBuffer, rightBuffer)`

Calculate correlation, balance, and width.

##### `getState()` → `StereoMeterState`

```javascript
{
  correlation: number,        // -1 to +1 (smoothed)
  correlationInstant: number, // -1 to +1 (instantaneous)
  balance: number,            // -1 (left) to +1 (right)
  width: number,              // 0 (mono) to 1+ (wide)
  zone: string                // 'good' | 'caution' | 'problem'
}
```

##### `reset()`

Reset meter state.

---

## Utility Functions

### dB Conversions

```javascript
import { gainToDb, dbToGain } from './src/utils/math.js';

gainToDb(0.5);   // → -6.02 dB
dbToGain(-6);    // → 0.501
```

### PPM Scale Conversion

```javascript
import { dbfsToPPM, ppmToDbfs } from './src/metering/ppm.js';

dbfsToPPM(-18);  // → 0 PPM (EBU alignment)
ppmToDbfs(6);    // → -12 dBFS (TEST level)
```

### Correlation Colour

```javascript
import { getCorrelationColour } from './src/metering/correlation.js';

getCorrelationColour(0.8);   // → '#00d4aa' (green, good)
getCorrelationColour(-0.5);  // → '#ff4444' (red, phase issue)
```

### M/S Conversion

```javascript
import { lrToMs, msToLr } from './src/metering/correlation.js';

const { mid, side } = lrToMs(leftSample, rightSample);
const { left, right } = msToLr(mid, side);
```

---

## Constants

### Loudness Standards

```javascript
import {
  DEFAULT_TARGET_LUFS,  // -23 (EBU R128)
  TP_LIMIT_EBU,         // -1 dBTP
  TP_LIMIT_STREAMING    // -2 dBTP (codec headroom)
} from './src/metering/index.js';
```

### PPM Scale

```javascript
import {
  PPM_MIN_DBFS,  // -60 dBFS (scale minimum)
  PPM_MAX_DBFS,  // -9 dBFS (+9 PPM / PML)
  PPM_TEST_DBFS  // -12 dBFS (+6 PPM / TEST)
} from './src/metering/ppm.js';
```

---

## Type Definitions

All types are documented with JSDoc and available for TypeScript validation:

```bash
npx tsc --noEmit --allowJs --checkJs --strict src/metering/*.js
```

See individual module files for complete `@typedef` declarations.

---

*Generated for VERO-BAAMBI v2.2.0*
