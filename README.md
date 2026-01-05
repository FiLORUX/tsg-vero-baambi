# VERO-BAAMBI

**Broadcast audio metering for production environments**

> A local-first, dependency-free implementation of EBU R128 loudness metering,
> True Peak detection, and Nordic PPM — designed for verification and monitoring
> in broadcast workflows.

> *VERO* – "true" in Italian and Esperanto
> *BAAMBI* – Broadcast Audio Alignment & Metering for Broadcast Infrastructure

Part of the TSG Suite – tools for alignment, metering, and signal verification.

---

## Local-First Manifesto

This application is built on the principle that **local operation is not a fallback – it is the primary mode**.

### Core Principles

1. **Zero external dependencies for core functionality**
   - No CDN imports, no npm packages in production
   - No build step required – works from any static file server
   - No analytics, no tracking, no phone-home

2. **Privacy by design**
   - All audio processing happens in-browser
   - No audio data leaves the device
   - Settings stored locally in browser storage
   - Remote features are opt-in, never opt-out

3. **Offline-capable by default**
   - Full functionality without network access
   - No service worker required for basic operation
   - Works from `file://` protocol using Chrome launcher (see `launchers/`), or via any HTTP server

4. **Predictable behaviour**
   - Same code runs in development and production
   - No environment-specific branches in core logic
   - Feature flags are explicit, never hidden

5. **Verifiable output**
   - Metering accuracy can be verified with reference signals
   - Implements EBU R128, ITU-R BS.1770-4, IEC 60268-10 algorithms
   - Calibration against known test signals documented

### Remote Features

Remote metering is now fully implemented with a probe/broker/client architecture:

- **Explicit user opt-in** — disabled by default, enabled via UI toggle
- **Local network first** — broker runs on localhost, configurable for LAN
- **Metrics only** — no audio content transmitted, only numerical values (LUFS, True Peak, PPM, stereo)
- **Graceful degradation** — queues messages during disconnection, auto-reconnects with exponential backoff
- **Zero impact on local mode** — remote features are additive, local operation unaffected

See `src/remote/` for implementation and `broker/` for the relay server.

### Calibration

Device-specific calibration for reference-level alignment:

- **Auto-calibration** — internal 1 kHz @ −18 dBFS reference tone, 30-second measurement
- **Manual calibration** — user-adjustable trim with live offset display
- **Profile storage** — device-keyed profiles persist across sessions
- **Status badge** — shows calibration age, warns when stale (>30 days)

Supports EBU R128 (−23 LUFS), ATSC A/85 (−24 LKFS), and streaming (−16 LUFS) targets.

---

## Quick Start

**HTTP server (recommended):**

```bash
python3 -m http.server 8080
```

Then visit `http://localhost:8080/` in your web browser.

**Alternative — Chrome launcher:**

Double-click the launcher script for your platform in `launchers/`. All local features work; see [docs/deployment.md](docs/deployment.md) for security considerations and limitations.

---

## Complete Beginner's Guide

This section provides step-by-step instructions for users who have never run a local HTTP server or used a terminal emulator before. Each step is a single action; verify success before proceeding to the next.

### What You Will Need

Before commencing, ensure you have the following:

1. **Python 3 interpreter** — Python is a programming language; the interpreter is the programme that executes Python code. You will use it to run a local HTTP server.
   - Download from: https://python.org/downloads
   - Version 3.8 or later is recommended

2. **A web browser with Web Audio API support** — The Web Audio API is a browser interface for processing and synthesising audio in real time.
   - Recommended: Safari, Chrome, or Edge
   - Note: Firefox has known limitations with sample rate matching; use an alternative if you encounter audio issues

3. **Approximately 50 MB free disc space** — For the source files and browser cache

4. **A functioning audio input device** — A built-in microphone suffices for initial testing; external audio interfaces work for production use

### Verification Step

Before proceeding, verify that Python is installed correctly.

<details>
<summary>Opening a terminal emulator on macOS</summary>

1. Press `Cmd+Space` to open Spotlight Search
2. Type `Terminal`
3. Press `Return`

A window with a command prompt appears. This is the terminal emulator (a programme that provides a text-based interface to your operating system).

</details>

<details>
<summary>Opening a terminal emulator on Windows</summary>

**Method 1:**
1. Press `Win+R` to open the Run dialogue
2. Type `cmd`
3. Press `Enter`

**Method 2:**
1. Right-click the Start menu
2. Select "Terminal" or "Command Prompt"

A window with a command prompt appears.

</details>

<details>
<summary>Opening a terminal emulator on Linux</summary>

Press `Ctrl+Alt+T` on most distributions. If this does not work, search your application menu for "Terminal".

</details>

**Verify Python installation:**

Type the following command and press `Return` (macOS/Linux) or `Enter` (Windows):

```bash
python3 --version
```

Expected output:
```
Python 3.x.x
```

where `x.x` is the minor and patch version (e.g., `Python 3.11.4`).

<details>
<summary>If the command fails on Windows</summary>

Windows may use `python` instead of `python3`. Try:

```bash
python --version
```

If this also fails, Python is not in your PATH environment variable (the list of directories your operating system searches when you type a command). Reinstall Python and ensure you tick "Add Python to PATH" during installation.

</details>

### Obtaining the Source Files

1. Open your web browser and navigate to the repository URL
2. Click the green "Code" button
3. Select "Download ZIP"
4. Wait for the download to complete

<details>
<summary>Extracting the ZIP archive on macOS</summary>

Double-click the downloaded `.zip` file. The Archive Utility extracts it automatically, creating a directory with the same name (minus the `.zip` extension).

</details>

<details>
<summary>Extracting the ZIP archive on Windows</summary>

1. Right-click the downloaded `.zip` file
2. Select "Extract All..."
3. Choose a destination (the default is acceptable)
4. Click "Extract"

</details>

<details>
<summary>Extracting the ZIP archive on Linux</summary>

In your file manager, right-click the `.zip` file and select "Extract Here". Alternatively, in the terminal emulator:

```bash
unzip filename.zip
```

</details>

Note the full path to the extracted directory. Examples:
- macOS: `/Users/yourname/Downloads/tsg-vero-baambi-main`
- Windows: `C:\Users\yourname\Downloads\tsg-vero-baambi-main`
- Linux: `/home/yourname/Downloads/tsg-vero-baambi-main`

### Starting the Application

**HTTP server (recommended):**

Serving via HTTP provides full functionality across all browsers, enables remote metering features, and matches production deployment. Any HTTP server works — Python's built-in server is used here for simplicity.

**Alternative — Chrome launcher:**

The scripts in `launchers/` start Chrome with the `--allow-file-access-from-files` flag, which permits ES module loading and AudioWorklet on the `file://` protocol. All local metering features work identically to HTTP mode.

Limitations of Chrome launcher:
- Chrome only (Firefox and Safari require HTTP for full functionality)
- Remote metering features require the broker server regardless of protocol
- The flag reduces browser security — use in trusted environments only

**Why these restrictions exist:** Browsers apply security restrictions to local files opened via `file://` protocol. By default, Chrome blocks ES module imports, and all browsers block `AudioWorklet.addModule()`. These restrictions prevent arbitrary local files from executing code in security-sensitive contexts.

See [`docs/deployment.md`](docs/deployment.md) for detailed compatibility information.

1. In your terminal emulator, navigate to the extracted directory using the `cd` command (`cd` means "change directory"):

   ```bash
   cd /path/to/tsg-vero-baambi-main
   ```

   Replace `/path/to/tsg-vero-baambi-main` with the actual path you noted earlier.

   <details>
   <summary>Windows path format</summary>

   On Windows, use backslashes and include the drive letter:

   ```bash
   cd C:\Users\yourname\Downloads\tsg-vero-baambi-main
   ```

   </details>

2. Verify you are in the correct directory by listing its contents:

   ```bash
   ls
   ```

   (On Windows Command Prompt, use `dir` instead of `ls`)

   You should see files including `index.html`, `README.md`, and a `src` directory.

3. Start the HTTP server:

   ```bash
   python3 -m http.server 8080
   ```

   (On Windows, use `python` if `python3` does not work)

4. Observe the output:

   ```
   Serving HTTP on 0.0.0.0 port 8080 (http://0.0.0.0:8080/) ...
   ```

   This confirms the server is running. The terminal emulator is now blocked (occupied by the server process). This is expected behaviour.

### Accessing the Application

1. Open your web browser

2. Type the following in the address bar and press `Return`/`Enter`:

   ```
   http://localhost:8080
   ```

   Explanation: `localhost` is an alias for your own machine (the IP address `127.0.0.1`). The number `8080` is the port you specified when starting the server.

3. The VERO-BAAMBI interface loads:
   - A boot splash displays for 777 milliseconds
   - The main metering interface appears

### Granting Microphone Access

1. Your web browser displays a permission dialogue requesting microphone access

2. **Privacy note:** The application processes all audio locally. No audio data leaves your machine. The browser requires explicit permission as a security measure.

3. Click "Allow"

4. If the interface appears but meters do not respond:
   - Click anywhere on the page
   - Web browsers require user interaction before the audio context (the Web Audio API component that processes audio) can start
   - This is a security feature to prevent websites from playing unwanted audio, not a bug

5. Speak into your microphone or play audio. The meters should respond:
   - The loudness radar displays a rotating sweep
   - LUFS values update in real time
   - The goniometer shows stereo activity

### Stopping the Server

1. Return to the terminal emulator window (it may be behind other windows)

2. Press `Ctrl+C`

   This sends SIGINT (an interrupt signal) to the server process, instructing it to terminate.

3. The terminal emulator becomes interactive again, displaying a new command prompt

### Troubleshooting Reference

| Symptom | Probable Cause | Resolution |
|---------|----------------|------------|
| `python3: command not found` | Python not in PATH environment variable | Windows: try `python` instead. macOS/Linux: install Python from python.org |
| `Address already in use` | Port 8080 occupied by another process | Use a different port: `python3 -m http.server 8081` and navigate to `http://localhost:8081` |
| ES module error in console | Chrome blocks ES modules on `file://` | Use Chrome launcher in `launchers/`, or run HTTP server |
| AudioWorklet error in console | Browser blocks AudioWorklet on `file://` | Use Chrome launcher in `launchers/`, or run HTTP server |
| No audio input detected | Microphone not permitted or incorrect device selected | Check browser permission settings; select correct device in sidebar |
| Meters not moving | Audio context suspended | Click anywhere on the page to activate (browser autoplay policy) |
| Firefox sample rate mismatch | Firefox Web Audio API limitation | Use Safari, Chrome, or Edge instead |
| Page loads but appears broken | Browser cache contains old version | Hard refresh: `Cmd+Shift+R` (macOS) or `Ctrl+Shift+R` (Windows/Linux) |

### Confirming Successful Installation

You have successfully installed and run VERO-BAAMBI when:

- The loudness radar shows activity (a rotating sweep line)
- LUFS values (M, S, I) update in real time as audio plays
- Pressing `Space` pauses and resumes measurement

**Next steps:**
- Explore keyboard shortcuts in [`docs/shortcuts.md`](docs/shortcuts.md)
- Read the Standards Implementation section below for technical details
- Try the signal generators in the sidebar for reference tones

---

## Production Deployment

### Static Files (Nginx)

```nginx
server {
    listen 80;
    server_name meters.example.com;
    root /var/www/vero-baambi;

    # Serve index.html for root
    location / {
        try_files $uri $uri/ /index.html;
    }

    # ES modules require correct MIME type
    location ~ \.js$ {
        types { application/javascript js; }
    }

    # Cache static assets
    location ~* \.(css|js|png|svg)$ {
        expires 1d;
        add_header Cache-Control "public, immutable";
    }
}
```

### Broker Service (systemd)

Create `/etc/systemd/system/vero-broker.service`:

```ini
[Unit]
Description=VERO-BAAMBI Metrics Broker
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/vero-baambi/broker
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=BROKER_PORT=8765

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable vero-broker
sudo systemctl start vero-broker
```

### Docker Compose

```yaml
version: '3.8'
services:
  broker:
    build: ./broker
    ports:
      - "8765:8765"   # WebSocket
      - "8766:8766"   # REST API
    restart: unless-stopped

  web:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./:/usr/share/nginx/html:ro
    restart: unless-stopped
```

### HTTPS for Remote Metering

For secure WebSocket (wss://), use a reverse proxy:

```nginx
server {
    listen 443 ssl;
    server_name broker.example.com;

    ssl_certificate /etc/letsencrypt/live/broker.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/broker.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8765;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

Then use `wss://broker.example.com` as broker URL.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` / `P` | Play/Pause measurement (tap = toggle, hold = momentary) |
| `R` | Reset integrated loudness |
| `M` | Toggle sidebar menu |
| `F` | Toggle fullscreen |
| `1` `2` `3` `4` `5` | Switch meter mode (TP / RMS / SP / Nordic / BBC) |

Full shortcuts reference: [`docs/shortcuts.md`](docs/shortcuts.md)

---

## Standards Implementation

### Loudness Metering (EBU R128 / ITU-R BS.1770-4)

| Parameter | Standard | Implementation |
|-----------|----------|----------------|
| K-weighting pre-filter | ITU-R BS.1770-4 §2.1 | Two-stage biquad: high-pass (fc=38 Hz, Q=0.5) + high-shelf (+4 dB @ 4 kHz) |
| Momentary loudness (M) | EBU Tech 3341 | 400 ms sliding window, gated |
| Short-term loudness (S) | EBU Tech 3341 | 3 s sliding window, gated |
| Integrated loudness (I) | ITU-R BS.1770-4 §4 | Programme-length, dual-gated |
| Absolute gate | ITU-R BS.1770-4 §4.1 | −70 LUFS |
| Relative gate | ITU-R BS.1770-4 §4.2 | −10 LU below ungated integrated |
| Loudness Range (LRA) | EBU Tech 3342 | 95th − 10th percentile of gated short-term |
| Target loudness | EBU R128 | −23 LUFS (±1 LU tolerance) |

### True Peak Detection (ITU-R BS.1770-4 Annex 2)

| Parameter | Standard | Implementation |
|-----------|----------|----------------|
| Oversampling | ITU-R BS.1770-4 Annex 2 | 4× using Hermite interpolation |
| Maximum permitted level | EBU R128 | −1 dBTP |
| Streaming headroom | Industry practice | −2 dBTP (lossy codec margin) |

**Implementation note:** ITU-R BS.1770-4 Annex 2 specifies polyphase FIR reconstruction for laboratory-grade measurement. This implementation uses 4-point Hermite interpolation, which:
- Provides sufficient accuracy (±0.5 dB) for broadcast monitoring
- Requires ~8× less computation than polyphase FIR
- May miss edge-case intersample peaks in near-Nyquist content

Polyphase FIR coefficients and implementation guidance are documented in `true-peak.js` for future laboratory-grade implementation if required.

### PPM Metering (IEC 60268-10 Type I / Nordic)

| Parameter | Standard | Implementation |
|-----------|----------|----------------|
| Integration time | IEC 60268-10 Type I | 5 ms (quasi-peak) |
| Rise time to −1 dB | IEC 60268-10 Type I | 5 ms ± 0.5 ms |
| Fall time | IEC 60268-10 Type I | 20 dB in 1.7 s (≈11.76 dB/s linear) |
| Scale range | NTP 177-800 / EBU R68 | −40 to +18 PPM (58 dB) |
| Peak hold | RTW/DK convention | 3 s |
| Detector model | IEC 60268-10 | RC circuit (default) or window-max |

**Quasi-peak detector:** Two modes are available:
- **RC detector** (default): Models analogue rectifier + RC network per IEC 60268-10. Attack time constant τ ≈ 1.7 ms (−1 dB in 5 ms), decay τ ≈ 740 ms. Provides smooth, "analogue" response with correct tone-burst behaviour.
- **Window mode**: Simplified maximum-within-window approach. Faster computation but may over-read fast transients by ~1 dB.

### Reference Levels (EBU R68 / Alignment)

| Context | Analogue Reference | Digital Reference | PPM Reading |
|---------|-------------------|-------------------|-------------|
| EBU alignment tone | 0 dBu | −18 dBFS | 0 PPM |
| Nordic TEST level | +6 dBu | −12 dBFS | +6 PPM (TEST) |
| Permitted Maximum Level (PML) | +9 dBu | −9 dBFS | +9 PPM |
| SMPTE alignment (USA) | +4 dBu | −20 dBFS | — |

**Conversion formula:** PPM = dBFS + 18 (per EBU R68 alignment where 0 dBu = −18 dBFS)

### Stereo Analysis

| Measurement | Standard/Method | Range |
|-------------|-----------------|-------|
| Phase correlation | Pearson correlation coefficient | −1 (antiphase) to +1 (mono) |
| L/R balance | RMS level difference | −1 (full left) to +1 (full right) |
| Stereo width | M/S energy ratio (Side/Mid) | 0 (mono) to >1 (wide) |
| Mono compatibility threshold | Broadcast practice | Correlation < −0.3 = warning |

### Signal Generators

| Type | Standard | Purpose |
|------|----------|---------|
| GLITS | EBU Tech 3304 | Line-up and identification |
| Stereo identification | EBU Tech 3304 | L/R channel verification (pulsed) |
| Reference tones | — | 1 kHz @ −18 dBFS (EBU), −20 dBFS (SMPTE) |
| Pink/white/brown noise | — | Acoustic measurement, system noise floor |
| Lissajous patterns | — | Vectorscope/goniometer calibration |
| THÅST vector text | — | Goniometer branding via X/Y audio signals (AudioWorklet) |

---

## Accuracy, Methods & Limitations

### K-Weighting Filter

The K-weighting implementation uses Web Audio API `BiquadFilterNode` for real-time efficiency:

- **Stage 1:** High-pass filter (fc=38 Hz, Q=0.5)
- **Stage 2:** High-shelf filter (+4 dB @ 4 kHz)

Exact ITU-R BS.1770-4 biquad coefficients for 48 kHz are included in `k-weighting.js` for reference and offline processing. The Web Audio approximation may deviate by ≤0.1 dB from the specification at extreme frequencies.

**Sample rate consideration:** Coefficients are calculated for 48 kHz. At 44.1 kHz, expect minor deviation (typically <0.2 dB) in high-frequency response.

### PPM Ballistics

PPM timing is implemented using `requestAnimationFrame` scheduling, not hardware timers. Practical implications:

- Attack time (5 ms) depends on audio buffer size and frame timing
- Decay rate (11.76 dB/s) is calculated per-frame using elapsed time
- Browser throttling (background tabs) will affect ballistics accuracy

For critical monitoring, use dedicated hardware meters.

### True Peak Interpolation

The 4× oversampling uses Hermite interpolation between sample points:

```
Interpolation points: t = 0.25, 0.50, 0.75 between each sample pair
```

This catches most intersample peaks but may miss edge cases that a full polyphase FIR would detect. Typical deviation from "true" True Peak: <0.5 dB for normal programme material.

### What This Project Does NOT Provide

- **Formal certification:** No third-party laboratory has certified this implementation
- **Guaranteed timing precision:** Web browser scheduling is not deterministic
- **Multi-channel support:** Stereo only; BS.1770 5.1/7.1 channel weights not implemented
- **Regulatory compliance:** Not suitable as sole evidence for delivery QC

### Practical Positioning

This tool is designed for:

- Quick verification during production
- Confidence monitoring alongside dedicated hardware
- Educational understanding of broadcast metering concepts
- Environments where installing dedicated software is impractical

It is **not** intended to replace certified measurement equipment for delivery QC or regulatory compliance.

---

## Verification

### Automated Tests

```bash
node tests/metering-verification.js
```

Runs 35 synthetic signal tests against metering modules covering:

- dB/gain conversions
- RMS calculation (sine wave at 0.707× peak)
- Pearson correlation (mono, antiphase, uncorrelated)
- Hermite interpolation accuracy
- PPM ballistics (5 ms attack, 20 dB/1.7 s decay)
- True Peak intersample detection
- LUFS integration windows (400 ms, 3 s)
- Stereo width and balance calculations

### In-Browser Verification

Click **VERIFY METERS** in the sidebar to run 5 automated tests:

1. **LUFS accuracy** — pink noise @ −23 LUFS (±0.3 LU tolerance)
2. **PPM calibration** — 1 kHz @ −18 dBFS → TEST (0 PPM)
3. **Stereo decorrelation** — 997/1003 Hz → correlation ≈ 0
4. **Mono correlation** — L=R → correlation = +1.0
5. **Intersample peak** — clipped sine → True Peak > 0 dBTP

### Manual Verification

Open `tools/verify-audio.html` in a browser for interactive verification with test tones.

See `docs/verification.md` for detailed test procedures using reference signals.

---

## Directory Structure

```
tsg-vero-baambi/
├── index.html                  # Main application (ES modules)
├── probe.html                  # Remote probe application
├── wallboard.html              # NOC display for multiple probes
├── control.html                # Remote control interface for headless probes
├── external-meter-processor.js # AudioWorklet for external sources
├── README.md                   # This file
├── smoke-checklist.md          # Manual testing checklist
│
├── launchers/                  # Platform-specific launcher scripts
│   ├── chrome-file-mode.command  # macOS (double-click in Finder)
│   ├── chrome-file-mode.bat      # Windows (double-click in Explorer)
│   └── chrome-file-mode.sh       # Linux (run in terminal)
│
├── broker/                     # Remote metering relay server
│   ├── server.js               # WebSocket broker with rate limiting
│   ├── rest-api.js             # REST API (Prometheus metrics, health)
│   └── package.json            # Broker dependencies (ws only)
│
└── src/
    ├── main.js                 # Application entry, initialisation
    │
    ├── audio/                  # Audio processing utilities
    │   ├── stereo-sampler.js   # Dual-mode L/R synchronisation
    │   └── stereo-sampler-worklet.js # AudioWorklet for atomic stereo capture
    │
    ├── metering/               # Measurement algorithms
    │   ├── lufs.js             # EBU R128 / ITU-R BS.1770-4 loudness
    │   ├── ppm.js              # IEC 60268-10 Type I PPM (Nordic)
    │   ├── true-peak.js        # ITU-R BS.1770-4 Annex 2 intersample peak
    │   ├── k-weighting.js      # ITU-R BS.1770-4 pre-filter
    │   └── correlation.js      # Phase correlation & stereo analysis
    │
    ├── generators/             # Signal generators
    │   ├── oscillators.js      # Sine, sweep, GLITS (EBU Tech 3304)
    │   ├── noise.js            # Pink, white, brown noise
    │   ├── lissajous.js        # Stereo test patterns
    │   ├── thast-vector-text.js      # THÅST X/Y signal generator
    │   └── thast-vector-worklet.js   # AudioWorklet for THÅST output
    │
    ├── ui/                     # Display components
    │   ├── goniometer.js       # Stereo vectorscope (Lissajous)
    │   ├── correlation-meter.js # Phase correlation display
    │   ├── bar-meter.js        # LED bar renderers (TP, RMS, PPM)
    │   └── spectrum.js         # 1/3-octave spectrum analyser
    │
    ├── app/                    # Application integration
    │   ├── bootstrap.js        # Main initialisation & DOM wiring
    │   ├── render-loop.js      # 60 Hz visual rendering (RAF-based)
    │   └── measure-loop.js     # 20 Hz measurement updates
    │
    └── remote/                 # Remote metering module
        ├── index.js            # Remote module exports
        ├── types.js            # Metrics schema (RemoteMetrics type)
        ├── transport/          # WebSocket communication
        │   ├── index.js        # Transport exports
        │   └── websocket-client.js # Auto-reconnect WebSocket wrapper
        ├── probe/              # Metrics sender (source side)
        │   ├── index.js        # Probe exports
        │   ├── probe-sender.js # Streams metrics to broker
        │   └── metrics-collector.js # Gathers meter values
        ├── client/             # Metrics receiver (display side)
        │   ├── index.js        # Client exports
        │   └── metrics-receiver.js # Receives and distributes metrics
        └── ui/                 # Remote UI components
            ├── index.js        # UI exports
            ├── remote-panel.js # Toggle and status panel
            └── remote-panel.css # Panel styling
```

---

## Browser Compatibility

| Browser | Minimum Version | Notes |
|---------|-----------------|-------|
| Chrome | 72+ | AudioWorklet + getDisplayMedia |
| Edge | 79+ | Chromium-based |
| Firefox | 76+ | AudioWorklet since 76 |
| Safari | 14.1+ | AudioWorklet since 14.1 |

---

## Development

### No Build Required

The application runs directly from source files. No transpilation, bundling, or build process needed.

### CI Pipeline

GitHub Actions runs on every push:

- **ESLint:** Code style enforcement
- **Syntax check:** `node --check` on all source files
- **Type check:** `tsc --noEmit --checkJs --strict` on metering modules
- **Tests:** 35 metering algorithm verification tests

### Optional Dev Tools

For enhanced development experience:

- **Live Server:** Auto-reload on file changes
- **TypeScript:** JSDoc type checking without compilation
- **ESLint:** Code style enforcement

---

## Licence

MIT Licence. Copyright 2025–2026 David Thåst.

Part of TSG Suite.
Maintained by David Thåst · https://github.com/FiLORUX

---

*Built with the assumption that behaviour should be predictable, output should be verifiable, and silence should mean silence.*
