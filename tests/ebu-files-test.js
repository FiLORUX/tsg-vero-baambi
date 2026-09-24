/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * VERO-BAAMBI True Peak against the official EBU Tech 3341 test files
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Run: npm run test:ebu-files -- <directory>
 *
 * Reads the EBU loudness test set (cases 15 to 23, the true-peak minimum
 * requirements of EBU Tech 3341 Table 1) from a local directory and asserts
 * the +0.2/−0.4 dB tolerance with the shipping ITU-R BS.1770-4 Annex 2
 * detector. The files are not redistributed with this repository; download
 * the set from the EBU and unpack it:
 *
 *   https://tech.ebu.ch/publications/ebu_loudness_test_set
 *
 * Files are matched by the Tech 3341 case number in their name
 * (for example seq-3341-16-24bit.wav). WAV files in 16-, 24- or 32-bit PCM
 * and 32- or 64-bit IEEE float, including WAVE_FORMAT_EXTENSIBLE, are read.
 * Every file is measured as a whole signal at its own sample rate, with the
 * filter drained at the end, exactly as calculateTruePeakStereo() does.
 *
 * @module tests/ebu-files-test
 * @see EBU Tech 3341 Table 1, cases 15–23
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { calculateTruePeakStereo, oversamplingFactor } from '../src/metering/true-peak.js';

// ─────────────────────────────────────────────────────────────────────────────
// EXPECTED READINGS (EBU Tech 3341 Table 1)
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum true-peak level per case, dBTP; tolerance +0.2/−0.4 dB. */
const EXPECTED_DBTP = new Map([
  [15, -6.0], [16, -6.0], [17, -6.0], [18, -6.0], [19, 3.0],
  [20, 0.0], [21, 0.0], [22, 0.0], [23, 0.0]
]);

// ─────────────────────────────────────────────────────────────────────────────
// WAV READER
// ─────────────────────────────────────────────────────────────────────────────

const WAVE_FORMAT_PCM = 0x0001;
const WAVE_FORMAT_IEEE_FLOAT = 0x0003;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

/**
 * Decode a RIFF/WAVE file into one Float64Array per channel.
 *
 * @param {Buffer} bytes - File contents
 * @returns {{ sampleRate: number, channels: Float64Array[], bitsPerSample: number, format: string }}
 */
function decodeWav(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }

  let fmt = null;
  let data = null;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      let formatTag = bytes.readUInt16LE(body);
      if (formatTag === WAVE_FORMAT_EXTENSIBLE && size >= 40) {
        // The sub-format GUID starts with the actual format tag
        formatTag = bytes.readUInt16LE(body + 24);
      }
      fmt = {
        formatTag,
        channelCount: bytes.readUInt16LE(body + 2),
        sampleRate: bytes.readUInt32LE(body + 4),
        blockAlign: bytes.readUInt16LE(body + 12),
        bitsPerSample: bytes.readUInt16LE(body + 14)
      };
    } else if (id === 'data') {
      data = { start: body, length: Math.min(size, bytes.length - body) };
    }
    offset = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('missing fmt or data chunk');

  const { formatTag, channelCount, sampleRate, blockAlign, bitsPerSample } = fmt;
  const frames = Math.floor(data.length / blockAlign);
  const bytesPerSample = bitsPerSample / 8;
  const read = sampleReader(bytes, formatTag, bitsPerSample);
  const channels = Array.from({ length: channelCount }, () => new Float64Array(frames));

  for (let frame = 0; frame < frames; frame++) {
    const base = data.start + frame * blockAlign;
    for (let channel = 0; channel < channelCount; channel++) {
      channels[channel][frame] = read(base + channel * bytesPerSample);
    }
  }

  const format = formatTag === WAVE_FORMAT_IEEE_FLOAT ? 'float' : 'PCM';
  return { sampleRate, channels, bitsPerSample, format };
}

/**
 * Sample reader scaled to full scale = 1.0.
 *
 * @param {Buffer} bytes - File contents
 * @param {number} formatTag - WAVE format tag
 * @param {number} bits - Bits per sample
 * @returns {(offset: number) => number}
 */
function sampleReader(bytes, formatTag, bits) {
  if (formatTag === WAVE_FORMAT_IEEE_FLOAT && bits === 32) return (offset) => bytes.readFloatLE(offset);
  if (formatTag === WAVE_FORMAT_IEEE_FLOAT && bits === 64) return (offset) => bytes.readDoubleLE(offset);
  if (formatTag === WAVE_FORMAT_PCM && bits === 16) return (offset) => bytes.readInt16LE(offset) / 32768;
  if (formatTag === WAVE_FORMAT_PCM && bits === 24) return (offset) => bytes.readIntLE(offset, 3) / 8388608;
  if (formatTag === WAVE_FORMAT_PCM && bits === 32) return (offset) => bytes.readInt32LE(offset) / 2147483648;
  throw new Error(`unsupported WAV format ${formatTag} at ${bits} bits`);
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';

const directory = process.argv[2];
if (!directory) {
  console.error('Usage: npm run test:ebu-files -- <directory containing the EBU loudness test set>');
  process.exit(2);
}

console.log(`${BOLD}VERO-BAAMBI True Peak: official EBU Tech 3341 files${RESET}`);
console.log('═══════════════════════════════════════════════════════════════');
console.log(`Directory: ${directory}\n`);

const names = (await readdir(directory, { recursive: true }))
  .filter((name) => /\.wav$/i.test(name));

let passed = 0;
let failed = 0;

for (const [caseNumber, expectedDb] of EXPECTED_DBTP) {
  const pattern = new RegExp(`3341[-_]${caseNumber}(?!\\d)`);
  const matches = names.filter((name) => pattern.test(name)).sort();
  if (matches.length === 0) {
    console.log(`${RED}[MISSING]${RESET} Case ${caseNumber}: no file matching ${pattern}`);
    failed++;
    continue;
  }

  for (const name of matches) {
    const { sampleRate, channels, bitsPerSample, format } = decodeWav(await readFile(join(directory, name)));
    const [left, right = left] = channels;
    const reading = calculateTruePeakStereo(left, right, sampleRate).max;
    const ok = reading <= expectedDb + 0.2 && reading >= expectedDb - 0.4;
    const detail = `${reading.toFixed(3)} dBTP (expected ${expectedDb.toFixed(1)} +0.2/−0.4) · ` +
      `${sampleRate} Hz ${bitsPerSample}-bit ${format}, ${oversamplingFactor(sampleRate)}× · ${name}`;
    console.log(`${ok ? `${GREEN}[PASS]` : `${RED}[FAIL]`}${RESET} Case ${caseNumber}: ${detail}`);
    if (ok) passed++;
    else failed++;
  }
}

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`Results: ${GREEN}${passed} passed${RESET}, ${RED}${failed} failed${RESET}`);
console.log('═══════════════════════════════════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
}
