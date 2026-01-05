/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * TSG Suite – broadcast tools for alignment, metering, and signal verification
 * Maintained by David Thåst  ·  https://github.com/FiLORUX
 *
 * Built with the assumption that behaviour should be predictable,
 * output should be verifiable, and silence should mean silence
 *
 * david@thast.se  ·  +46 700 30 30 60
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * APPLICATION MODULE INDEX
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Re-exports all application integration modules.
 *
 * @module app
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// State management
export {
  InputMode,
  DEFAULT_STATE,
  StateStore,
  appState
} from './state.js';

// Input source control
export {
  ALIGNMENT_TONE_HZ,
  ALIGNMENT_LEVEL_DBFS,
  SignalType,
  RoutingMode,
  SourceController,
  getAudioInputDevices,
  requestMicrophonePermission
} from './sources.js';

// Render loop
export {
  RenderLoop,
  MeterRenderer,
  renderLoop
} from './renderer.js';
