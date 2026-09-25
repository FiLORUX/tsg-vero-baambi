/**
 * Tauri Bridge - Native audio backend integration
 *
 * This module provides the bridge between the Tauri Rust backend
 * and the existing JavaScript UI. When running in Tauri, audio
 * metering data comes from the native ASIO/JACK/CoreAudio backend
 * instead of Web Audio API.
 *
 * The UI code remains completely unchanged - this bridge simply
 * provides data through the same interface.
 *
 * Note: Uses window.__TAURI__ global API (withGlobalTauri: true in config)
 * rather than ES module imports which require a bundler.
 *
 * Important: Detection is lazy because __TAURI__ may not be available
 * when top-level scripts execute (Tauri injects it via initialization script).
 */

/**
 * Tauri audio bridge state
 */
const tauriBridge = {
  isActive: false,
  currentBackend: null,
  currentDevice: null,
  sampleRate: null,
  bufferSize: null,
  latencyMs: null,
  callbacks: {},
  // Display-frame pull loop: pending animation frame, and whether a read is
  // on its way (one at a time)
  frameRequest: null,
  readPending: false,
  // Reset generation of the readings being shown; adopted from the first
  // packet, then advanced by resetMeters()
  generation: null,
  // Pre-allocated buffers for binary parsing (avoids GC pressure)
  _samplesLeft: new Float32Array(512),
  _samplesRight: new Float32Array(512),
};

// ─────────────────────────────────────────────────────────────────────────────
// BINARY IPC PROTOCOL
// ─────────────────────────────────────────────────────────────────────────────
// The page pulls one packet per display frame with the read_metering command,
// which answers with raw bytes (an ArrayBuffer, no JSON). A page that falls
// behind reads less often instead of queueing readings, and the engine keeps
// the largest true peak since the previous read, so no peak is lost. An empty
// answer means no new audio block has been measured since the previous read.
//
// Binary format (little-endian, 4168 bytes total):
//   0-3:    lufs_m (f32)
//   4-7:    lufs_s (f32)
//   8-11:   lufs_i (f32)
//   12-15:  tp_left (f32)       largest true peak since the previous packet (dBTP)
//   16-19:  tp_right (f32)      largest true peak since the previous packet (dBTP)
//   20-23:  ppm_left (f32)      Nordic PPM reading (dBFS)
//   24-27:  ppm_right (f32)     Nordic PPM reading (dBFS)
//   28-31:  correlation (f32)
//   32-35:  sample_rate (u32)
//   36-39:  buffer_size (u32)
//   40-47:  timestamp_us (u64)
//   48-51:  sp_left (f32)       largest sample magnitude since the previous packet (dBFS)
//   52-55:  sp_right (f32)      largest sample magnitude since the previous packet (dBFS)
//   56-59:  rms_left (f32)      RMS of the samples since the previous packet (dBFS)
//   60-63:  rms_right (f32)     RMS of the samples since the previous packet (dBFS)
//   64-67:  level_frames (u32)  stereo frames covered by sp_* and rms_*
//   68-71:  generation (u32)    reset generation of every reading in the packet
//   72-2119:   samples_left (512 × f32)
//   2120-4167: samples_right (512 × f32)
//
// Consecutive packets' level fields cover consecutive, non-overlapping runs of
// samples. The sample arrays are the most recent display snapshot, which
// overlaps the previous packet's or leaves a gap after it: they serve
// visualisation, not measurement.
//
// Layout contract: pack_metering_binary() in tsg-vero-baambi-tauri/src-tauri/src/audio/engine.rs
// ─────────────────────────────────────────────────────────────────────────────

const BINARY_HEADER_SIZE = 72;
const VIS_SAMPLES = 512;

/**
 * Parse binary metering data from Rust backend.
 * Zero-copy for sample arrays (views into the buffer).
 *
 * @param {ArrayBuffer|Uint8Array} data - Raw packet from read_metering
 * @returns {Object} Parsed metering data
 */
function parseBinaryMeteringData(data) {
  // Handle both ArrayBuffer and Uint8Array
  const buffer = data instanceof ArrayBuffer ? data : data.buffer;
  const view = new DataView(buffer);

  // Header values
  const lufsM = view.getFloat32(0, true);
  const lufsS = view.getFloat32(4, true);
  const lufsI = view.getFloat32(8, true);
  const tpLeft = view.getFloat32(12, true);
  const tpRight = view.getFloat32(16, true);
  const ppmLeft = view.getFloat32(20, true);
  const ppmRight = view.getFloat32(24, true);
  const correlation = view.getFloat32(28, true);
  const sampleRate = view.getUint32(32, true);
  const bufferSize = view.getUint32(36, true);

  // Timestamp for latency measurement (BigInt for u64)
  const timestampUs = view.getBigUint64(40, true);

  // Sample peak and RMS of every sample since the previous packet
  const spLeft = view.getFloat32(48, true);
  const spRight = view.getFloat32(52, true);
  const rmsLeft = view.getFloat32(56, true);
  const rmsRight = view.getFloat32(60, true);
  const levelFrames = view.getUint32(64, true);

  // Reset generation the readings belong to
  const generation = view.getUint32(68, true);

  // Sample arrays - create views directly into buffer (zero-copy)
  const samplesLeft = new Float32Array(buffer, BINARY_HEADER_SIZE, VIS_SAMPLES);
  const samplesRight = new Float32Array(buffer, BINARY_HEADER_SIZE + VIS_SAMPLES * 4, VIS_SAMPLES);

  return {
    lufsM,
    lufsS,
    lufsI,
    tpLeft,
    tpRight,
    ppmLeft,
    ppmRight,
    correlation,
    sampleRate,
    bufferSize,
    timestampUs,
    spLeft,
    spRight,
    rmsLeft,
    rmsRight,
    levelFrames,
    generation,
    samplesLeft,
    samplesRight,
  };
}

/**
 * Check if running in Tauri (lazy check)
 * @returns {boolean} True if running in Tauri
 */
export function isTauri() {
  return typeof window !== 'undefined' && window.__TAURI__ !== undefined;
}

/**
 * Get Tauri core API from global
 */
function getTauriCore() {
  return window.__TAURI__?.core;
}

/**
 * Pass a packet to the meters, unless it was measured before the latest reset.
 *
 * @param {ArrayBuffer} body - Raw packet from read_metering
 */
function deliverMetering(body) {
  const data = parseBinaryMeteringData(body);

  // After a reset, a packet measured before it may still be on its way;
  // only readings of the current generation reach the meters
  tauriBridge.generation ??= data.generation;
  if (data.generation !== tauriBridge.generation) return;

  tauriBridge.callbacks.onMeteringUpdate?.(data);

  // Also expose via global for compatibility
  window.updateMetersFromTauri?.(data);
}

/**
 * Read the newest packet once per display frame, one read at a time.
 */
function pumpMetering() {
  if (!tauriBridge.isActive) return;
  tauriBridge.frameRequest = requestAnimationFrame(pumpMetering);
  if (tauriBridge.readPending) return;

  tauriBridge.readPending = true;
  getTauriCore().invoke('read_metering')
    .then((body) => {
      if (body?.byteLength) deliverMetering(body);
    })
    .catch((error) => console.error('[TauriBridge] Metering read failed:', error))
    .finally(() => {
      tauriBridge.readPending = false;
    });
}

/**
 * Initialise the Tauri bridge if running in Tauri environment
 *
 * @param {Object} callbacks - Callbacks for metering updates
 * @param {Function} callbacks.onMeteringUpdate - Called with metering data
 * @param {Function} callbacks.onStatusChange - Called when backend changes
 * @returns {boolean} True if Tauri bridge was initialised
 */
export async function initTauriBridge(callbacks = {}) {
  if (!isTauri()) {
    return false;
  }

  console.log('[TauriBridge] Initialising native audio bridge (binary pull per display frame)');

  if (!getTauriCore()) {
    console.error('[TauriBridge] Tauri core API not available');
    return false;
  }

  tauriBridge.callbacks = callbacks;
  tauriBridge.isActive = true;
  tauriBridge.frameRequest = requestAnimationFrame(pumpMetering);

  console.log('[TauriBridge] Native audio bridge ready');
  return true;
}

/**
 * List available audio input devices
 *
 * @returns {Promise<string[]>} List of device names
 */
export async function listAudioDevices() {
  if (!isTauri()) {
    return [];
  }

  const tauriCore = getTauriCore();
  if (!tauriCore) {
    console.error('[TauriBridge] Tauri core API not available');
    return [];
  }

  return tauriCore.invoke('list_audio_devices');
}

/**
 * Start audio capture with native backend
 *
 * @param {Object} options - Capture options
 * @param {string} options.deviceName - Device to use (null for smart default)
 * @param {number} options.bufferSize - Buffer size in samples (null for device default)
 * @returns {Promise<CaptureInfo>} Capture info with backend, device, sample rate, buffer size, latency
 */
export async function startCapture(options = {}) {
  if (!isTauri()) {
    throw new Error('Not running in Tauri');
  }

  const tauriCore = getTauriCore();
  if (!tauriCore) {
    throw new Error('Tauri core API not available');
  }

  // Stop existing capture first
  await stopCapture();

  const info = await tauriCore.invoke('start_capture', {
    deviceName: options.deviceName || null,
    bufferSize: options.bufferSize || null, // null = let device choose
  });

  // Update bridge state
  tauriBridge.currentBackend = info.backend;
  tauriBridge.currentDevice = info.device;
  tauriBridge.sampleRate = info.sampleRate;
  tauriBridge.bufferSize = info.bufferSize;
  tauriBridge.latencyMs = info.latencyMs;

  console.log(`[TauriBridge] Started capture: ${info.device} via ${info.backend} (${info.sampleRate} Hz, ${info.bufferSize} samples, ${info.latencyMs.toFixed(2)}ms)`);

  return info;
}

/**
 * Stop audio capture
 */
export async function stopCapture() {
  if (!isTauri()) {
    return;
  }

  const tauriCore = getTauriCore();
  if (!tauriCore) {
    console.error('[TauriBridge] Tauri core API not available');
    return;
  }

  await tauriCore.invoke('stop_capture');

  tauriBridge.currentBackend = null;
  console.log('[TauriBridge] Stopped capture');
}

/**
 * Reset the native measurement (the R128 reset).
 *
 * The new generation takes effect at once, before the engine confirms, so
 * packets measured before the reset are dropped even while the request is
 * still on its way to the engine.
 *
 * @returns {Promise<void>}
 */
export async function resetMeters() {
  if (!isTauri()) {
    return;
  }

  const tauriCore = getTauriCore();
  if (!tauriCore) {
    console.error('[TauriBridge] Tauri core API not available');
    return;
  }

  tauriBridge.generation = ((tauriBridge.generation ?? 0) + 1) >>> 0;
  await tauriCore.invoke('reset_meters', { generation: tauriBridge.generation });
}

/**
 * Get current audio status
 *
 * @returns {Promise<string|null>} Current backend name or null if not capturing
 */
export async function getAudioStatus() {
  if (!isTauri()) {
    return null;
  }

  const tauriCore = getTauriCore();
  if (!tauriCore) {
    console.error('[TauriBridge] Tauri core API not available');
    return null;
  }

  return tauriCore.invoke('get_audio_status');
}

/**
 * Clean up Tauri bridge
 */
export function cleanup() {
  if (tauriBridge.frameRequest !== null) {
    cancelAnimationFrame(tauriBridge.frameRequest);
    tauriBridge.frameRequest = null;
  }
  tauriBridge.callbacks = {};
  tauriBridge.isActive = false;
}

/**
 * Check if Tauri bridge is active
 */
export function isActive() {
  return tauriBridge.isActive;
}

/**
 * Get current backend name
 */
export function getCurrentBackend() {
  return tauriBridge.currentBackend;
}

/**
 * Get current device name
 */
export function getCurrentDevice() {
  return tauriBridge.currentDevice;
}

/**
 * Get current capture info
 */
export function getCaptureInfo() {
  return {
    backend: tauriBridge.currentBackend,
    device: tauriBridge.currentDevice,
    sampleRate: tauriBridge.sampleRate,
    bufferSize: tauriBridge.bufferSize,
    latencyMs: tauriBridge.latencyMs,
  };
}

// Legacy export for backwards compatibility
// Use isTauri() function instead for runtime checks
export const IS_TAURI = false; // Will be false at module load time, use isTauri() for runtime
