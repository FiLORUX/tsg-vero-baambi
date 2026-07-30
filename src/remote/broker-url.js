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
 *   2. Exact/suffix match against the known-host table
 *   3. Loopback broker, but only on a genuine development host
 *   4. null — no broker can be inferred; the caller must say so out loud
 *
 * WHY NULL RATHER THAN A LOCALHOST FALLBACK
 * ─────────────────────────────────────────
 * Returning `ws://localhost:8765` for an unrecognised host is worse than
 * returning nothing. On an HTTPS page the browser blocks the ws:// dial as
 * mixed content before it reaches the network, so the UI reports "disconnected"
 * with no indication that the app simply does not know where its broker lives.
 * Null forces the caller to distinguish "cannot reach the broker" from "have no
 * broker address", and to tell the operator which it is.
 *
 * @module remote/broker-url
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const STORAGE_KEY = 'vero-baambi-broker-url';

/**
 * Broker reached from the published deployments.
 *
 * The host the APP is served from and the broker TARGET are independent. The
 * broker lives on the plain-ASCII `broker.thast.live`, a separate Cloudflare
 * zone reached over the shared OCI tunnel — ASCII sidesteps the punycode
 * round-trip an IDN host forces on every TLS/SNI hop; see broker/DEPLOY-OCI.md.
 *
 * @type {string}
 */
const PRODUCTION_BROKER = 'wss://broker.thast.live';

/** Broker used when the app itself is served from a development machine. */
const DEV_BROKER = 'ws://localhost:8765';

/**
 * Known app hostname → broker URL.
 *
 * Entries match either an exact `host` or an explicit leading-dot `suffix`.
 * Substring matching was removed deliberately: `h.includes('xn--thst-roa.se')`
 * also matched `xn--thst-roa.se.attacker.example`, which would have pointed the
 * app at the production broker from a host the operator does not control. A
 * leading-dot suffix can only ever match a true subdomain.
 *
 * @type {ReadonlyArray<{host?: string, suffix?: string, broker: string}>}
 */
const BROKER_HOSTS = Object.freeze([
  // Planned future home of the suite.
  { host: 'tsg.thast.live', broker: PRODUCTION_BROKER },

  // Cloudflare Pages: the project host plus its per-deployment preview hosts
  // (`<hash>.vero-baambi.pages.dev`).
  { host: 'vero-baambi.pages.dev', broker: PRODUCTION_BROKER },
  { suffix: '.vero-baambi.pages.dev', broker: PRODUCTION_BROKER },

  // Brand domain thåst.se, in its punycode A-label form. `window.location.hostname`
  // always reports the A-label, never the Unicode U-label, so testing for the
  // literal 'thåst.se' here could never fire — that clause has been removed.
  { host: 'xn--thst-roa.se', broker: PRODUCTION_BROKER },
  { suffix: '.xn--thst-roa.se', broker: PRODUCTION_BROKER }
]);

/**
 * Hostnames that genuinely denote the local machine.
 * `[::1]` appears because `location.hostname` keeps the brackets for IPv6 literals.
 */
const DEV_HOSTS = Object.freeze(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Suffixes that denote the local machine or link-local mDNS names.
 * `.localhost` is reserved to loopback (RFC 6761) and `.local` to mDNS (RFC 6762),
 * so neither can be delegated to a public host.
 */
const DEV_SUFFIXES = Object.freeze(['.localhost', '.local']);

/**
 * Operator-facing explanation for an unresolved host.
 * Shared so every surface reports the same diagnosis in the same words.
 *
 * @type {string}
 */
export const UNRESOLVED_BROKER_MESSAGE =
  'No broker configured for this host — enter a broker URL (e.g. wss://broker.thast.live)';

/**
 * Resolve a broker URL for a given app hostname.
 *
 * Pure: takes the hostname rather than reading `window`, so it is testable and
 * has no hidden dependency on the document.
 *
 * @param {string} hostname - Host the app is served from, as `location.hostname`
 * @returns {string|null} Broker WebSocket URL, or null when none can be inferred
 */
export function resolveBrokerUrl(hostname) {
  if (typeof hostname !== 'string') return null;

  // Hostnames are case-insensitive; compare in one case so `LOCALHOST` resolves.
  const host = hostname.trim().toLowerCase();
  if (host === '') return null;

  for (const entry of BROKER_HOSTS) {
    if (entry.host !== undefined && host === entry.host) return entry.broker;
    if (entry.suffix !== undefined && host.endsWith(entry.suffix)) return entry.broker;
  }

  if (DEV_HOSTS.includes(host)) return DEV_BROKER;
  if (DEV_SUFFIXES.some((suffix) => host.endsWith(suffix))) return DEV_BROKER;

  return null;
}

/**
 * Detect broker URL based on the current hostname.
 *
 * @returns {string|null} WebSocket URL for broker, or null when unresolved
 */
function detectBrokerUrl() {
  // Guarded so the module can be imported outside a document (tests, tooling).
  if (typeof window === 'undefined' || !window.location) return null;

  return resolveBrokerUrl(window.location.hostname);
}

/**
 * Get broker URL with localStorage override support.
 *
 * @returns {string|null} WebSocket URL for broker, or null when unresolved
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
 * @returns {string|null} Auto-detected WebSocket URL, or null when unresolved
 */
export function getDefaultBrokerUrl() {
  return detectBrokerUrl();
}

export default {
  getBrokerUrl,
  saveBrokerUrl,
  clearBrokerUrl,
  getDefaultBrokerUrl,
  resolveBrokerUrl,
  UNRESOLVED_BROKER_MESSAGE,
  STORAGE_KEY
};
