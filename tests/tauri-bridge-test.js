/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * VERO-BAAMBI Tauri Bridge Test
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Run: node tests/tauri-bridge-test.js
 *
 * The native engine answers the page's read_metering calls with a fixed
 * binary layout. This test builds packets from the protocol table below,
 * serves them through a mocked window.__TAURI__ core API, drives the bridge's
 * per-frame read loop by hand, and checks that every field reaches the
 * application intact. The engine's own tests check the same offsets from the
 * Rust side, so the two cannot drift apart unnoticed.
 *
 * It also checks the transport rules the bridge owns: an empty answer means
 * no new audio, one read is in flight at a time, and after resetMeters()
 * only packets of the new reset generation reach the meters.
 *
 * @module tests/tauri-bridge-test
 * ═══════════════════════════════════════════════════════════════════════════════
 */

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

const PACKET_SIZE = 4168;
const HEADER_SIZE = 72;
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
  ['levelFrames', 'u32', 64, 768],
  ['generation', 'u32', 68, 5]
];

/** A packet from the table, with the reset generation overridden if given. */
function buildPacket(generation = 5) {
  const buffer = new ArrayBuffer(PACKET_SIZE);
  const view = new DataView(buffer);
  for (const [name, type, offset, value] of FIELDS) {
    const written = name === 'generation' ? generation : value;
    if (type === 'f32') view.setFloat32(offset, written, true);
    else if (type === 'u32') view.setUint32(offset, written, true);
    else view.setBigUint64(offset, written, true);
  }
  for (let i = 0; i < VIS_SAMPLES; i++) {
    view.setFloat32(HEADER_SIZE + i * 4, i / 1024, true);
    view.setFloat32(HEADER_SIZE + (VIS_SAMPLES + i) * 4, -i / 1024, true);
  }
  return buffer;
}

// ─────────────────────────────────────────────────────────────────────────────
// MOCKED TAURI CORE API AND DISPLAY FRAMES
// ─────────────────────────────────────────────────────────────────────────────

/** Answers the engine will give, in order; an exhausted queue answers empty. */
const answers = [];
const invocations = [];
let heldRead = null;

globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async (command, args) => {
        invocations.push({ command, args });
        if (command !== 'read_metering') return null;
        if (heldRead) return heldRead.promise;
        return answers.shift() ?? new ArrayBuffer(0);
      }
    }
  }
};

// Display frames run only when the test says so
let frameCallbacks = new Map();
let nextFrameId = 1;
globalThis.requestAnimationFrame = (callback) => {
  frameCallbacks.set(nextFrameId, callback);
  return nextFrameId++;
};
globalThis.cancelAnimationFrame = (id) => frameCallbacks.delete(id);

/** Run one display frame and let the reads it started settle. */
async function frame() {
  const due = [...frameCallbacks.values()];
  frameCallbacks = new Map();
  for (const callback of due) callback(0);
  await new Promise((settle) => setTimeout(settle, 0));
}

const reads = () => invocations.filter(({ command }) => command === 'read_metering').length;

const { initTauriBridge, cleanup, resetMeters } = await import('../src/bridge/tauri-bridge.js');

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

const received = [];
const initialised = await initTauriBridge({ onMeteringUpdate: (data) => received.push(data) });

console.log('\n--- Bridge initialisation ---');
test('initTauriBridge() reports success with a core API present', initialised === true);
test('The bridge schedules its first read for the next display frame', frameCallbacks.size === 1);

console.log('\n--- Packet fields ---');
answers.push(buildPacket());
await frame();
test('One read per display frame', reads() === 1, `got ${reads()}`);
test('One update per packet', received.length === 1, `got ${received.length}`);

const [data] = received;
for (const [name, , offset, value] of FIELDS) {
  test(`${name} (offset ${offset})`, data?.[name] === value, `got ${data?.[name]}, expected ${value}`);
}
test(
  `Samples are ${VIS_SAMPLES} per channel`,
  data?.samplesLeft.length === VIS_SAMPLES && data?.samplesRight.length === VIS_SAMPLES
);
test(
  'Left samples start after the header',
  data?.samplesLeft[0] === 0 && data?.samplesLeft[1] === 1 / 1024 && data?.samplesLeft[511] === 511 / 1024
);
test(
  'Right samples follow the left',
  data?.samplesRight[1] === -1 / 1024 && data?.samplesRight[511] === -511 / 1024
);

console.log('\n--- Transport ---');
await frame();
test('An empty answer (no new audio) updates nothing', received.length === 1, `got ${received.length}`);

let release;
heldRead = { promise: new Promise((resolve) => { release = resolve; }) };
const readsBefore = reads();
await frame();
await frame();
await frame();
test('A slow read is not overtaken: one read in flight', reads() === readsBefore + 1,
  `${reads() - readsBefore} reads during three frames`);
heldRead = null;
release(buildPacket());
await frame();
test('The held read delivers when it completes', received.length === 2, `got ${received.length}`);

console.log('\n--- Reset generations ---');
received.length = 0;
const resetDone = resetMeters();
const request = invocations.findLast(({ command }) => command === 'reset_meters');
test('resetMeters() asks the engine for the next generation', request?.args?.generation === 6,
  `requested ${request?.args?.generation}`);
await resetDone;

answers.push(buildPacket(5));
await frame();
test('A packet measured before the reset is dropped', received.length === 0, `got ${received.length}`);

answers.push(buildPacket(6));
await frame();
test('A packet of the new generation reaches the meters', received.length === 1 && received[0].generation === 6,
  `got ${received.map((packet) => packet.generation).join(', ') || 'none'}`);

console.log('\n--- Cleanup ---');
cleanup();
const readsAtCleanup = reads();
await frame();
test('cleanup() stops the read loop', frameCallbacks.size === 0 && reads() === readsAtCleanup);

console.log('\n' + '═'.repeat(50));
console.log(`Results: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
console.log('═'.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
