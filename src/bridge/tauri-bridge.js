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
 */

// Detect if running in Tauri
const IS_TAURI = window.__TAURI__ !== undefined;

/**
 * Tauri audio bridge state
 */
const tauriBridge = {
  isActive: false,
  currentBackend: null,
  listeners: [],
};

/**
 * Initialise the Tauri bridge if running in Tauri environment
 *
 * @param {Object} callbacks - Callbacks for metering updates
 * @param {Function} callbacks.onMeteringUpdate - Called with metering data
 * @param {Function} callbacks.onStatusChange - Called when backend changes
 * @returns {boolean} True if Tauri bridge was initialised
 */
export async function initTauriBridge(callbacks = {}) {
  if (!IS_TAURI) {
    console.log('[TauriBridge] Not running in Tauri, using Web Audio');
    return false;
  }

  console.log('[TauriBridge] Initialising native audio bridge');

  const { listen } = await import('@tauri-apps/api/event');

  // Listen for metering updates from Rust backend
  const unlisten = await listen('metering-update', (event) => {
    const data = event.payload;

    // Call the callback with metering data
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

  console.log('[TauriBridge] Native audio bridge ready');
  return true;
}

/**
 * List available audio input devices
 *
 * @returns {Promise<string[]>} List of device names
 */
export async function listAudioDevices() {
  if (!IS_TAURI) {
    return [];
  }

  const { invoke } = await import('@tauri-apps/api/core');
  return invoke('list_audio_devices');
}

/**
 * Start audio capture with native backend
 *
 * @param {Object} options - Capture options
 * @param {string} options.deviceName - Device to use (null for default)
 * @param {number} options.bufferSize - Buffer size in samples (default 128)
 * @returns {Promise<string>} Backend name (e.g. 'CoreAudio', 'Asio', 'Jack')
 */
export async function startCapture(options = {}) {
  if (!IS_TAURI) {
    throw new Error('Not running in Tauri');
  }

  const { invoke } = await import('@tauri-apps/api/core');

  const backend = await invoke('start_capture', {
    deviceName: options.deviceName || null,
    bufferSize: options.bufferSize || 128,
  });

  tauriBridge.currentBackend = backend;
  console.log(`[TauriBridge] Started capture with ${backend} backend`);

  return backend;
}

/**
 * Stop audio capture
 */
export async function stopCapture() {
  if (!IS_TAURI) {
    return;
  }

  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('stop_capture');

  tauriBridge.currentBackend = null;
  console.log('[TauriBridge] Stopped capture');
}

/**
 * Get current audio status
 *
 * @returns {Promise<string|null>} Current backend name or null if not capturing
 */
export async function getAudioStatus() {
  if (!IS_TAURI) {
    return null;
  }

  const { invoke } = await import('@tauri-apps/api/core');
  return invoke('get_audio_status');
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
 * Check if running in Tauri
 */
export function isTauri() {
  return IS_TAURI;
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

// Export detection flag for conditional imports
export { IS_TAURI };
