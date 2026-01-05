# Deployment Guide

How to run VERO-BAAMBI in different environments.

---

## TL;DR

| Method | Command | Functionality |
|--------|---------|---------------|
| HTTP server | `python3 -m http.server 8080` | 100% — all features |
| Chrome launcher | `launchers/chrome-file-mode.command` | 100% — all features |
| Direct file (no flags) | Double-click `index.html` | Limited — ES modules blocked |

---

## Running with HTTP Server (Recommended)

Serving via HTTP provides full functionality with no restrictions.

### Quick Start

```bash
# Python (built-in)
python3 -m http.server 8080

# Node.js
npx serve .

# PHP
php -S localhost:8080
```

Then open `http://localhost:8080/` in your browser.

### Why HTTP is Recommended

1. **Full AudioWorklet support** — All test generators function correctly
2. **Consistent module loading** — ES modules load reliably across all browsers
3. **Accurate CORS behaviour** — Matches production deployment
4. **localStorage reliability** — Consistent across all browsers

---

## Running from File System (file://)

Opening `index.html` directly in a browser (double-clicking the file) works for most functionality. This section documents what works and what does not.

### What Works

#### Core Metering (All Features)

| Component | Technology | Status |
|-----------|------------|--------|
| Loudness meters (M/S/I/LRA) | Web Audio AnalyserNode | ✓ Works |
| True Peak detection | Web Audio + Canvas | ✓ Works |
| Loudness radar | Canvas 2D | ✓ Works |
| History strip | Canvas 2D | ✓ Works |
| Goniometer/vectorscope | Canvas 2D | ✓ Works |
| Correlation meter | Canvas 2D | ✓ Works |
| Balance meter | Canvas 2D | ✓ Works |
| Spectrum analyser | AnalyserNode + Canvas | ✓ Works |
| Bargraph meters (all scales) | Canvas 2D | ✓ Works |

#### Audio Input

| Source | Technology | Status |
|--------|------------|--------|
| Microphone input | getUserMedia | ✓ Works (permission required) |
| Screen/tab capture | getDisplayMedia | ✓ Works (permission required) |
| System audio loopback | getDisplayMedia | ✓ Works (browser-dependent) |

#### Test Signal Generators

| Generator | Technology | Status |
|-----------|------------|--------|
| Sine wave (1 kHz) | OscillatorNode | ✓ Works |
| EBU calibration tones | OscillatorNode | ✓ Works |
| Pink noise | AudioBufferSourceNode | ✓ Works |
| White noise | AudioBufferSourceNode | ✓ Works |
| Uncorrelated stereo noise | Dual AudioBufferSourceNode | ✓ Works |
| Lissajous patterns | OscillatorNode pairs | ✓ Works |

#### User Interface

| Feature | Technology | Status |
|---------|------------|--------|
| All visualisations | Canvas 2D | ✓ Works |
| Sidebar navigation | CSS/JS | ✓ Works |
| Keyboard shortcuts | DOM events | ✓ Works |
| Settings persistence | localStorage | ✓ Works* |

*localStorage behaviour varies by browser on `file://`. See [Browser Notes](#browser-notes) below.

### What Requires Special Configuration

#### Understanding Browser Security on file://

When you open a local HTML file by double-clicking it, the browser uses the `file://` protocol. Browsers apply stricter security rules to `file://` than to `http://` because local files have access to your entire filesystem.

Two specific restrictions affect VERO-BAAMBI:

1. **ES Module loading** — Chrome blocks `import` statements from loading other local files
2. **AudioWorklet module loading** — All browsers block `audioContext.audioWorklet.addModule()` from loading local files

Both restrictions exist because these mechanisms load and execute external JavaScript code. On `http://`, the server controls what code is served. On `file://`, any file on your machine could theoretically be loaded and executed — browsers prevent this by default.

#### Chrome Launcher: The Complete Solution

The Chrome launcher scripts (in `launchers/`) start Chrome with the `--allow-file-access-from-files` flag. This flag:

1. Permits ES modules to load other local files via `import`
2. Permits AudioWorklet to load processor modules via `addModule()`
3. Applies only to that Chrome session (other Chrome windows are unaffected)

**With the Chrome launcher, all features work on file://.** This includes the THÅST vector generator, stereo synchronisation via AudioWorklet, and all other functionality.

| Feature | Without launcher | With launcher |
|---------|------------------|---------------|
| ES modules | ✗ Blocked | ✓ Works |
| AudioWorklet (stereo sync) | ✗ Blocked | ✓ Works |
| AudioWorklet (THÅST generator) | ✗ Blocked | ✓ Works |
| All other features | ✓ Works | ✓ Works |

#### Remote Metering

| Feature | Technology | Status | Reason |
|---------|------------|--------|--------|
| Probe mode | WebSocket | Requires broker | Needs `broker/server.js` running |
| Client mode | WebSocket | Requires broker | Needs `broker/server.js` running |

Remote metering requires the WebSocket broker (`broker/server.js`) to be running. This is unrelated to the `file://` vs `http://` distinction — it requires a separate Node.js server process to relay metrics between probes and clients.

---

## Browser Notes

### localStorage on file://

| Browser | Behaviour |
|---------|-----------|
| Chrome | ✓ Works normally |
| Firefox | ⚠ Isolated per directory — settings do not persist if you move the folder |
| Safari | ⚠ May be disabled in private browsing or strict privacy settings |
| Edge | ✓ Works normally |

### ES Modules on file://

Chrome blocks ES modules on `file://` protocol by default. This is a security restriction that prevents local files from loading other local files as modules.

#### Chrome Workaround

Launch Chrome with the `--allow-file-access-from-files` flag. Launcher scripts are provided in the `launchers/` directory:

| Platform | Script | Usage |
|----------|--------|-------|
| macOS | `chrome-file-mode.command` | Double-click in Finder |
| Windows | `chrome-file-mode.bat` | Double-click in Explorer |
| Linux | `chrome-file-mode.sh` | Run `./chrome-file-mode.sh` in terminal |

**Manual launch commands:**

```bash
# macOS
open -a "Google Chrome" --args --allow-file-access-from-files

# Windows (from Command Prompt)
start chrome.exe --allow-file-access-from-files

# Linux
google-chrome --allow-file-access-from-files
```

> ⚠️ **Security note:** This flag allows ALL local files to access other local files. Only use in trusted environments. Close this Chrome instance when finished.

#### Firefox and Safari

Firefox and Safari typically allow ES modules on `file://` without special configuration. If you encounter issues:

1. Ensure you are using a current browser version
2. Verify the file structure is intact (no missing files)
3. Check that no browser extensions are blocking script execution

---

## Deployment Scenarios

### Scenario 1: Quick Demo (Chrome Launcher)

Use the Chrome launcher script in `launchers/`. All features work, including all seven test generators and AudioWorklet stereo synchronisation.

```bash
# macOS: double-click, or:
open launchers/chrome-file-mode.command

# Windows: double-click chrome-file-mode.bat

# Linux:
./launchers/chrome-file-mode.sh
```

### Scenario 2: Development

```bash
python3 -m http.server 8080
```

Full functionality. Hot reload by refreshing the browser.

### Scenario 3: Production (Intranet)

Deploy to any static file server (nginx, Apache, IIS, S3, etc.). No build step required.

```nginx
server {
    listen 80;
    root /var/www/vero-baambi;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

### Scenario 4: Air-Gapped Environment

Copy the entire directory to a USB drive. On the target machine:

1. Copy files to local storage
2. Run `python3 -m http.server 8080` (or equivalent)
3. Open `http://localhost:8080/`

No internet connection required. All functionality works offline.

---

## Summary

```
┌─────────────────────────────────────────────────────────────┐
│  file:// with Chrome launcher                               │
│  (launchers/chrome-file-mode.command)                       │
│                                                             │
│  ✓ All metering and visualisation                          │
│  ✓ All 7 test generators (including THÅST)                 │
│  ✓ AudioWorklet stereo synchronisation                     │
│  ✓ Microphone and screen capture                           │
│  ✓ Settings persistence                                    │
│                                                             │
│  ✗ Remote metering (requires broker server)                │
├─────────────────────────────────────────────────────────────┤
│  file:// without launcher (double-click)                    │
│                                                             │
│  Chrome: ✗ Blocked (ES modules fail to load)               │
│  Firefox/Safari: Partial (no AudioWorklet features)        │
├─────────────────────────────────────────────────────────────┤
│  http:// (local server)                                     │
│                                                             │
│  ✓ All features                                            │
│  ✓ Consistent behaviour across all browsers                │
│  ✓ Matches production deployment                            │
│                                                             │
│  ✗ Remote metering (requires broker server)                │
└─────────────────────────────────────────────────────────────┘
```

**Recommendation:** Use the Chrome launcher for local development, or run via HTTP server. Both provide full functionality.
