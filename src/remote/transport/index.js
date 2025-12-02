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
 * Transport layer exports.
 * @module remote/transport
 */

export {
  ConnectionState,
  ConnectionStateMachine,
  calculateReconnectDelay,
  shouldReconnect,
  DEFAULT_RECONNECT_CONFIG
} from './connection-state.js';

export { WebSocketClient } from './websocket-client.js';
