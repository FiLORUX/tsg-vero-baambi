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
  listeners: [],
  // Pre-allocated buffers for binary parsing (avoids GC pressure)
  _samplesLeft: new Float32Array(512),
  _samplesRight: new Float32Array(512),
};

// ─────────────────────────────────────────────────────────────────────────────
// BINARY IPC PROTOCOL
// ─────────────────────────────────────────────────────────────────────────────
// Binary format (little-endian, 4144 bytes total):
//   0-3:    lufs_m (f32)
//   4-7:    lufs_s (f32)
//   8-11:   lufs_i (f32)
//   12-15:  tp_left (f32)
//   16-19:  tp_right (f32)
//   20-23:  ppm_left (f32)
//   24-27:  ppm_right (f32)
//   28-31:  correlation (f32)
//   32-35:  sample_rate (u32)
//   36-39:  buffer_size (u32)
//   40-47:  timestamp_us (u64)
//   48-2095:   samples_left (512 × f32)
//   2096-4143: samples_right (512 × f32)
// ─────────────────────────────────────────────────────────────────────────────

const BINARY_HEADER_SIZE = 48;
const VIS_SAMPLES = 512;

/**
 * Parse binary metering data from Rust backend.
 * Zero-copy for sample arrays (views into the buffer).
 *
 * @param {ArrayBuffer|Uint8Array} data - Binary data from Tauri event
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
 * Get Tauri event API from global
 */
function getTauriEvent() {
  return window.__TAURI__?.event;
}

/**
 * Get Tauri core API from global
 */
function getTauriCore() {
  return window.__TAURI__?.core;
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

  console.log('[TauriBridge] Initialising native audio bridge (binary IPC)');

  const tauriEvent = getTauriEvent();
  if (!tauriEvent) {
    console.error('[TauriBridge] Tauri event API not available');
    return false;
  }

  // Listen for BINARY metering updates from Rust backend (ultra-low latency)
  const unlisten = await tauriEvent.listen('metering-bin', (event) => {
    // Parse binary data (Tauri sends as array of numbers, convert to Uint8Array)
    const rawData = event.payload;
    const uint8 = rawData instanceof Uint8Array ? rawData : new Uint8Array(rawData);
    const data = parseBinaryMeteringData(uint8);

    // Call the callback with parsed metering data
    if (callbacks.onMeteringUpdate) {
      callbacks.onMeteringUpdate(data);
    }

    // Also expose via global for compatibility
    if (window.updateMetersFromTauri) {
      window.updateMetersFromTauri(data);
    }
  });

  tauriBridge.isActive = true;
  tauriBridge.listeners.push(unlisten);

  console.log('[TauriBridge] Native audio bridge ready (binary IPC enabled)');
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
  for (const unlisten of tauriBridge.listeners) {
    unlisten();
  }
  tauriBridge.listeners = [];
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
