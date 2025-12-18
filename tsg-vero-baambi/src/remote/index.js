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
 * REMOTE METERING MODULE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Optional module for remote metering capabilities. Provides both probe (sender)
 * and client (receiver) functionality for distributed audio monitoring.
 *
 * ARCHITECTURE
 * ────────────
 *   ┌─────────┐         ┌─────────┐         ┌─────────┐
 *   │  Probe  │ ──────► │ Broker  │ ◄────── │ Client  │
 *   └─────────┘         └─────────┘         └─────────┘
 *
 * USAGE AS PROBE (sender)
 * ───────────────────────
 *   import { ProbeSender } from './remote/index.js';
 *
 *   const probe = new ProbeSender({ name: 'Studio A' });
 *   probe.collector.setSources({ lufsMeter, truePeakMeter, ppmMeter });
 *   await probe.start();
 *
 * USAGE AS CLIENT (receiver)
 * ──────────────────────────
 *   import { MetricsReceiver } from './remote/index.js';
 *
 *   const receiver = new MetricsReceiver();
 *   receiver.onMetrics((probeId, metrics) => updateDisplay(metrics));
 *   await receiver.connect();
 *   receiver.subscribe('probe-uuid');
 *
 * LOCAL-FIRST PRINCIPLE
 * ─────────────────────
 * This module is strictly opt-in. The application functions identically
 * without any remote features. When remote mode is disabled:
 * - No network connections are made
 * - No additional resources are consumed
 * - Local metering operates unchanged
 *
 * @module remote
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// Types and schema
export {
  METRICS_SCHEMA_VERSION,
  DEFAULT_UPDATE_RATE,
  MIN_UPDATE_RATE,
  MAX_UPDATE_RATE,
  createEmptyLUFS,
  createEmptyTruePeak,
  createEmptyPPM,
  createEmptyStereo,
  createEmptyMetricsPacket,
  generateProbeId,
  validateMetricsPacket,
  serializeMetrics,
  deserializeMetrics
} from './types.js';

// Transport layer
export {
  ConnectionState,
  ConnectionStateMachine,
  WebSocketClient,
  calculateReconnectDelay,
  shouldReconnect
} from './transport/index.js';

// Probe (sender) functionality
export {
  MetricsCollector,
  ProbeSender
} from './probe/index.js';

// Client (receiver) functionality
export {
  MetricsReceiver
} from './client/index.js';

// UI components
export {
  RemotePanel
} from './ui/index.js';
