/**
 * TSG VERO-BAAMBI Tauri Bridge
 *
 * Provides integration between the Tauri native audio backend (Rust/cpal)
 * and the JavaScript UI. When running in Tauri, audio metering data comes
 * from ASIO (Windows), JACK (Linux), or CoreAudio (macOS) instead of
 * Web Audio API, providing ~10× lower latency.
 *
 * @module bridge
 */

export * from './tauri-bridge.js';
