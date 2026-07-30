/**
 * Broker URL Resolution Test
 *
 * `resolveBrokerUrl` decides, from the hostname alone, where the app should dial
 * its metrics broker. It is pure, so it can be exercised directly without a DOM.
 *
 * The cases below pin the two properties that matter operationally:
 *   - a host must map to the production broker only if it genuinely IS that host,
 *     not merely if it contains the right characters somewhere;
 *   - an unknown host must yield null rather than a loopback address, so callers
 *     can report "no broker configured" instead of silently failing to connect.
 */

import { resolveBrokerUrl } from '../src/remote/broker-url.js';

const PRODUCTION = 'wss://broker.thast.live';
const DEV = 'ws://localhost:8765';

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

function expect(hostname, expected) {
  const actual = resolveBrokerUrl(hostname);
  test(
    `${JSON.stringify(hostname)} → ${expected === null ? 'null' : expected}`,
    actual === expected
  );
  if (actual !== expected) {
    console.log(`       got: ${actual === null ? 'null' : actual}`);
  }
}

console.log('\n\x1b[1mBroker URL Resolution Tests\x1b[0m');
console.log('═'.repeat(50));

// --- Known production hosts -------------------------------------------------
console.log('\n--- Known hosts resolve to the production broker ---');
expect('tsg.thast.live', PRODUCTION);
expect('vero-baambi.pages.dev', PRODUCTION);
expect('xn--thst-roa.se', PRODUCTION);
expect('tsg.xn--thst-roa.se', PRODUCTION);

// Cloudflare Pages gives every deployment its own preview subdomain.
console.log('\n--- Pages preview deployments ---');
expect('abc12345.vero-baambi.pages.dev', PRODUCTION);
expect('feature-branch.vero-baambi.pages.dev', PRODUCTION);

// Hostnames are case-insensitive; browsers normally lower-case them, but the
// resolver must not depend on that.
console.log('\n--- Case insensitivity ---');
expect('TSG.THAST.LIVE', PRODUCTION);
expect('VERO-BAAMBI.pages.dev', PRODUCTION);

// --- Look-alike hosts must NOT resolve --------------------------------------
// These are the cases the previous substring matching got wrong. Each one
// contains a known host as a substring but is controlled by somebody else.
console.log('\n--- Look-alike hosts must not resolve ---');
expect('xn--thst-roa.se.attacker.example', null);
expect('vero-baambi.pages.dev.attacker.example', null);
expect('tsg.thast.live.attacker.example', null);
expect('notvero-baambi.pages.dev', null);
expect('evil-vero-baambi.pages.dev.evil.test', null);
expect('vero-baambi.pages.dev.evil', null);
expect('myxn--thst-roa.se', null);

// A bare suffix match without the leading dot would wrongly accept these.
expect('faketsg.thast.live', null);
expect('somethingthast.live', null);

// The old predicate matched any host containing both 'vero-baambi' and
// 'pages.dev' in any order or position.
expect('pages.dev.vero-baambi.evil.example', null);

// --- Dead clause: the Unicode U-label can never appear -----------------------
// location.hostname always reports the punycode A-label. The old code tested for
// the literal 'thåst.se', which could therefore never fire. Should anything ever
// hand us the U-label, it is simply not a known host.
console.log('\n--- Unicode U-label is not a configured host ---');
expect('thåst.se', null);
expect('tsg.thåst.se', null);

// --- Genuine development hosts ----------------------------------------------
console.log('\n--- Development hosts fall back to loopback ---');
expect('localhost', DEV);
expect('127.0.0.1', DEV);
expect('::1', DEV);
expect('[::1]', DEV);
expect('studio-mac.local', DEV);
expect('app.localhost', DEV);

// --- Unknown hosts yield null, not a loopback guess -------------------------
console.log('\n--- Unknown hosts yield null ---');
expect('example.com', null);
expect('192.168.1.50', null);
expect('some-other-host.pages.dev', null);
// Look-alikes of the dev names must not be treated as local either.
expect('localhost.attacker.example', null);
expect('notlocalhost', null);
expect('127.0.0.1.attacker.example', null);

// --- Malformed input --------------------------------------------------------
console.log('\n--- Malformed input yields null ---');
expect('', null);
expect('   ', null);
expect(undefined, null);
expect(null, null);
test('number input → null', resolveBrokerUrl(42) === null);
test('object input → null', resolveBrokerUrl({}) === null);

// --- Determinism ------------------------------------------------------------
// Same input, same output — the resolver holds no state between calls.
console.log('\n--- Determinism ---');
test(
  'Repeated calls agree',
  resolveBrokerUrl('tsg.thast.live') === resolveBrokerUrl('tsg.thast.live')
);
test(
  'Never returns a loopback URL for a production host',
  resolveBrokerUrl('vero-baambi.pages.dev') !== DEV
);

// --- Summary ----------------------------------------------------------------
console.log('\n' + '═'.repeat(50));
console.log(`Results: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
console.log('═'.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
