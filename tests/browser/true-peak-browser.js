/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * VERO-BAAMBI True-Peak Browser Verification
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Run: npm run test:browser
 *
 * Drives the real Web Audio pipeline in a headless browser and checks what the
 * Node tests cannot: the AudioWorklet running in a browser's audio thread,
 * real-time delivery to a main thread that stalls, and the application itself.
 *
 *   1. Offline rendering: the stereo-sampler worklet, loaded by the real
 *      sampler module, must report the same true peak as TruePeakDetector,
 *      bit for bit, at 44.1, 48, 96 and 192 kHz.
 *   2. Real time: EBU Tech 3341 cases 15 to 23 through an AudioContext while
 *      the main thread is blocked for one second across the signal (the
 *      fs/4 period of cases 20 to 23 falls inside the stall). TPmax from the
 *      sample-complete feed must meet the +0.2/−0.4 dB tolerance and cover
 *      every rendered sample. The analyser-window reading of the same run is
 *      printed for comparison.
 *   3. Application: the four Intersample Peak Demo presets through the
 *      generator, the measure loop and the TPmax display.
 *   4. Application: the built-in Meter Verification Tool must pass.
 *   5. Remote chain: the probe page through a local broker into the
 *      application's remote mode; then a scripted probe whose level drops,
 *      where the received TPmax must hold while the bar follows the level,
 *      a switch to a second probe, which must start a new TPmax, and that
 *      probe going offline, which must clear the displays without errors.
 *
 * Engines: BROWSER=chromium (default), firefox or webkit, the engine behind
 * Safari. Requirements: the playwright-core dev dependency and the engine's
 * Playwright build (npx playwright-core install chromium firefox webkit), or
 * CHROMIUM_PATH pointing at a Chromium or Chrome executable.
 *
 * @module tests/browser/true-peak-browser
 * @see EBU Tech 3341 Table 1, cases 15–23
 * @see ITU-R BS.1770-4 Annex 2
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright-core';
import { WebSocket } from 'ws';

// ─────────────────────────────────────────────────────────────────────────────
// TEST UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

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

/**
 * EBU Tech 3341 Table 1 tolerance for the true-peak cases.
 */
function withinEbuTolerance(readingDb, expectedDb) {
  return readingDb <= expectedDb + 0.2 && readingDb >= expectedDb - 0.4;
}

function assertEbu(name, readingDb, expectedDb) {
  check(name, withinEbuTolerance(readingDb, expectedDb),
    `${readingDb.toFixed(3)} dBTP (expected ${expectedDb.toFixed(2)} +0.2/−0.4 dBTP)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// STATIC SERVER (project root, loopback only)
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

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

/** Minimal page on the served origin, used as a context for module imports. */
const BLANK_PAGE = '<!doctype html><meta charset="utf-8"><title>true-peak harness</title>';

/**
 * Serve the project directory on an ephemeral loopback port.
 *
 * @returns {Promise<{server: import('node:http').Server, origin: string}>}
 */
function startServer() {
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/__blank') {
      response.writeHead(200, { 'content-type': MIME_TYPES['.html'] });
      response.end(BLANK_PAGE);
      return;
    }

    const filePath = resolve(ROOT, normalize(`.${pathname}`));
    if (!filePath.startsWith(ROOT) && `${filePath}${sep}` !== ROOT) {
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
// 1. OFFLINE RENDERING: WORKLET AGAINST TruePeakDetector
// ─────────────────────────────────────────────────────────────────────────────

async function testOfflineWorklet(page) {
  console.log('\n--- 1. Offline rendering: stereo-sampler worklet in the browser against TruePeakDetector ---');

  const results = await page.evaluate(async () => {
    const tp = await import('/src/metering/true-peak.js');
    const signals = await import('/tests/fixtures/tech3341-signals.js');
    const sampler = await import('/src/audio/stereo-sampler.js');

    const runs = [];
    for (const rate of [44100, 48000, 96000, 192000]) {
      const [, case16, , , case19] = signals.tech3341SineCases(rate);
      const inputs = [
        { name: 'case 16 geometry', ...signals.stereoSine({ sampleRate: rate, ...case16 }) },
        { name: 'case 19 geometry', ...signals.stereoSine({ sampleRate: rate, ...case19 }) },
        { name: 'case 22 geometry', ...signals.tech3341Case20(rate, 2) }
      ];

      for (const { name, left, right } of inputs) {
        const context = new OfflineAudioContext(2, left.length, rate);
        const buffer = context.createBuffer(2, left.length, rate);
        buffer.copyToChannel(left, 0);
        buffer.copyToChannel(right, 1);
        const source = context.createBufferSource();
        source.buffer = buffer;
        const splitter = context.createChannelSplitter(2);
        const tapL = context.createGain();
        const tapR = context.createGain();
        source.connect(splitter);
        // The destination records what the source actually rendered: WebKit
        // occasionally renders a buffer at 96 or 192 kHz with samples that
        // differ from the buffer's own, so the reference follows the render
        source.connect(context.destination);
        splitter.connect(tapL, 0);
        splitter.connect(tapR, 1);

        const mode = await sampler.initStereoSampler(context, tapL, tapR);
        sampler.consumeTruePeaks();
        source.start();
        const rendered = await context.startRendering();

        // Rendering runs in whole 128-frame quanta, so the worklet also sees the
        // zeros that complete the last quantum. Reports cover whole intervals;
        // wait until every complete report has arrived.
        const renderedFrames = Math.ceil(left.length / 128) * 128;
        const interval = Math.max(128, Math.round((rate * 0.01) / 128) * 128);
        const expectedSamples = Math.floor(renderedFrames / interval) * interval;
        const deadline = performance.now() + 5000;
        while (sampler.getSamplerStats().truePeakSamples < expectedSamples && performance.now() < deadline) {
          await new Promise((wake) => setTimeout(wake, 10));
        }

        // Reference: the samples the worklet received, through TruePeakDetector
        const stream = new Float32Array(renderedFrames);
        stream.set(rendered.getChannelData(0));
        const renderAltered = stream.subarray(0, left.length).some((sample, i) => sample !== left[i]);
        const reported = sampler.consumeTruePeaks();
        const reference = new tp.TruePeakDetector(rate).process(stream.subarray(0, expectedSamples));
        runs.push({
          rate,
          name,
          mode,
          identical: reported.left === reference && reported.right === reference,
          readingDb: tp.amplitudeToDbTP(reported.left),
          samples: reported.samples,
          expectedSamples,
          renderAltered
        });
        sampler.disposeStereoSampler();
      }
    }
    return runs;
  });

  for (const run of results) {
    check(`${(run.rate / 1000).toFixed(1)} kHz, ${run.name}: ${run.mode} report identical to TruePeakDetector`,
      run.mode === 'worklet' && run.identical && run.samples === run.expectedSamples,
      `${run.readingDb.toFixed(4)} dBTP over ${run.samples} of ${run.expectedSamples} reported samples`);
    if (run.renderAltered) info('the browser rendered this buffer with samples of its own; the reference follows the render');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. REAL TIME: EBU CASES ACROSS A MAIN-THREAD STALL
// ─────────────────────────────────────────────────────────────────────────────

async function testRealTimeStall(page) {
  console.log('\n--- 2. Real time: EBU Tech 3341 cases 15–23 with the main thread blocked for 1 s ---');

  const results = await page.evaluate(async () => {
    const tp = await import('/src/metering/true-peak.js');
    const signals = await import('/tests/fixtures/tech3341-signals.js');
    const sampler = await import('/src/audio/stereo-sampler.js');

    const rate = 48000;
    const context = new AudioContext({ sampleRate: rate });
    await context.resume();

    const splitter = context.createChannelSplitter(2);
    const tapL = context.createGain();
    const tapR = context.createGain();
    splitter.connect(tapL, 0);
    splitter.connect(tapR, 1);
    const analyserL = context.createAnalyser();
    const analyserR = context.createAnalyser();
    analyserL.fftSize = 4096;
    analyserR.fftSize = 4096;
    tapL.connect(analyserL);
    tapR.connect(analyserR);
    const mode = await sampler.initStereoSampler(context, tapL, tapR);

    const windowL = new Float32Array(4096);
    const windowR = new Float32Array(4096);
    const pause = (ms) => new Promise((wake) => setTimeout(wake, ms));

    const cases = [
      ...signals.tech3341SineCases(rate).map((spec) => ({ id: spec.id, expectedDb: spec.expectedDb, ...signals.stereoSine({ sampleRate: rate, ...spec }) })),
      ...[0, 1, 2, 3].map((offset) => ({ id: 20 + offset, expectedDb: 0.0, ...signals.tech3341Case20(rate, offset) }))
    ];

    const runs = [];
    for (const { id, expectedDb, left, right } of cases) {
      const buffer = context.createBuffer(2, left.length, rate);
      buffer.copyToChannel(left, 0);
      buffer.copyToChannel(right, 1);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(splitter);

      const sampleComplete = new tp.TruePeakMeter({ sampleRate: rate });
      const analyserWindow = new tp.TruePeakMeter({ sampleRate: rate });
      await pause(100);
      sampler.consumeTruePeaks();

      // Consumer as in the application: one update per animation frame
      let running = true;
      const frame = () => {
        if (!running) return;
        const peaks = sampler.consumeTruePeaks();
        sampleComplete.updateFromPeaks(peaks.left, peaks.right);
        analyserL.getFloatTimeDomainData(windowL);
        analyserR.getFloatTimeDomainData(windowR);
        analyserWindow.update(windowL, windowR);
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);

      const framesBefore = Math.round(context.currentTime * rate);
      const samplesBefore = sampler.getSamplerStats().truePeakSamples;
      const startAt = context.currentTime + 0.3;
      const ended = new Promise((done) => { source.onended = done; });
      source.start(startAt);

      // Block the main thread for one second centred on the middle of the
      // signal, where the fs/4 period of cases 20 to 23 lies
      const middle = startAt + left.length / rate / 2;
      while (context.currentTime < middle - 0.5) await pause(5);
      const blockUntil = performance.now() + 1000;
      while (performance.now() < blockUntil) { /* deliberate stall */ }

      await ended;
      await pause(300);
      running = false;
      const rest = sampler.consumeTruePeaks();
      sampleComplete.updateFromPeaks(rest.left, rest.right);

      const framesRendered = Math.round(context.currentTime * rate) - framesBefore;
      const samplesMeasured = sampler.getSamplerStats().truePeakSamples - samplesBefore;
      runs.push({
        id,
        expectedDb,
        sampleCompleteDb: sampleComplete.getState().dbtpMaxLeft,
        analyserWindowDb: analyserWindow.getState().dbtpMaxLeft,
        coverageGap: Math.abs(framesRendered - samplesMeasured)
      });
      source.disconnect();
    }

    await context.close();
    sampler.disposeStereoSampler();
    return { mode, runs };
  });

  check('Sampler mode in a real-time AudioContext', results.mode === 'worklet', results.mode);
  for (const run of results.runs) {
    assertEbu(`Case ${run.id}, TPmax across a 1 s main-thread stall`, run.sampleCompleteDb, run.expectedDb);
    check(`Case ${run.id}, every rendered sample measured`, run.coverageGap <= 2048,
      `difference ${run.coverageGap} samples, within one report interval and render latency`);
    info(`analyser-window reading of the same run: ${run.analyserWindowDb.toFixed(3)} dBTP`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. APPLICATION: INTERSAMPLE PEAK DEMO PRESETS
// ─────────────────────────────────────────────────────────────────────────────

async function testApplicationPresets(page, origin) {
  console.log('\n--- 3. Application: Intersample Peak Demo presets through generator, measure loop and display ---');

  await page.goto(`${origin}/index.html`);
  await page.waitForFunction(() => document.getElementById('stereoSyncMode')?.textContent === 'AudioWorklet');
  await page.click('#btnModeGenerator');

  // Physical true peak of each preset: amplitude 0 dBFS, or √2 for the
  // +1, +1, −1, −1 pattern
  const presets = [
    { value: 'isp-none', truthDb: 0.0, samplePeakDb: 0.0 },
    { value: 'isp-mild', truthDb: 0.0, samplePeakDb: 20 * Math.log10(Math.sin((67.5 * Math.PI) / 180)) },
    { value: 'isp-moderate', truthDb: 0.0, samplePeakDb: 20 * Math.log10(Math.sin(Math.PI / 3)) },
    { value: 'isp-max', truthDb: 20 * Math.log10(Math.SQRT2), samplePeakDb: 0.0 }
  ];

  for (const preset of presets) {
    // Selecting a preset switches a running generator; start it the first time
    await page.selectOption('#genPreset', preset.value);
    if (await page.isEnabled('#btnStartCapture')) {
      await page.click('#btnStartCapture');
    }
    await page.waitForTimeout(500);
    // Reset after the preset switch so its onset transient is not included
    await page.click('#r128Reset');
    await page.waitForTimeout(4000);

    const reading = await page.evaluate(async () => {
      const { meterState } = await import('/src/app/meter-state.js');
      return {
        text: document.getElementById('r128TpMax')?.textContent.trim(),
        left: meterState.tpMaxL,
        right: meterState.tpMaxR
      };
    });
    const displayed = parseFloat(reading.text);
    assertEbu(`${preset.value}: TPmax (truth ${preset.truthDb.toFixed(2)} dBTP, sample peak ${preset.samplePeakDb.toFixed(2)} dBFS)`,
      Math.max(reading.left, reading.right), preset.truthDb);
    check(`${preset.value}: display shows the measured TPmax`,
      Math.abs(displayed - Math.max(reading.left, reading.right)) <= 0.051, `"${reading.text}"`);
  }

  await page.click('#btnStopCapture');
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. APPLICATION: BUILT-IN METER VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────

async function testApplicationVerification(page, origin) {
  console.log('\n--- 4. Application: Meter Verification Tool ---');

  await page.goto(`${origin}/index.html`);
  await page.waitForFunction(() => document.getElementById('stereoSyncMode')?.textContent === 'AudioWorklet');
  await page.click('#verifyBadgeBtn');
  await page.click('text=Start Verification');
  await page.waitForFunction(
    () => /tests passed|failed/i.test(document.querySelector('.verify-summary')?.textContent ?? ''),
    null,
    { timeout: 180000 }
  );

  const rows = await page.evaluate(() => [...document.querySelectorAll('.verify-test')]
    .map((row) => row.textContent.replace(/\s+/g, ' ').trim()));
  for (const row of rows) info(row);
  const summary = await page.evaluate(() => document.querySelector('.verify-summary')?.textContent.replace(/\s+/g, ' ').trim());
  check('All built-in verification tests pass', /all \d+ tests passed/i.test(summary ?? ''), summary);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. REMOTE CHAIN: PROBE → BROKER → APPLICATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find a free loopback TCP port.
 */
function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

/**
 * Start the metrics broker on its own port and wait for its health check.
 */
async function startBroker() {
  const port = await freePort();
  const broker = spawn(process.execPath, ['broker/server.js'], {
    cwd: ROOT,
    env: { ...process.env, BROKER_PORT: String(port) },
    stdio: 'ignore'
  });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return { broker, url: `ws://127.0.0.1:${port}` };
    } catch {
      // Broker still starting
    }
    await new Promise((wake) => setTimeout(wake, 100));
  }
  broker.kill();
  throw new Error('Metrics broker did not start');
}

/**
 * Open the application in remote mode, subscribed to the given probe.
 */
async function openRemoteApplication(browser, origin, brokerUrl, probeSelector) {
  const app = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  app.setDefaultTimeout(60000);
  // Receiver listeners catch and log their own exceptions, so a failure in a
  // metrics or probe-list listener surfaces only on the console
  const listenerErrors = [];
  const messages = [];
  app.on('console', (message) => {
    messages.push(message.text());
    if (message.type() === 'error' && /listener error/.test(message.text())) listenerErrors.push(message.text());
  });
  await app.goto(`${origin}/index.html`);
  await app.waitForFunction(() => document.getElementById('stereoSyncMode')?.textContent === 'AudioWorklet');
  await app.click('#btnModeRemote');
  await app.fill('#remoteBrokerUrl', brokerUrl);
  await app.waitForSelector(probeSelector);
  await app.click(probeSelector);
  await app.click('#btnStartCapture');
  return { app, listenerErrors, messages };
}

async function readRemoteTruePeak(app) {
  return app.evaluate(async () => {
    const { meterState } = await import('/src/app/meter-state.js');
    return {
      text: document.getElementById('r128TpMax')?.textContent.trim(),
      bar: meterState.remoteTpL,
      tpMax: Math.max(meterState.tpMaxL, meterState.tpMaxR)
    };
  });
}

async function testRemoteChain(browser, origin) {
  console.log('\n--- 5. Remote chain: probe → broker → application ---');

  const { broker, url } = await startBroker();
  try {
    // 5a. The probe page: 1 kHz at −20 dBFS through its sample-complete feed
    const probe = await browser.newPage();
    probe.setDefaultTimeout(60000);
    await probe.goto(`${origin}/probe.html`);
    await probe.fill('#brokerUrl', url);
    await probe.click('#btnGenerator');
    await probe.selectOption('#genPreset', 'smpte1k');
    await probe.click('#btnStart');

    const remote = await openRemoteApplication(browser, origin, url, '[data-probe-id] input[type=radio]');
    await remote.app.waitForTimeout(3000);
    const received = await readRemoteTruePeak(remote.app);
    const probeDisplay = await probe.evaluate(() => document.getElementById('metricTpMax')?.textContent.trim());
    const probeMode = await probe.evaluate(async () => (await import('/src/audio/stereo-sampler.js')).getSamplingMode());
    check('Probe page measures through the AudioWorklet sampler', probeMode === 'worklet', probeMode);
    assertEbu(`Probe 1 kHz at −20 dBFS received as TPmax (probe shows ${probeDisplay})`, received.tpMax, -20.0);
    check('Received metrics are applied without listener errors', remote.listenerErrors.length === 0,
      remote.listenerErrors[0] ?? 'none');
    await remote.app.close();
    await probe.close();

    // 5b. Scripted probes: A drops from −20 to −40 dBTP, B stays at −30 dBTP
    const levels = new Map([[randomUUID(), -20], [randomUUID(), -30]]);
    const [probeA, probeB] = [...levels.keys()];
    const sockets = [];
    for (const [probeId] of levels) {
      const socket = new WebSocket(url);
      await new Promise((opened, failed) => { socket.once('open', opened); socket.once('error', failed); });
      socket.send(JSON.stringify({ type: 'register', probeId, name: `Scripted ${probeId.slice(0, 4)}`, location: 'test', capabilities: { format: 'rich-v1' } }));
      sockets.push([probeId, socket]);
    }
    const sender = setInterval(() => {
      for (const [probeId, socket] of sockets) {
        const levelDb = levels.get(probeId);
        socket.send(JSON.stringify({
          type: 'metrics',
          payload: {
            probe: { id: probeId, name: `Scripted ${probeId.slice(0, 4)}` },
            timestamp: Date.now(),
            metrics: {
              lufs: { momentary: levelDb - 3, shortTerm: levelDb - 3, integrated: levelDb - 3, lra: null },
              truePeak: { left: levelDb, right: levelDb, max: levelDb }
            }
          }
        }));
      }
    }, 100);

    // Poll from Node: an async predicate in waitForFunction resolves at once
    // in some engines, because the returned Promise itself is truthy
    const waitForBar = async (app, levelDb) => {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        if ((await readRemoteTruePeak(app)).bar === levelDb) return;
        await new Promise((wake) => setTimeout(wake, 50));
      }
      throw new Error(`remote bar never reached ${levelDb} dBTP`);
    };

    try {
      const scripted = await openRemoteApplication(browser, origin, url, `[data-probe-id="${probeA}"] input[type=radio]`);
      await waitForBar(scripted.app, -20);
      levels.set(probeA, -40);
      await scripted.app.waitForTimeout(1000);
      const after = await readRemoteTruePeak(scripted.app);
      check('Bar follows the received level down to −40 dBTP', after.bar === -40, `${after.bar} dBTP`);
      check('TPmax holds −20 dBTP after the level has dropped', after.tpMax === -20 && after.text === '-20.0 dBTP',
        `${after.tpMax} dBTP, display "${after.text}"`);

      await scripted.app.click(`[data-probe-id="${probeB}"] input[type=radio]`);
      await waitForBar(scripted.app, -30);
      await scripted.app.waitForTimeout(300);
      const switched = await readRemoteTruePeak(scripted.app);
      check('Switching probe starts a new TPmax', switched.tpMax === -30 && switched.text === '-30.0 dBTP',
        `${switched.tpMax} dBTP, display "${switched.text}"`);
      check('Received metrics are applied without listener errors', scripted.listenerErrors.length === 0,
        scripted.listenerErrors[0] ?? 'none');

      // 5c. The selected probe goes offline while capture runs
      const indexB = sockets.findIndex(([probeId]) => probeId === probeB);
      const [[, socketB]] = sockets.splice(indexB, 1);
      socketB.close();
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline && !scripted.messages.some((text) => /Remote displays cleared/.test(text))) {
        await new Promise((wake) => setTimeout(wake, 50));
      }
      const offline = await readRemoteTruePeak(scripted.app);
      check('An offline probe clears the displays to the end', scripted.messages.some((text) => /Remote displays cleared/.test(text)),
        `TPmax display "${offline.text}", bar ${offline.bar} dBTP`);
      check('An offline probe leaves TPmax and the bar at rest', offline.text === '--.- dBTP' && offline.bar === -60,
        `display "${offline.text}", bar ${offline.bar} dBTP`);
      check('A probe going offline raises no listener errors', scripted.listenerErrors.length === 0,
        scripted.listenerErrors[0] ?? 'none');
      await scripted.app.close();
    } finally {
      clearInterval(sender);
      for (const [, socket] of sockets) socket.close();
    }
  } finally {
    broker.kill();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────────

console.log(`${BOLD}VERO-BAAMBI True-Peak Browser Verification${RESET}`);
console.log('═══════════════════════════════════════════════════════════════');

/**
 * Launch options per engine: each needs audio to start without a user gesture.
 */
const ENGINES = {
  chromium: () => chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--autoplay-policy=no-user-gesture-required']
  }),
  firefox: () => firefox.launch({
    firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 }
  }),
  webkit: () => webkit.launch()
};

const engineName = (process.env.BROWSER || 'chromium').toLowerCase();
if (!ENGINES[engineName]) {
  console.error(`Unknown BROWSER "${engineName}"; use chromium, firefox or webkit`);
  process.exit(2);
}

const { server, origin } = await startServer();
const browser = await ENGINES[engineName]();

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(180000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  console.log(`${engineName} ${browser.version()}`);

  await page.goto(`${origin}/__blank`);
  await testOfflineWorklet(page);
  await testRealTimeStall(page);
  await testApplicationPresets(page, origin);
  await testApplicationVerification(page, origin);
  await testRemoteChain(browser, origin);

  check('No uncaught page errors', pageErrors.length === 0, pageErrors.join(' | ') || 'none');
} finally {
  await browser.close();
  server.close();
}

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`Results: ${GREEN}${passed} passed${RESET}, ${RED}${failed} failed${RESET}`);
console.log('═══════════════════════════════════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
}
