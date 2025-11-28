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
 * LOCALSTORAGE CONFIGURATION & VERSIONING
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * ───────
 * Centralized storage management with versioning for safe migrations.
 * When storage schema changes, bump STORAGE_VERSION and add migration logic.
 *
 * STORAGE KEYS
 * ────────────
 * All VERO-BAAMBI storage keys use the 'vero_' prefix to avoid conflicts
 * with other applications sharing the same origin.
 *
 * MIGRATION STRATEGY
 * ──────────────────
 * 1. Check stored version against current STORAGE_VERSION
 * 2. If mismatch, run migration functions in sequence
 * 3. Update stored version to current
 * 4. Log migration actions for debugging
 *
 * @module config/storage
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// VERSION CONSTANT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Current storage schema version.
 * Increment when storage format changes require migration.
 *
 * Version history:
 *   1 - Initial modular version (Phase 1)
 *
 * @type {number}
 */
export const STORAGE_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────
// STORAGE KEYS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Storage key prefix for VERO-BAAMBI.
 * @type {string}
 */
const KEY_PREFIX = 'vero_';

/**
 * All storage keys used by the application.
 * Centralized here to prevent key collisions and enable discovery.
 * @type {Object<string, string>}
 */
export const STORAGE_KEYS = {
  /** Storage schema version */
  VERSION: `${KEY_PREFIX}storage_version`,

  /** Collapsed meter panel states (JSON array of IDs) */
  COLLAPSED_METERS: `${KEY_PREFIX}collapsed_meters`,

  /** Reference level in dBFS (number) */
  REFERENCE_LEVEL: `${KEY_PREFIX}reference_level`,

  /** Selected theme ID (string) */
  THEME: `${KEY_PREFIX}theme`,

  /** Selected input device ID (string) */
  INPUT_DEVICE: `${KEY_PREFIX}input_device`,

  /** Grid layout configuration (JSON object) */
  GRID_LAYOUT: `${KEY_PREFIX}grid_layout`,

  /** Remote features enabled flag (boolean as string) */
  REMOTE_ENABLED: `${KEY_PREFIX}remote_enabled`,

  /** Probe ID when operating as probe (string, UUID) */
  PROBE_ID: `${KEY_PREFIX}probe_id`,

  /** Broker URL for remote connections (string) */
  BROKER_URL: `${KEY_PREFIX}broker_url`
};

// ─────────────────────────────────────────────────────────────────────────────
// MIGRATION FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Migration from legacy (unversioned) to version 1.
 * Handles settings from the monolithic audio-meters-grid.html
 *
 * @private
 */
function migrateToV1() {
  console.log('[Storage] Migrating to v1...');

  // Legacy keys from monolithic version (if any exist)
  const legacyKeys = [
    'audioMetersCollapsed',
    'audioMetersTheme',
    'audioMetersRefLevel'
  ];

  // Check for legacy data and migrate
  for (const legacyKey of legacyKeys) {
    const value = localStorage.getItem(legacyKey);
    if (value !== null) {
      // Map legacy keys to new keys
      const newKey = {
        'audioMetersCollapsed': STORAGE_KEYS.COLLAPSED_METERS,
        'audioMetersTheme': STORAGE_KEYS.THEME,
        'audioMetersRefLevel': STORAGE_KEYS.REFERENCE_LEVEL
      }[legacyKey];

      if (newKey) {
        console.log(`[Storage] Migrating ${legacyKey} → ${newKey}`);
        localStorage.setItem(newKey, value);
        // Optionally remove legacy key
        // localStorage.removeItem(legacyKey);
      }
    }
  }

  console.log('[Storage] Migration to v1 complete');
}

/**
 * Registry of migration functions.
 * Key is the target version, value is the migration function.
 * @type {Object<number, Function>}
 */
const MIGRATIONS = {
  1: migrateToV1
  // Future migrations:
  // 2: migrateToV2,
  // 3: migrateToV3,
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run storage migrations if needed.
 * Call this during application initialization.
 *
 * @returns {boolean} True if migrations were run
 */
export function migrateStorage() {
  const storedVersion = parseInt(localStorage.getItem(STORAGE_KEYS.VERSION) || '0', 10);

  if (storedVersion === STORAGE_VERSION) {
    console.log(`[Storage] Version ${STORAGE_VERSION} - no migration needed`);
    return false;
  }

  console.log(`[Storage] Migrating from v${storedVersion} to v${STORAGE_VERSION}`);

  // Run migrations in sequence
  for (let v = storedVersion + 1; v <= STORAGE_VERSION; v++) {
    const migration = MIGRATIONS[v];
    if (migration) {
      try {
        migration();
      } catch (error) {
        console.error(`[Storage] Migration to v${v} failed:`, error);
        // Continue with other migrations
      }
    }
  }

  // Update version
  localStorage.setItem(STORAGE_KEYS.VERSION, String(STORAGE_VERSION));
  console.log(`[Storage] Migration complete, now at v${STORAGE_VERSION}`);

  return true;
}

/**
 * Get a stored value, with optional default.
 *
 * @param {string} key - Storage key from STORAGE_KEYS
 * @param {*} [defaultValue=null] - Default if key not found
 * @returns {string|null} Stored value or default
 */
export function getItem(key, defaultValue = null) {
  const value = localStorage.getItem(key);
  return value !== null ? value : defaultValue;
}

/**
 * Get a stored JSON value, with optional default.
 *
 * @param {string} key - Storage key from STORAGE_KEYS
 * @param {*} [defaultValue=null] - Default if key not found or invalid JSON
 * @returns {*} Parsed value or default
 */
export function getJSON(key, defaultValue = null) {
  const value = localStorage.getItem(key);
  if (value === null) return defaultValue;

  try {
    return JSON.parse(value);
  } catch {
    console.warn(`[Storage] Invalid JSON in ${key}`);
    return defaultValue;
  }
}

/**
 * Set a storage value.
 *
 * @param {string} key - Storage key from STORAGE_KEYS
 * @param {string} value - Value to store
 */
export function setItem(key, value) {
  localStorage.setItem(key, value);
}

/**
 * Set a JSON storage value.
 *
 * @param {string} key - Storage key from STORAGE_KEYS
 * @param {*} value - Value to serialize and store
 */
export function setJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/**
 * Remove a storage value.
 *
 * @param {string} key - Storage key from STORAGE_KEYS
 */
export function removeItem(key) {
  localStorage.removeItem(key);
}

/**
 * Clear all VERO-BAAMBI storage (keys with vero_ prefix).
 * Does not affect other applications' storage.
 */
export function clearAll() {
  console.log('[Storage] Clearing all VERO-BAAMBI storage');

  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(KEY_PREFIX)) {
      keysToRemove.push(key);
    }
  }

  for (const key of keysToRemove) {
    localStorage.removeItem(key);
  }

  console.log(`[Storage] Cleared ${keysToRemove.length} keys`);
}

/**
 * Check if remote features are enabled.
 * Remote features are always opt-in, never default.
 *
 * @returns {boolean} True if remote features explicitly enabled
 */
export function isRemoteEnabled() {
  return getItem(STORAGE_KEYS.REMOTE_ENABLED) === 'true';
}

/**
 * Enable or disable remote features.
 *
 * @param {boolean} enabled - Whether to enable remote features
 */
export function setRemoteEnabled(enabled) {
  setItem(STORAGE_KEYS.REMOTE_ENABLED, String(enabled));
  console.log(`[Storage] Remote features ${enabled ? 'enabled' : 'disabled'}`);
}
