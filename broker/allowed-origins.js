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
 * BROKER ORIGIN ALLOW-LIST
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Single owner of the `VERO_ALLOWED_ORIGINS` allow-list.
 *
 * The broker exposes two surfaces on one HTTP listener: the WebSocket upgrade
 * (gated in server.js) and the REST API (gated in rest-api.js). Both must agree
 * on which browser origins are trusted, and server.js already imports rest-api.js,
 * so neither can own the list without creating an import cycle. This module is
 * that shared owner — one definition, two consumers, no possibility of drift.
 *
 * CONFIGURATION
 * ─────────────
 *   VERO_ALLOWED_ORIGINS  Comma-separated list of exact origins, for example
 *                         "https://vero-baambi.pages.dev,https://tsg.thast.live".
 *                         Unset or empty means "no browser origin is trusted":
 *                         the REST API then emits no CORS grant at all, and the
 *                         WebSocket upgrade gate stays open for trusted-network
 *                         deployments (unchanged behaviour — see SECURITY.md).
 *
 * Origins are compared verbatim. An Origin header is already normalised by the
 * browser to scheme://host[:port] with no trailing slash and no path, so exact
 * comparison is both sufficient and the only safe option: substring or suffix
 * matching would let "https://vero-baambi.pages.dev.attacker.example" through.
 *
 * @module broker/allowed-origins
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** @type {string|null} Raw env value the cache below was built from */
let cachedRaw = null;

/** @type {readonly string[]} Parsed allow-list matching `cachedRaw` */
let cachedList = Object.freeze([]);

/**
 * Read the configured allow-list.
 *
 * The environment is re-read on every call and the parse result memoised against
 * the raw string. Deriving the list at call time rather than at module load keeps
 * the environment the single source of truth — it means tests can exercise both
 * the unset and configured cases without a test-only setter, and it costs one
 * string comparison per request on the steady-state path.
 *
 * @returns {readonly string[]} Trusted origins; empty when unconfigured
 */
export function getAllowedOrigins() {
  const raw = process.env.VERO_ALLOWED_ORIGINS || '';

  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedList = Object.freeze(
      raw
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    );
  }

  return cachedList;
}

/**
 * Test an Origin header value against the allow-list.
 *
 * Returns false when the list is unconfigured: "no list" means "trust nobody
 * explicitly", so callers must decide for themselves what an empty list implies
 * for their surface rather than having a permissive default hidden in here.
 *
 * @param {string|undefined|null} origin - Origin header value
 * @returns {boolean} True only when the list is configured and contains it
 */
export function isOriginAllowed(origin) {
  if (typeof origin !== 'string' || origin === '') return false;
  return getAllowedOrigins().includes(origin);
}
