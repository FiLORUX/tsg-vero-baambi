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
 * REMOTE METRICS SCHEMA & TYPE DEFINITIONS
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * ───────
 * Type definitions and schema for metrics exchanged between Probe and Client
 * in the remote metering architecture.
 *
 * ARCHITECTURE
 * ────────────
 *   ┌─────────┐         ┌─────────┐         ┌─────────┐
 *   │  Probe  │ ──────► │ Broker  │ ◄────── │ Client  │
 *   └─────────┘         └─────────┘         └─────────┘
 *       │                    │                   │
 *   Captures audio      Routes metrics      Displays meters
 *   Computes LUFS       No audio data       Read-only view
 *   Sends metrics       Relay only          Multiple allowed
 *
 * DATA FLOW
 * ─────────
 * 1. Probe computes metering values from audio input
 * 2. Probe serializes metrics using schema below
 * 3. Probe sends to Broker via WebSocket/WebTransport/WebRTC
 * 4. Broker relays to connected Clients (no processing)
 * 5. Clients deserialize and render meters
 *
 * IMPORTANT: No audio data is transmitted, only computed metrics.
 *
 * NAMING CONVENTION
 * ─────────────────
 * - "Probe" = Audio source / metering origin
 * - "Broker" = Message relay server (placeholder name)
 * - "Client" = Remote display / viewer
 *
 * These names are placeholders and may be renamed in production.
 *
 * @module remote/types
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA VERSION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Current metrics schema version.
 * Bump when schema changes break backward compatibility.
 *
 * @type {number}
 */
export const METRICS_SCHEMA_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────
// TYPE DEFINITIONS (JSDoc)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} LUFSMetrics
 * @property {number} momentary - Momentary loudness (400ms window) in LUFS
 * @property {number} shortTerm - Short-term loudness (3s window) in LUFS
 * @property {number} integrated - Integrated loudness (gated) in LUFS
 * @property {number} range - Loudness Range (LRA) in LU
 */

/**
 * @typedef {Object} TruePeakMetrics
 * @property {number} left - Left channel true peak in dBTP
 * @property {number} right - Right channel true peak in dBTP
 * @property {number} max - Maximum of L/R in dBTP
 */

/**
 * @typedef {Object} PPMMetrics
 * @property {number} left - Left channel PPM level in dB (Nordic scale)
 * @property {number} right - Right channel PPM level in dB (Nordic scale)
 */

/**
 * @typedef {Object} StereoMetrics
 * @property {number} correlation - Phase correlation (-1 to +1)
 * @property {number} balance - L/R balance (-1 = full left, +1 = full right)
 * @property {number} width - Stereo width (0 = mono, 1 = full stereo)
 */

/**
 * @typedef {Object} ProbeIdentity
 * @property {string} id - Unique probe identifier (UUID)
 * @property {string} name - Human-readable probe name
 * @property {string} [location] - Physical location description
 */

/**
 * @typedef {Object} MetricsTimestamp
 * @property {number} probeTime - Probe's AudioContext.currentTime when captured
 * @property {number} wallClock - Unix timestamp (ms) when metrics computed
 * @property {number} sequence - Monotonic sequence number for ordering
 */

/**
 * @typedef {Object} MetricsPacket
 * @property {number} schemaVersion - Schema version for compatibility
 * @property {ProbeIdentity} probe - Probe identification
 * @property {MetricsTimestamp} timestamp - Timing information
 * @property {LUFSMetrics} lufs - EBU R128 loudness metrics
 * @property {TruePeakMetrics} truePeak - ITU-R BS.1770 true peak
 * @property {PPMMetrics} ppm - IEC 60268-10 PPM levels
 * @property {StereoMetrics} stereo - Stereo field analysis
 * @property {boolean} isActive - Whether probe is receiving audio
 * @property {string} [inputDevice] - Input device name if available
 */

/**
 * @typedef {Object} ProbeStatus
 * @property {ProbeIdentity} probe - Probe identification
 * @property {'online'|'offline'|'standby'} status - Current probe status
 * @property {number} lastSeen - Unix timestamp of last metrics
 * @property {number} sampleRate - Audio sample rate in Hz
 * @property {number} updateRate - Metrics updates per second
 */

/**
 * @typedef {Object} BrokerMessage
 * @property {'metrics'|'status'|'subscribe'|'unsubscribe'|'error'} type - Message type
 * @property {MetricsPacket|ProbeStatus|Object} payload - Message payload
 */

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an empty LUFS metrics object with -Infinity (silence).
 * @returns {LUFSMetrics}
 */
export function createEmptyLUFS() {
  return {
    momentary: -Infinity,
    shortTerm: -Infinity,
    integrated: -Infinity,
    range: 0
  };
}

/**
 * Create an empty True Peak metrics object.
 * @returns {TruePeakMetrics}
 */
export function createEmptyTruePeak() {
  return {
    left: -Infinity,
    right: -Infinity,
    max: -Infinity
  };
}

/**
 * Create an empty PPM metrics object.
 * @returns {PPMMetrics}
 */
export function createEmptyPPM() {
  return {
    left: -Infinity,
    right: -Infinity
  };
}

/**
 * Create an empty stereo metrics object.
 * @returns {StereoMetrics}
 */
export function createEmptyStereo() {
  return {
    correlation: 0,
    balance: 0,
    width: 0
  };
}

/**
 * Create a complete empty metrics packet.
 *
 * @param {ProbeIdentity} probe - Probe identity
 * @returns {MetricsPacket}
 */
export function createEmptyMetricsPacket(probe) {
  return {
    schemaVersion: METRICS_SCHEMA_VERSION,
    probe,
    timestamp: {
      probeTime: 0,
      wallClock: Date.now(),
      sequence: 0
    },
    lufs: createEmptyLUFS(),
    truePeak: createEmptyTruePeak(),
    ppm: createEmptyPPM(),
    stereo: createEmptyStereo(),
    isActive: false,
    inputDevice: undefined
  };
}

/**
 * Generate a new probe ID (UUID v4).
 * @returns {string}
 */
export function generateProbeId() {
  // Use crypto.randomUUID if available, fallback to manual generation
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback UUID v4 generation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a metrics packet structure.
 *
 * @param {unknown} packet - Packet to validate
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateMetricsPacket(packet) {
  /** @type {string[]} */
  const errors = [];

  if (!packet || typeof packet !== 'object') {
    return { valid: false, errors: ['Packet must be an object'] };
  }

  // Cast to partial MetricsPacket for property access
  /** @type {Partial<MetricsPacket>} */
  const p = /** @type {Partial<MetricsPacket>} */ (packet);

  // Check schema version
  if (p.schemaVersion !== METRICS_SCHEMA_VERSION) {
    errors.push(`Schema version mismatch: expected ${METRICS_SCHEMA_VERSION}, got ${p.schemaVersion}`);
  }

  // Check probe identity
  if (!p.probe?.id) {
    errors.push('Missing probe.id');
  }

  // Check timestamp
  if (typeof p.timestamp?.wallClock !== 'number') {
    errors.push('Missing or invalid timestamp.wallClock');
  }

  // Check LUFS metrics
  if (!p.lufs || typeof p.lufs.momentary !== 'number') {
    errors.push('Missing or invalid lufs.momentary');
  }

  // Check True Peak
  if (!p.truePeak || typeof p.truePeak.max !== 'number') {
    errors.push('Missing or invalid truePeak.max');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SERIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Serialize a metrics packet for transmission.
 * Uses JSON for simplicity; could use MessagePack/protobuf for efficiency.
 *
 * @param {MetricsPacket} packet - Packet to serialize
 * @returns {string} JSON string
 */
export function serializeMetrics(packet) {
  return JSON.stringify(packet);
}

/**
 * Deserialize a metrics packet from transmission.
 *
 * @param {string} data - JSON string
 * @returns {MetricsPacket|null} Parsed packet or null on error
 */
export function deserializeMetrics(data) {
  try {
    const packet = JSON.parse(data);
    const { valid, errors } = validateMetricsPacket(packet);

    if (!valid) {
      console.warn('[Metrics] Invalid packet:', errors);
      return null;
    }

    return packet;
  } catch (error) {
    console.error('[Metrics] Failed to parse packet:', error);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default metrics update rate (packets per second).
 * 10 Hz provides smooth meter animation without excessive bandwidth.
 * @type {number}
 */
export const DEFAULT_UPDATE_RATE = 10;

/**
 * Minimum metrics update rate.
 * @type {number}
 */
export const MIN_UPDATE_RATE = 1;

/**
 * Maximum metrics update rate.
 * Higher rates increase bandwidth but improve responsiveness.
 * @type {number}
 */
export const MAX_UPDATE_RATE = 30;
