/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * VERO-BAAMBI Tauri Bridge Test
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Run: node tests/tauri-bridge-test.js
 *
 * The native engine sends its metering as a fixed binary layout. This test
 * builds a packet from the protocol table below, delivers it through a mocked
 * window.__TAURI__ event API, and checks that the bridge hands every field to
 * the application intact. The engine's own tests check the same offsets from
 * the Rust side, so the two cannot drift apart unnoticed.
 *
 * @module tests/tauri-bridge-test
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { initTauriBridge, cleanup } from '../src/bridge/tauri-bridge.js';

let passed = 0;
let failed = 0;

function test(name, condition, detail = '') {
  if (condition) {
    console.log(`\x1b[32m[PASS]\x1b[0m ${name}`);
    passed++;
  } else {
    console.log(`\x1b[31m[FAIL]\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PROTOCOL TABLE (little-endian)
// ─────────────────────────────────────────────────────────────────────────────

const PACKET_SIZE = 4164;
const HEADER_SIZE = 68;
const VIS_SAMPLES = 512;

/** Field, type, offset, value written by this test. Floats are exact in f32. */
const FIELDS = [
  ['lufsM', 'f32', 0, -23],
  ['lufsS', 'f32', 4, -22.5],
  ['lufsI', 'f32', 8, -24.25],
  ['tpLeft', 'f32', 12, -1.5],
  ['tpRight', 'f32', 16, -2.5],
  ['ppmLeft', 'f32', 20, -18],
  ['ppmRight', 'f32', 24, -19],
  ['correlation', 'f32', 28, 0.75],
  ['sampleRate', 'u32', 32, 96000],
  ['bufferSize', 'u32', 36, 256],
  ['timestampUs', 'u64', 40, 0x0102030405060708n],
  ['spLeft', 'f32', 48, -6.5],
  ['spRight', 'f32', 52, -200],
  ['rmsLeft', 'f32', 56, -9.75],
  ['rmsRight', 'f32', 60, -200],
  ['levelFrames', 'u32', 64, 768]
];

function buildPacket() {
  const buffer = new ArrayBuffer(PACKET_SIZE);
  const view = new DataView(buffer);
  for (const [, type, offset, value] of FIELDS) {
    if (type === 'f32') view.setFloat32(offset, value, true);
    else if (type === 'u32') view.setUint32(offset, value, true);
    else view.setBigUint64(offset, value, true);
  }
  for (let i = 0; i < VIS_SAMPLES; i++) {
    view.setFloat32(HEADER_SIZE + i * 4, i / 1024, true);
    view.setFloat32(HEADER_SIZE + (VIS_SAMPLES + i) * 4, -i / 1024, true);
  }
  return new Uint8Array(buffer);
}

// ─────────────────────────────────────────────────────────────────────────────
// MOCKED TAURI EVENT API
// ─────────────────────────────────────────────────────────────────────────────

const listeners = new Map();
globalThis.window = {
  __TAURI__: {
    event: {
      listen: async (name, callback) => {
        listeners.set(name, callback);
        return () => listeners.delete(name);
      }
    }
  }
};

const received = [];
const initialised = await initTauriBridge({ onMeteringUpdate: (data) => received.push(data) });

console.log('\n--- Bridge initialisation ---');
test('initTauriBridge() reports success with an event API present', initialised === true);
test('The bridge listens for metering-bin', listeners.has('metering-bin'));

// Tauri delivers a Vec<u8> payload as an array of numbers; accept both forms
console.log('\n--- Packet fields ---');
const packet = buildPacket();
listeners.get('metering-bin')({ payload: Array.from(packet) });
listeners.get('metering-bin')({ payload: packet });

test('One update per packet', received.length === 2, `got ${received.length}`);

for (const [index, data] of received.entries()) {
  const form = index === 0 ? 'number array' : 'Uint8Array';
  for (const [name, , offset, value] of FIELDS) {
    test(`${form}: ${name} (offset ${offset})`, data[name] === value, `got ${data[name]}, expected ${value}`);
  }

  const { samplesLeft, samplesRight } = data;
  test(
    `${form}: samples are ${VIS_SAMPLES} per channel`,
    samplesLeft.length === VIS_SAMPLES && samplesRight.length === VIS_SAMPLES
  );
  test(
    `${form}: left samples start after the header`,
    samplesLeft[0] === 0 && samplesLeft[1] === 1 / 1024 && samplesLeft[511] === 511 / 1024
  );
  test(
    `${form}: right samples follow the left`,
    samplesRight[1] === -1 / 1024 && samplesRight[511] === -511 / 1024
  );
}

cleanup();
test('cleanup() removes the listener', !listeners.has('metering-bin'));

console.log('\n' + '═'.repeat(50));
console.log(`Results: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
console.log('═'.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
