/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * VERO-BAAMBI PPM Browser Verification
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Run: npm run test:browser:ppm
 *
 * Plays a 1 kHz tone at 0 dBFS through the application's generator in
 * headless Chromium, stops it, and records the displayed Nordic PPM, BBC PPM
 * and Sample Peak readouts on every animation frame. The return times must
 * hold in real time, as the operator sees them:
 *
 *   Nordic PPM (IEC 60268-10 Type I):   20 dB in 1.7 s ±0.3 s
 *   BBC PPM (IEC 60268-10 Type IIa):    24 dB in 2.8 s ±0.3 s
 *   Sample Peak (the meter's release):  20 dB in 1.7 s ±0.3 s
 *
 * The fall is timed between two readings on the way down (2 dB below the
 * steady level and 20 or 24 dB further), so neither the generator's stop nor
 * the frame phase enters the result. Two runs:
 *
 *   1. With the stereo-sampler AudioWorklet, whose detectors see every sample.
 *   2. With the sampler module blocked, where the application feeds its own
 *      detectors with the analyser samples that are new since each frame.
 *
 * Requirements: the playwright-core dev dependency and a Chromium build
 * (npx playwright-core install chromium), or CHROMIUM_PATH pointing at a
 * Chromium or Chrome executable.
 *
 * @module tests/browser/ppm-browser
 * @see IEC 60268-10 (Peak programme level meters)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    console.log(`${GREEN}[PASS]${RESET} ${name}: ${detail}`);
    passed++;
  } else {
    console.log(`${RED}[FAIL]${RESET} ${name}: ${detail}`);
    failed++;
  }
}

function info(text) {
  console.log(`${DIM}       ${text}${RESET}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// STATIC SERVER
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function startServer() {
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const filePath = resolve(ROOT, normalize(`.${pathname}`));
    if (!filePath.startsWith(`${ROOT}${sep}`)) {
      response.writeHead(403);
      response.end();
      return;
    }
    try {
      const body = await readFile(filePath);
      response.writeHead(200, { 'content-type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  return new Promise((resolveServer) => {
    server.listen(0, '127.0.0.1', () => {
      resolveServer({ server, origin: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MEASUREMENT
// ─────────────────────────────────────────────────────────────────────────────

/** Nordic readout ('+18.0', ' 0.0', '−5.0', ' −∞') to dB on the PPM scale. */
function nordicDb(text) {
  const normalised = text.trim().replace('−', '-');
  return normalised.includes('∞') ? -Infinity : Number.parseFloat(normalised);
}

/** BBC readout ('8.5', '−∞') to dBFS: 4 dB per division, PPM 4 at −18 dBFS. */
function bbcDb(text) {
  const normalised = text.trim().replace('−', '-');
  return normalised.includes('∞') ? -Infinity : (Number.parseFloat(normalised) - 4) * 4 - 18;
}

/** Sample Peak readout ('−0.0', '−20.5', ' −∞') to dBFS. */
function samplePeakDb(text) {
  const normalised = text.trim().replace('\u2212', '-');
  return normalised.includes('∞') ? -Infinity : Number.parseFloat(normalised);
}

/**
 * Time between the first reading at or below `steady − 2` dB after the stop
 * and the first at or below `steady − 2 − span` dB.
 */
function fallTime(frames, stopTime, steady, span) {
  const after = frames.filter((frame) => frame.t >= stopTime);
  const start = after.find((frame) => frame.value <= steady - 2);
  const end = after.find((frame) => start && frame.t > start.t && frame.value <= steady - 2 - span);
  return start && end ? (end.t - start.t) / 1000 : NaN;
}

/**
 * Play the tone, stop it and record both readouts on every frame.
 */
async function recordReturn(page) {
  await page.click('#btnModeGenerator');
  await page.selectOption('#genPreset', 'isp-none');
  await page.click('#btnStartCapture');
  await page.waitForTimeout(1500);

  return page.evaluate(async () => {
    const frames = [];
    let recording = true;
    const record = () => {
      frames.push({
        t: performance.now(),
        nordic: document.getElementById('nordicLVal')?.textContent ?? '',
        bbc: document.getElementById('bbcLVal')?.textContent ?? '',
        samplePeak: document.getElementById('spLVal')?.textContent ?? ''
      });
      if (recording) requestAnimationFrame(record);
    };
    requestAnimationFrame(record);

    await new Promise((done) => setTimeout(done, 300));
    const stopTime = performance.now();
    document.getElementById('btnStopCapture').click();
    await new Promise((done) => setTimeout(done, 4200));
    recording = false;
    return { frames, stopTime };
  });
}

/**
 * Check both return times of one run.
 */
function assessRun(label, { frames, stopTime }) {
  const before = frames.filter((frame) => frame.t < stopTime);
  const steadyNordic = nordicDb(before.at(-1).nordic);
  const steadyBbc = bbcDb(before.at(-1).bbc);
  info(`${label}: ${frames.length} frames; steady Nordic ${before.at(-1).nordic.trim()} PPM, BBC ${before.at(-1).bbc.trim()}`);

  check(`${label}: 0 dBFS tone reads full scale on the Nordic PPM (+18)`, steadyNordic === 18, `${steadyNordic}`);
  check(`${label}: 0 dBFS tone reads PPM 8.5 on the BBC PPM`, Math.abs(steadyBbc) <= 0.4, `${steadyBbc.toFixed(1)} dBFS`);

  const nordicFrames = frames.map((frame) => ({ t: frame.t, value: nordicDb(frame.nordic) }));
  const bbcFrames = frames.map((frame) => ({ t: frame.t, value: bbcDb(frame.bbc) }));
  const nordicFall = fallTime(nordicFrames, stopTime, steadyNordic, 20);
  const bbcFall = fallTime(bbcFrames, stopTime, steadyBbc, 24);

  check(`${label}: displayed Nordic PPM falls 20 dB in 1.7 s ±0.3 s`, Math.abs(nordicFall - 1.7) <= 0.3,
    `${nordicFall.toFixed(2)} s`);
  check(`${label}: displayed BBC PPM falls 24 dB in 2.8 s ±0.3 s`, Math.abs(bbcFall - 2.8) <= 0.3,
    `${bbcFall.toFixed(2)} s`);

  const steadySamplePeak = samplePeakDb(before.at(-1).samplePeak);
  const samplePeakFrames = frames.map((frame) => ({ t: frame.t, value: samplePeakDb(frame.samplePeak) }));
  const samplePeakFall = fallTime(samplePeakFrames, stopTime, steadySamplePeak, 20);
  check(`${label}: displayed Sample Peak reads the 0 dBFS tone`, Math.abs(steadySamplePeak) <= 0.05,
    `${before.at(-1).samplePeak.trim()} dBFS`);
  check(`${label}: displayed Sample Peak falls 20 dB in 1.7 s ±0.3 s`, Math.abs(samplePeakFall - 1.7) <= 0.3,
    `${samplePeakFall.toFixed(2)} s`);
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────────

const { server, origin } = await startServer();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--autoplay-policy=no-user-gesture-required']
});

try {
  for (const run of [
    { label: 'AudioWorklet', mode: 'AudioWorklet', blockSampler: false },
    { label: 'Analyser fallback', mode: 'Unavailable', blockSampler: true }
  ]) {
    console.log(`\n--- ${run.label} ---`);
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    if (run.blockSampler) {
      await page.route('**/src/audio/stereo-sampler.js*', (route) => route.abort());
    }

    await page.goto(`${origin}/index.html`);
    await page.waitForFunction((mode) => document.getElementById('stereoSyncMode')?.textContent === mode, run.mode);
    assessRun(run.label, await recordReturn(page));
    check(`${run.label}: no page errors`, pageErrors.length === 0, pageErrors[0] ?? 'none');
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log('\n' + '═'.repeat(50));
console.log(`Results: ${GREEN}${passed} passed${RESET}, ${RED}${failed} failed${RESET}`);
console.log('═'.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
