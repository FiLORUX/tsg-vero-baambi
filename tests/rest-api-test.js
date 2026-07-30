/**
 * REST API Test
 * Tests that broker REST endpoints return valid JSON
 */

import http from 'http';
import { initRestApi, handleRequest, updateMetrics } from '../broker/rest-api.js';

const PORT = 18766; // Use high port to avoid conflicts

let server = null;
let passed = 0;
let failed = 0;

function test(name, condition) {
  if (condition) {
    console.log(`\x1b[32m[PASS]\x1b[0m ${name}`);
    passed++;
  } else {
    console.log(`\x1b[31m[FAIL]\x1b[0m ${name}`);
    failed++;
  }
}

/**
 * Issue a GET against the test server.
 *
 * @param {string} path - Request path
 * @param {Object} [headers] - Extra request headers (used to simulate an Origin)
 */
function fetch(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${PORT}${path}`, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: res.headers['content-type']?.includes('application/json')
              ? JSON.parse(data)
              : data
          });
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

async function runTests() {
  console.log('\n\x1b[1mREST API Tests\x1b[0m');
  console.log('═'.repeat(50));

  // Create mock probes map
  const probes = new Map();
  probes.set('probe-1', {
    name: 'Studio A',
    location: 'Main Building',
    lastSeen: Date.now(),
    subscribers: new Set(),
    capabilities: { hasTruePeak: true }
  });
  probes.set('probe-2', {
    name: 'OB Van',
    lastSeen: Date.now() - 60000, // Stale (offline)
    subscribers: new Set()
  });

  // Add mock metrics
  updateMetrics('probe-1', {
    lufs: { momentary: -18.5, shortTerm: -20.1, integrated: -22.3 },
    truePeak: { left: -6.2, right: -7.1 },
    ppm: { left: -12.0, right: -14.0 }
  });

  // Start server (mirrors broker/server.js: shared request handler + state)
  initRestApi({ probes });
  server = http.createServer(handleRequest);
  await new Promise(resolve => server.listen(PORT, resolve));

  try {
    // --- Test: Health endpoint ---
    console.log('\n--- GET /health ---');
    const health = await fetch('/health');
    test('Status 200', health.status === 200);
    test('Response is JSON', typeof health.body === 'object');
    test('ok is true', health.body.ok === true);
    test('Has data.status', health.body.data?.status === 'healthy');
    test('Has data.uptime', typeof health.body.data?.uptime === 'number');
    test('Has data.probes.total', health.body.data?.probes?.total === 2);
    test('Has data.probes.online', typeof health.body.data?.probes?.online === 'number');
    test('Has data.timestamp', typeof health.body.data?.timestamp === 'string');

    // --- Test: Probes list ---
    console.log('\n--- GET /probes ---');
    const probeList = await fetch('/probes');
    test('Status 200', probeList.status === 200);
    test('ok is true', probeList.body.ok === true);
    test('Has data.count', probeList.body.data?.count === 2);
    test('Has data.probes array', Array.isArray(probeList.body.data?.probes));
    test('Probe 1 has id', probeList.body.data?.probes?.find(p => p.id === 'probe-1'));
    test('Probe 1 has name', probeList.body.data?.probes?.find(p => p.name === 'Studio A'));
    test('Probe 1 online', probeList.body.data?.probes?.find(p => p.id === 'probe-1')?.online === true);
    test('Probe 2 offline (stale)', probeList.body.data?.probes?.find(p => p.id === 'probe-2')?.online === false);

    // --- Test: Single probe ---
    console.log('\n--- GET /probes/:id ---');
    const probe1 = await fetch('/probes/probe-1');
    test('Status 200', probe1.status === 200);
    test('ok is true', probe1.body.ok === true);
    test('Has probe.id', probe1.body.data?.probe?.id === 'probe-1');
    test('Has probe.name', probe1.body.data?.probe?.name === 'Studio A');
    test('Has probe.location', probe1.body.data?.probe?.location === 'Main Building');
    test('Has probe.online', probe1.body.data?.probe?.online === true);
    test('Has metrics.lufs', probe1.body.data?.metrics?.lufs !== null);
    test('Has metrics.lufs.integrated', probe1.body.data?.metrics?.lufs?.integrated === -22.3);
    test('Has metrics.truePeak', probe1.body.data?.metrics?.truePeak !== null);

    // --- Test: Probe not found ---
    console.log('\n--- GET /probes/:id (not found) ---');
    const notFound = await fetch('/probes/unknown');
    test('Status 404', notFound.status === 404);
    test('ok is false', notFound.body.ok === false);
    test('Has error message', typeof notFound.body.error === 'string');

    // --- Test: Probe status (in-spec check) ---
    console.log('\n--- GET /probes/:id/status ---');
    const status = await fetch('/probes/probe-1/status?target=-23&tolerance=1&tpLimit=-1');
    test('Status 200', status.status === 200);
    test('ok is true', status.body.ok === true);
    test('Has probeId', status.body.data?.probeId === 'probe-1');
    test('Has online', status.body.data?.online === true);
    test('Has inSpec', typeof status.body.data?.inSpec === 'boolean');
    test('Has current.integratedLufs', status.body.data?.current?.integratedLufs === -22.3);
    test('Has current.truePeakMax', typeof status.body.data?.current?.truePeakMax === 'number');
    test('LUFS in spec (-22.3 within ±1 of -23)', status.body.data?.inSpec === true);

    // --- Test: Probe status (out of spec) ---
    console.log('\n--- GET /probes/:id/status (out of spec) ---');
    const outOfSpec = await fetch('/probes/probe-1/status?target=-23&tolerance=0.5');
    test('Status 200', outOfSpec.status === 200);
    test('Out of spec detected', outOfSpec.body.data?.inSpec === false);
    test('Has violations', Array.isArray(outOfSpec.body.data?.violations));

    // --- Test: Probe status (offline) ---
    console.log('\n--- GET /probes/:id/status (offline) ---');
    const offline = await fetch('/probes/probe-2/status');
    test('Status 200', offline.status === 200);
    test('online is false', offline.body.data?.online === false);
    test('inSpec is null (probe offline)', offline.body.data?.inSpec === null);

    // --- Test: Prometheus metrics ---
    console.log('\n--- GET /metrics ---');
    const metrics = await fetch('/metrics');
    test('Status 200', metrics.status === 200);
    test('Content-Type is text/plain', metrics.headers['content-type']?.includes('text/plain'));
    test('Contains uptime metric', metrics.body.includes('vero_broker_uptime_seconds'));
    test('Contains probes_total metric', metrics.body.includes('vero_broker_probes_total'));
    test('Contains probe online metric', metrics.body.includes('vero_probe_online'));
    test('Contains LUFS metric', metrics.body.includes('vero_probe_lufs_integrated'));
    test('Contains true peak metric', metrics.body.includes('vero_probe_truepeak_max'));

    // --- Test: 404 for unknown route ---
    console.log('\n--- GET /unknown ---');
    const unknown = await fetch('/unknown');
    test('Status 404', unknown.status === 404);
    test('ok is false', unknown.body.ok === false);

    // --- Test: CORS headers ---
    // The REST API exposes probe names, locations and live loudness. A wildcard
    // grant would let any page read that cross-origin, so the grant must be
    // withheld by default and issued only to configured origins.
    console.log('\n--- CORS: no allow-list configured ---');
    delete process.env.VERO_ALLOWED_ORIGINS;

    const unconfigured = await fetch('/health', { Origin: 'https://attacker.example' });
    test('No Access-Control-Allow-Origin by default',
      unconfigured.headers['access-control-allow-origin'] === undefined);
    test('No wildcard grant anywhere',
      unconfigured.headers['access-control-allow-origin'] !== '*');
    test('Vary: Origin present on the refusal path',
      unconfigured.headers['vary']?.includes('Origin'));

    console.log('\n--- CORS: allow-list configured ---');
    process.env.VERO_ALLOWED_ORIGINS = 'https://vero-baambi.pages.dev, https://tsg.thast.live';

    const allowedOrigin = await fetch('/probes', { Origin: 'https://tsg.thast.live' });
    test('Echoes an allowed Origin verbatim',
      allowedOrigin.headers['access-control-allow-origin'] === 'https://tsg.thast.live');
    test('Never echoes a wildcard for an allowed Origin',
      allowedOrigin.headers['access-control-allow-origin'] !== '*');
    test('Vary: Origin present on the grant path',
      allowedOrigin.headers['vary']?.includes('Origin'));
    test('Advertises allowed methods when granting',
      allowedOrigin.headers['access-control-allow-methods']?.includes('GET'));

    const deniedOrigin = await fetch('/probes', { Origin: 'https://attacker.example' });
    test('Withholds grant from an unlisted Origin',
      deniedOrigin.headers['access-control-allow-origin'] === undefined);

    // A suffix or substring comparison would let this through; an exact one does not.
    const lookalike = await fetch('/probes', { Origin: 'https://tsg.thast.live.attacker.example' });
    test('Withholds grant from a look-alike Origin',
      lookalike.headers['access-control-allow-origin'] === undefined);

    const noOrigin = await fetch('/probes');
    test('Withholds grant when no Origin is sent',
      noOrigin.headers['access-control-allow-origin'] === undefined);

    // Preflight must obey the same rule as the actual request.
    const preflightAllowed = await fetch('/probes', { Origin: 'https://vero-baambi.pages.dev' });
    test('Preflight-eligible request grants a listed Origin',
      preflightAllowed.headers['access-control-allow-origin'] === 'https://vero-baambi.pages.dev');

    delete process.env.VERO_ALLOWED_ORIGINS;

  } finally {
    // Cleanup
    server.close();
  }

  // Summary
  console.log('\n' + '═'.repeat(50));
  console.log(`Results: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
  console.log('═'.repeat(50) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test failed:', err);
  if (server) server.close();
  process.exit(1);
});
