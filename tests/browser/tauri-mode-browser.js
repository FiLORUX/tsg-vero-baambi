/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * VERO-BAAMBI Tauri Mode Browser Verification
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Run: npm run test:browser:tauri
 *
 * Loads the application in headless Chromium with a mocked window.__TAURI__
 * and feeds it metering packets in the native engine's binary layout, as the
 * Tauri build does. The engine's level fields describe one signal; the
 * display snapshots in the same packets carry another, spliced at every
 * packet. Every level meter must follow the engine:
 *
 *   1. A steady −18 dBFS sine in the level fields, −40 dBFS spliced
 *      snapshots: Nordic PPM, dBFS (RMS), Sample Peak and True Peak read the
 *      sine, and the page raises no error.
 *   2. A full-scale sample the snapshots never contain: Sample Peak reads it
 *      in full, then returns at the meter's 20 dB in 1.7 s to the tone.
 *   3. A Nordic PPM reading above full scale and one below the scale: the
 *      display clamps as in local metering and shows −∞ for silence.
 *
 * Requirements: the playwright-core dev dependency and a Chromium build
 * (npx playwright-core install chromium), or CHROMIUM_PATH pointing at a
 * Chromium or Chrome executable.
 *
 * @module tests/browser/tauri-mode-browser
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
// MOCKED ENGINE (runs in the page before the application loads)
// ─────────────────────────────────────────────────────────────────────────────

function installMockEngine() {
  const listeners = {};
  window.__TAURI__ = {
    core: {
      invoke: async (command) => (command === 'start_capture'
        ? { backend: 'Mock', device: 'Mock', sampleRate: 48000, bufferSize: 128, latencyMs: 2.67 }
        : null)
    },
    event: {
      listen: async (name, callback) => {
        listeners[name] = callback;
        return () => delete listeners[name];
      }
    }
  };

  window.__engineReady = () => typeof listeners['metering-bin'] === 'function';

  let snapshotSeed = 1;

  /**
   * Send one packet in the engine's layout (4164 bytes). The snapshot is a
   * 997 Hz sine at snapshotDb that starts at an arbitrary phase, so every
   * join with the previous snapshot is a discontinuity.
   */
  function emit({ levelDb, rmsDb, ppmDb, tpDb, spDb, frames, snapshotDb }) {
    const buffer = new ArrayBuffer(4164);
    const view = new DataView(buffer);
    const header = [-21, -21, -21, tpDb, tpDb, ppmDb, ppmDb, 1];
    header.forEach((value, i) => view.setFloat32(i * 4, value, true));
    view.setUint32(32, 48000, true);
    view.setUint32(36, 128, true);
    view.setBigUint64(40, BigInt(Date.now()) * 1000n, true);
    view.setFloat32(48, spDb ?? levelDb, true);
    view.setFloat32(52, spDb ?? levelDb, true);
    view.setFloat32(56, rmsDb, true);
    view.setFloat32(60, rmsDb, true);
    view.setUint32(64, frames, true);

    snapshotSeed = (snapshotSeed * 48271) % 2147483647;
    const phase = (snapshotSeed / 2147483647) * 2 * Math.PI;
    const amplitude = 10 ** (snapshotDb / 20);
    for (let i = 0; i < 512; i++) {
      const sample = amplitude * Math.sin(phase + 2 * Math.PI * 997 * i / 48000);
      view.setFloat32(68 + i * 4, sample, true);
      view.setFloat32(68 + 2048 + i * 4, sample, true);
    }
    listeners['metering-bin']({ payload: new Uint8Array(buffer) });
  }

  /** Send packets about every 8 ms, as the engine's UI thread does. */
  window.__runEngine = async (packets, fields) => {
    for (let i = 0; i < packets; i++) {
      emit(fields);
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 8));
    }
  };

  /** Send packets while recording the Sample Peak readout on every frame. */
  window.__runEngineWatchingSamplePeak = async (sequence) => {
    const readings = [];
    let watching = true;
    const read = () => ({ t: performance.now(), text: document.getElementById('spLVal')?.textContent ?? '' });
    const watch = () => {
      readings.push(read());
      if (watching) requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
    for (const fields of sequence) {
      emit(fields);
      readings.push(read());
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 8));
    }
    watching = false;
    return readings;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Parse a readout such as '−21.0', '+18.0', ' 0.0' or ' −∞'. */
function readoutDb(text) {
  const normalised = (text ?? '').trim().replace('−', '-');
  if (normalised.includes('∞')) return -Infinity;
  return Number.parseFloat(normalised);
}

async function readouts(page) {
  return page.evaluate(() => {
    const text = (id) => document.getElementById(id)?.textContent ?? '';
    return {
      nordicL: text('nordicLVal'), nordicR: text('nordicRVal'),
      dbL: text('dbL'), dbR: text('dbR'),
      spL: text('spLVal'), spR: text('spRVal'),
      tpL: text('tpL'), tpR: text('tpR')
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────────

const { server, origin } = await startServer();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') pageErrors.push(message.text());
});

try {
  await page.addInitScript(installMockEngine);
  await page.goto(`${origin}/index.html`);
  await page.waitForFunction(() => window.__engineReady?.(), null, { timeout: 15000 });

  // A −18 dBFS sine: sample peak −18, RMS −21.03, PPM and true peak −18
  const steady = { levelDb: -18, rmsDb: -18 - 3.0103, ppmDb: -18, tpDb: -18, frames: 384, snapshotDb: -40 };

  console.log('\n--- 1. Level meters follow the engine, not the spliced −40 dBFS snapshots ---');
  // 2.5 s lets the dBFS meter's 300 ms smoothing settle within 0.01 dB
  await page.evaluate((fields) => window.__runEngine(300, fields), steady);
  const steadyRead = await readouts(page);
  for (const [name, left, right, expected] of [
    ['Nordic PPM', steadyRead.nordicL, steadyRead.nordicR, 0],
    ['dBFS (RMS)', steadyRead.dbL, steadyRead.dbR, -21.0],
    ['Sample Peak', steadyRead.spL, steadyRead.spR, -18.0],
    ['True Peak', steadyRead.tpL, steadyRead.tpR, -18.0]
  ]) {
    check(name, readoutDb(left) === expected && readoutDb(right) === expected,
      `L ${left.trim()} R ${right.trim()}, expected ${expected.toFixed(1)}`);
  }

  console.log('\n--- 2. A full-scale sample between two snapshots ---');
  // About 2.4 s of packets: the return from 0 to −18 dBFS takes 1.53 s
  const sequence = [
    { ...steady, spDb: 0 },
    ...Array.from({ length: 280 }, () => steady)
  ];
  const readings = (await page.evaluate((fields) => window.__runEngineWatchingSamplePeak(fields), sequence))
    .map(({ t, text }) => ({ t, value: readoutDb(text) }))
    .filter(({ value }) => Number.isFinite(value));
  const highest = Math.max(...readings.map(({ value }) => value));
  // The return is timed from the peak on: readings taken before the peak
  // reached the display still show the −18 dBFS tone
  const peakIndex = readings.findIndex(({ value }) => value === highest);
  const start = readings.find(({ value }, i) => i > peakIndex && value <= -2);
  const end = readings.find(({ t, value }) => start && t > start.t && value <= -14);
  const fall = start && end ? (end.t - start.t) / 1000 : NaN;
  const last = readings.at(-1).value;
  check('Sample Peak reads the full-scale sample in full', highest === 0,
    `highest reading ${highest.toFixed(1)} dBFS, never contained in a snapshot`);
  check('…falls 12 dB in 1.02 s ±0.15 s (20 dB in 1.7 s)', Math.abs(fall - 12 / (20 / 1.7)) <= 0.15,
    `${fall.toFixed(2)} s from −2 to −14 dBFS`);
  check('…and returns to the tone', Math.abs(last + 18) <= 0.1, `last reading ${last.toFixed(1)} dBFS`);

  console.log('\n--- 3. Nordic PPM clamps to the display range ---');
  await page.evaluate((fields) => window.__runEngine(10, fields), { ...steady, ppmDb: 2.5 });
  const over = await readouts(page);
  check('+2.5 dBFS reads as full scale, +18.0', readoutDb(over.nordicL) === 18,
    `L ${over.nordicL.trim()}`);
  await page.evaluate((fields) => window.__runEngine(10, fields), { ...steady, ppmDb: -75 });
  const quiet = await readouts(page);
  check('−75 dBFS reads as silence', readoutDb(quiet.nordicL) === -Infinity, `L ${quiet.nordicL.trim()}`);

  console.log('\n--- Page errors ---');
  check('The page raised no error in Tauri mode', pageErrors.length === 0,
    pageErrors.length === 0 ? 'none' : pageErrors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server.close();
}

console.log('\n' + '═'.repeat(50));
console.log(`Results: ${GREEN}${passed} passed${RESET}, ${RED}${failed} failed${RESET}`);
console.log('═'.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
