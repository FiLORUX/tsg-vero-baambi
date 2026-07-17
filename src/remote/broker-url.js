/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * BROKER URL RESOLUTION
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Auto-detects the appropriate broker URL based on the current hostname.
 * Supports localStorage override for custom configurations.
 *
 * Priority:
 *   1. localStorage saved URL (user override)
 *   2. Auto-detect based on hostname
 *   3. Fallback to localhost for development
 *
 * @module remote/broker-url
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const STORAGE_KEY = 'vero-baambi-broker-url';

/**
 * Known hostname → broker URL mappings.
 * Add entries here for custom domains.
 */
// The `match` predicates detect where the APP is served (Pages preview or the
// thåst.se brand domain). The broker TARGET is independent of that: it lives on
// the plain-ASCII `broker.thast.live`, a separate Cloudflare zone reached over
// the shared OCI tunnel. ASCII sidesteps the punycode round-trip an IDN host
// forces on every TLS/SNI hop; see broker/DEPLOY-OCI.md.
const BROKER_MAPPINGS = [
  // Cloudflare Pages production
  { match: (h) => h.includes('vero-baambi') && h.includes('pages.dev'), broker: 'wss://broker.thast.live' },

  // Custom domain (thåst.se)
  { match: (h) => h.includes('thåst.se') || h.includes('xn--thst-roa.se'), broker: 'wss://broker.thast.live' },
];

/**
 * Detect broker URL based on current hostname.
 *
 * @returns {string} WebSocket URL for broker
 */
function detectBrokerUrl() {
  const hostname = window.location.hostname;

  // Check mappings
  for (const { match, broker } of BROKER_MAPPINGS) {
    if (match(hostname)) {
      return broker;
    }
  }

  // Default: localhost for development
  return 'ws://localhost:8765';
}

/**
 * Get broker URL with localStorage override support.
 *
 * @returns {string} WebSocket URL for broker
 */
export function getBrokerUrl() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved.trim()) {
      return saved.trim();
    }
  } catch {
    // localStorage not available
  }

  return detectBrokerUrl();
}

/**
 * Save broker URL to localStorage.
 *
 * @param {string} url - WebSocket URL to save
 */
export function saveBrokerUrl(url) {
  try {
    if (url && url.trim()) {
      localStorage.setItem(STORAGE_KEY, url.trim());
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // localStorage not available
  }
}

/**
 * Clear saved broker URL (revert to auto-detect).
 */
export function clearBrokerUrl() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage not available
  }
}

/**
 * Get the auto-detected URL (ignoring localStorage).
 *
 * @returns {string} Auto-detected WebSocket URL
 */
export function getDefaultBrokerUrl() {
  return detectBrokerUrl();
}

export default {
  getBrokerUrl,
  saveBrokerUrl,
  clearBrokerUrl,
  getDefaultBrokerUrl,
  STORAGE_KEY
};
