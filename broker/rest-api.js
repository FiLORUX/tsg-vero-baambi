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
 * BROKER REST API
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * HTTP REST API endpoints for the VERO-BAAMBI metrics broker.
 * Provides query access to probe status and metrics without WebSocket.
 *
 * ENDPOINTS
 * ─────────
 *   GET /health          - Broker health check
 *   GET /probes          - List all registered probes
 *   GET /probes/:id      - Get probe info and latest metrics
 *   GET /probes/:id/status - Quick in-spec check (for automation)
 *   GET /metrics         - Prometheus format export
 *
 * RESPONSE FORMAT
 * ───────────────
 *   All endpoints return JSON with consistent structure:
 *   { ok: boolean, data?: any, error?: string }
 *
 * @module broker/rest-api
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import http from 'http';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Default loudness target for in-spec check */
const DEFAULT_TARGET_LUFS = -23;

/** Default tolerance for in-spec check (±LU) */
const DEFAULT_TOLERANCE_LU = 1;

/** Default True Peak limit for in-spec check */
const DEFAULT_TP_LIMIT = -1;

/** Probe stale threshold (ms) - probe considered offline after this */
const STALE_THRESHOLD_MS = 10000;

// ─────────────────────────────────────────────────────────────────────────────
// STATE REFERENCES
// ─────────────────────────────────────────────────────────────────────────────

/** @type {Map<string, Object>|null} Reference to probes map from server */
let probesRef = null;

/** @type {Map<string, Object>} Last received metrics per probe */
const lastMetrics = new Map();

/** @type {number} Server start time */
const startTime = Date.now();

// ─────────────────────────────────────────────────────────────────────────────
// REST API SETUP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create HTTP server for REST API.
 *
 * @param {Object} options - Configuration options
 * @param {number} options.port - HTTP port to listen on
 * @param {Map} options.probes - Reference to probes map
 * @returns {http.Server} HTTP server instance
 */
export function createRestApi(options) {
  const { port, probes } = options;
  probesRef = probes;

  const server = http.createServer(handleRequest);

  server.listen(port, () => {
    console.log(`[REST API] Listening on http://localhost:${port}`);
  });

  return server;
}

/**
 * Update last metrics for a probe.
 * Called from main server when metrics are received.
 *
 * @param {string} probeId - Probe identifier
 * @param {Object} metrics - Metrics payload
 */
export function updateMetrics(probeId, metrics) {
  lastMetrics.set(probeId, {
    timestamp: Date.now(),
    payload: metrics
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// REQUEST HANDLER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle incoming HTTP request.
 *
 * @param {http.IncomingMessage} req - HTTP request
 * @param {http.ServerResponse} res - HTTP response
 */
function handleRequest(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  try {
    // Route request
    if (path === '/health') {
      handleHealth(res);
    } else if (path === '/probes') {
      handleProbeList(res);
    } else if (path === '/metrics') {
      handlePrometheusMetrics(res);
    } else if (path.match(/^\/probes\/[^/]+$/)) {
      const probeId = path.split('/')[2];
      handleProbeInfo(res, probeId);
    } else if (path.match(/^\/probes\/[^/]+\/status$/)) {
      const probeId = path.split('/')[2];
      handleProbeStatus(res, probeId, url.searchParams);
    } else {
      sendJson(res, 404, { ok: false, error: 'Not found' });
    }
  } catch (error) {
    console.error('[REST API] Error:', error);
    sendJson(res, 500, { ok: false, error: 'Internal server error' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ENDPOINT HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /health - Broker health check.
 */
function handleHealth(res) {
  const now = Date.now();
  const uptimeMs = now - startTime;

  const onlineProbes = countOnlineProbes();
  const totalProbes = probesRef?.size || 0;

  sendJson(res, 200, {
    ok: true,
    data: {
      status: 'healthy',
      uptime: Math.floor(uptimeMs / 1000),
      uptimeFormatted: formatUptime(uptimeMs),
      probes: {
        total: totalProbes,
        online: onlineProbes
      },
      timestamp: new Date(now).toISOString()
    }
  });
}

/**
 * GET /probes - List all registered probes.
 */
function handleProbeList(res) {
  if (!probesRef) {
    sendJson(res, 500, { ok: false, error: 'Broker not initialised' });
    return;
  }

  const probeList = [];
  const now = Date.now();

  for (const [id, info] of probesRef) {
    const isOnline = (now - info.lastSeen) < STALE_THRESHOLD_MS;
    const metrics = lastMetrics.get(id);

    probeList.push({
      id,
      name: info.name,
      location: info.location || null,
      online: isOnline,
      lastSeen: info.lastSeen,
      lastSeenAgo: formatDuration(now - info.lastSeen),
      hasMetrics: !!metrics,
      subscriberCount: info.subscribers?.size || 0,
      capabilities: info.capabilities || null
    });
  }

  sendJson(res, 200, {
    ok: true,
    data: {
      count: probeList.length,
      probes: probeList
    }
  });
}

/**
 * GET /probes/:id - Get probe info and latest metrics.
 */
function handleProbeInfo(res, probeId) {
  if (!probesRef) {
    sendJson(res, 500, { ok: false, error: 'Broker not initialised' });
    return;
  }

  const probeInfo = probesRef.get(probeId);
  if (!probeInfo) {
    sendJson(res, 404, { ok: false, error: `Probe not found: ${probeId}` });
    return;
  }

  const now = Date.now();
  const isOnline = (now - probeInfo.lastSeen) < STALE_THRESHOLD_MS;
  const metrics = lastMetrics.get(probeId);
  const normalised = metrics ? normalisePayload(metrics.payload) : null;

  sendJson(res, 200, {
    ok: true,
    data: {
      probe: {
        id: probeId,
        name: probeInfo.name,
        location: probeInfo.location || null,
        online: isOnline,
        lastSeen: probeInfo.lastSeen,
        lastSeenAgo: formatDuration(now - probeInfo.lastSeen),
        subscriberCount: probeInfo.subscribers?.size || 0,
        capabilities: probeInfo.capabilities || null
      },
      metrics: normalised ? {
        timestamp: metrics.timestamp,
        age: now - metrics.timestamp,
        lufs: normalised.lufs,
        truePeak: normalised.truePeak,
        ppm: normalised.ppm,
        stereo: normalised.stereo,
        rms: normalised.rms
      } : null
    }
  });
}

/**
 * GET /probes/:id/status - Quick in-spec check.
 *
 * Query parameters:
 *   target  - Target LUFS (default: -23)
 *   tolerance - Tolerance in LU (default: 1)
 *   tpLimit - True Peak limit (default: -1)
 */
function handleProbeStatus(res, probeId, params) {
  if (!probesRef) {
    sendJson(res, 500, { ok: false, error: 'Broker not initialised' });
    return;
  }

  const probeInfo = probesRef.get(probeId);
  if (!probeInfo) {
    sendJson(res, 404, { ok: false, error: `Probe not found: ${probeId}` });
    return;
  }

  const target = parseFloat(params.get('target')) || DEFAULT_TARGET_LUFS;
  const tolerance = parseFloat(params.get('tolerance')) || DEFAULT_TOLERANCE_LU;
  const tpLimit = parseFloat(params.get('tpLimit')) || DEFAULT_TP_LIMIT;

  const now = Date.now();
  const isOnline = (now - probeInfo.lastSeen) < STALE_THRESHOLD_MS;

  if (!isOnline) {
    sendJson(res, 200, {
      ok: true,
      data: {
        probeId,
        online: false,
        inSpec: null,
        reason: 'Probe offline'
      }
    });
    return;
  }

  const metrics = lastMetrics.get(probeId);
  if (!metrics) {
    sendJson(res, 200, {
      ok: true,
      data: {
        probeId,
        online: true,
        inSpec: null,
        reason: 'No metrics available'
      }
    });
    return;
  }

  const normalised = normalisePayload(metrics.payload);
  const lufs = normalised.lufs;
  const truePeak = normalised.truePeak;

  const integratedLufs = lufs?.integrated;
  const maxTp = Math.max(truePeak?.left ?? -Infinity, truePeak?.right ?? -Infinity);

  // Check spec
  const lufsDeviation = isFinite(integratedLufs) ? integratedLufs - target : null;
  const lufsInSpec = lufsDeviation !== null && Math.abs(lufsDeviation) <= tolerance;
  const tpInSpec = isFinite(maxTp) && maxTp <= tpLimit;

  const inSpec = lufsInSpec && tpInSpec;

  const violations = [];
  if (!lufsInSpec && lufsDeviation !== null) {
    violations.push(`LUFS ${lufsDeviation > 0 ? '+' : ''}${lufsDeviation.toFixed(1)} LU from target`);
  }
  if (!tpInSpec && isFinite(maxTp)) {
    violations.push(`True Peak ${maxTp.toFixed(1)} dBTP exceeds limit of ${tpLimit} dBTP`);
  }

  sendJson(res, 200, {
    ok: true,
    data: {
      probeId,
      name: probeInfo.name,
      online: true,
      inSpec,
      target,
      tolerance,
      tpLimit,
      current: {
        integratedLufs: isFinite(integratedLufs) ? integratedLufs : null,
        truePeakMax: isFinite(maxTp) ? maxTp : null,
        lufsDeviation: lufsDeviation
      },
      violations: violations.length > 0 ? violations : null
    }
  });
}

/**
 * GET /metrics - Prometheus format export.
 */
function handlePrometheusMetrics(res) {
  const lines = [];
  const now = Date.now();

  // Help text
  lines.push('# HELP vero_broker_uptime_seconds Broker uptime in seconds');
  lines.push('# TYPE vero_broker_uptime_seconds gauge');
  lines.push(`vero_broker_uptime_seconds ${Math.floor((now - startTime) / 1000)}`);

  lines.push('# HELP vero_broker_probes_total Total number of registered probes');
  lines.push('# TYPE vero_broker_probes_total gauge');
  lines.push(`vero_broker_probes_total ${probesRef?.size || 0}`);

  lines.push('# HELP vero_broker_probes_online Number of online probes');
  lines.push('# TYPE vero_broker_probes_online gauge');
  lines.push(`vero_broker_probes_online ${countOnlineProbes()}`);

  // Per-probe metrics
  if (probesRef) {
    lines.push('# HELP vero_probe_online Probe online status (1=online, 0=offline)');
    lines.push('# TYPE vero_probe_online gauge');

    lines.push('# HELP vero_probe_lufs_integrated Integrated loudness in LUFS');
    lines.push('# TYPE vero_probe_lufs_integrated gauge');

    lines.push('# HELP vero_probe_lufs_shortterm Short-term loudness in LUFS');
    lines.push('# TYPE vero_probe_lufs_shortterm gauge');

    lines.push('# HELP vero_probe_truepeak_max Maximum true peak in dBTP');
    lines.push('# TYPE vero_probe_truepeak_max gauge');

    for (const [id, info] of probesRef) {
      const isOnline = (now - info.lastSeen) < STALE_THRESHOLD_MS ? 1 : 0;
      const safeName = info.name.replace(/[^a-zA-Z0-9_]/g, '_');
      const labels = `probe_id="${id}",probe_name="${safeName}"`;

      lines.push(`vero_probe_online{${labels}} ${isOnline}`);

      const metrics = lastMetrics.get(id);
      const normalised = metrics ? normalisePayload(metrics.payload) : null;

      if (normalised?.lufs) {
        const lufs = normalised.lufs;
        if (isFinite(lufs.integrated)) {
          lines.push(`vero_probe_lufs_integrated{${labels}} ${lufs.integrated.toFixed(2)}`);
        }
        if (isFinite(lufs.shortTerm)) {
          lines.push(`vero_probe_lufs_shortterm{${labels}} ${lufs.shortTerm.toFixed(2)}`);
        }
      }
      if (normalised?.truePeak) {
        const tp = normalised.truePeak;
        const maxTp = Math.max(tp.left ?? -Infinity, tp.right ?? -Infinity);
        if (isFinite(maxTp)) {
          lines.push(`vero_probe_truepeak_max{${labels}} ${maxTp.toFixed(2)}`);
        }
      }
    }
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
  res.end(lines.join('\n') + '\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// PAYLOAD NORMALISATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalise metrics payload to canonical format.
 *
 * Handles two payload formats:
 *   - Standard (MetricsPacket): { lufs: {...}, truePeak: {...}, ... }
 *   - Rich (probe.html):        { metrics: { lufs: {...}, ... }, visualization: {...} }
 *
 * @param {Object} payload - Raw metrics payload
 * @returns {{ lufs: Object|null, truePeak: Object|null, ppm: Object|null, stereo: Object|null, rms: Object|null }}
 */
function normalisePayload(payload) {
  if (!payload) {
    return { lufs: null, truePeak: null, ppm: null, stereo: null, rms: null };
  }

  // Detect format: if payload.metrics exists, it's the rich format
  const source = payload.metrics || payload;

  return {
    lufs: source.lufs || null,
    truePeak: source.truePeak || null,
    ppm: source.ppm || null,
    stereo: source.stereo || null,
    rms: source.rms || null
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send JSON response.
 *
 * @param {http.ServerResponse} res - HTTP response
 * @param {number} status - HTTP status code
 * @param {Object} data - Response data
 */
function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

/**
 * Count online probes.
 *
 * @returns {number} Number of online probes
 */
function countOnlineProbes() {
  if (!probesRef) return 0;

  const now = Date.now();
  let count = 0;

  for (const info of probesRef.values()) {
    if ((now - info.lastSeen) < STALE_THRESHOLD_MS) {
      count++;
    }
  }

  return count;
}

/**
 * Format duration in human-readable form.
 *
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

/**
 * Format uptime in human-readable form.
 *
 * @param {number} ms - Uptime in milliseconds
 * @returns {string} Formatted uptime
 */
function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}
