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
 * APPLICATION STATE MANAGEMENT
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Centralised reactive state container for VERO-BAAMBI. Provides:
 * - Observable state changes via subscription
 * - Automatic localStorage persistence for user preferences
 * - Batch updates for performance
 * - Type-safe defaults and validation
 *
 * @module app/state
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { STORAGE_KEY, STORAGE_VERSION, migrateStorage } from '../config/storage.js';

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT STATE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input source modes.
 * @enum {string}
 */
export const InputMode = Object.freeze({
  BROWSER: 'browser',
  EXTERNAL: 'external',
  GENERATOR: 'generator'
});

/**
 * Default state values.
 * @type {AppState}
 */
export const DEFAULT_STATE = Object.freeze({
  // Audio source
  inputMode: InputMode.GENERATOR,
  isCapturing: false,
  deviceId: null,

  // Metering targets (EBU R128 defaults)
  targetLufs: -23,
  truePeakLimit: -1.0,

  // Monitor settings
  browserMonitorLevel: 20,
  browserMonitorMuted: true,
  browserTrim: -12,
  externalMonitorLevel: 20,
  externalMonitorMuted: true,
  externalTrim: 0,
  generatorMonitorLevel: 20,
  generatorMonitorMuted: false,

  // Generator settings
  generatorFrequency: 400,
  generatorWaveform: 'sine',

  // UI preferences
  sidebarCollapsed: false,
  collapsedPanels: [],

  // Runtime status (not persisted)
  contextState: 'suspended',
  sampleRate: 48000,
  channelCount: 2,
  uptime: 0
});

// ─────────────────────────────────────────────────────────────────────────────
// STATE STORE CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reactive state store with persistence.
 *
 * @example
 * const store = new StateStore();
 * store.subscribe((state, changed) => {
 *   if (changed.targetLufs) updateRadarTarget(state.targetLufs);
 * });
 * store.set({ targetLufs: -24 });
 */
export class StateStore {
  /**
   * @param {Partial<AppState>} [initial] - Initial state overrides
   */
  constructor(initial = {}) {
    /** @type {AppState} */
    this._state = { ...DEFAULT_STATE, ...initial };

    /** @type {Set<StateSubscriber>} */
    this._subscribers = new Set();

    /** @type {boolean} */
    this._batching = false;

    /** @type {Set<string>} */
    this._batchedKeys = new Set();

    // Keys to persist to localStorage
    this._persistedKeys = new Set([
      'inputMode',
      'deviceId',
      'targetLufs',
      'truePeakLimit',
      'browserMonitorLevel',
      'browserMonitorMuted',
      'browserTrim',
      'externalMonitorLevel',
      'externalMonitorMuted',
      'externalTrim',
      'generatorMonitorLevel',
      'generatorMonitorMuted',
      'generatorFrequency',
      'generatorWaveform',
      'sidebarCollapsed',
      'collapsedPanels'
    ]);

    // Load persisted state
    this._loadFromStorage();
  }

  /**
   * Get current state (read-only snapshot).
   *
   * @returns {Readonly<AppState>}
   */
  get state() {
    return Object.freeze({ ...this._state });
  }

  /**
   * Get a single state value.
   *
   * @template {keyof AppState} K
   * @param {K} key - State key
   * @returns {AppState[K]}
   */
  get(key) {
    return this._state[key];
  }

  /**
   * Update state values.
   * Triggers subscribers with changed keys.
   *
   * @param {Partial<AppState>} updates - State updates
   */
  set(updates) {
    const changed = {};
    let hasChanges = false;

    for (const [key, value] of Object.entries(updates)) {
      if (this._state[key] !== value) {
        this._state[key] = value;
        changed[key] = true;
        hasChanges = true;

        if (this._batching) {
          this._batchedKeys.add(key);
        }
      }
    }

    if (hasChanges && !this._batching) {
      this._notify(changed);
      this._saveToStorage(Object.keys(changed));
    }
  }

  /**
   * Batch multiple updates into a single notification.
   *
   * @param {() => void} fn - Function containing set() calls
   */
  batch(fn) {
    this._batching = true;
    this._batchedKeys.clear();

    try {
      fn();
    } finally {
      this._batching = false;

      if (this._batchedKeys.size > 0) {
        const changed = {};
        for (const key of this._batchedKeys) {
          changed[key] = true;
        }
        this._notify(changed);
        this._saveToStorage([...this._batchedKeys]);
      }
    }
  }

  /**
   * Subscribe to state changes.
   *
   * @param {StateSubscriber} fn - Callback receiving (state, changedKeys)
   * @returns {() => void} Unsubscribe function
   */
  subscribe(fn) {
    this._subscribers.add(fn);
    return () => this._subscribers.delete(fn);
  }

  /**
   * Reset state to defaults.
   *
   * @param {boolean} [clearStorage=true] - Also clear localStorage
   */
  reset(clearStorage = true) {
    const allKeys = {};
    for (const key of Object.keys(this._state)) {
      if (this._state[key] !== DEFAULT_STATE[key]) {
        allKeys[key] = true;
      }
    }

    this._state = { ...DEFAULT_STATE };

    if (clearStorage) {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (e) {
        console.warn('[StateStore] Failed to clear localStorage:', e);
      }
    }

    this._notify(allKeys);
  }

  /**
   * @private
   */
  _notify(changed) {
    const state = this.state;
    for (const fn of this._subscribers) {
      try {
        fn(state, changed);
      } catch (e) {
        console.error('[StateStore] Subscriber error:', e);
      }
    }
  }

  /**
   * @private
   */
  _loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const data = JSON.parse(raw);

      // Migrate if needed
      const migrated = migrateStorage(data, STORAGE_VERSION);
      if (!migrated) return;

      // Apply persisted values
      for (const key of this._persistedKeys) {
        if (key in migrated && migrated[key] !== undefined) {
          this._state[key] = migrated[key];
        }
      }
    } catch (e) {
      console.warn('[StateStore] Failed to load from localStorage:', e);
    }
  }

  /**
   * @private
   */
  _saveToStorage(changedKeys) {
    // Only persist if relevant keys changed
    const shouldPersist = changedKeys.some(k => this._persistedKeys.has(k));
    if (!shouldPersist) return;

    try {
      const toSave = { version: STORAGE_VERSION };
      for (const key of this._persistedKeys) {
        toSave[key] = this._state[key];
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (e) {
      console.warn('[StateStore] Failed to save to localStorage:', e);
    }
  }
}

/**
 * @callback StateSubscriber
 * @param {Readonly<AppState>} state - Current state
 * @param {Record<string, boolean>} changed - Map of changed keys
 */

/**
 * @typedef {Object} AppState
 * @property {InputMode} inputMode - Active input source
 * @property {boolean} isCapturing - Whether capture is active
 * @property {string|null} deviceId - Selected external device ID
 * @property {number} targetLufs - Loudness target in LUFS
 * @property {number} truePeakLimit - True Peak limit in dBTP
 * @property {number} browserMonitorLevel - Browser monitor volume (0-100)
 * @property {boolean} browserMonitorMuted - Browser monitor mute state
 * @property {number} browserTrim - Browser input trim in dB
 * @property {number} externalMonitorLevel - External monitor volume (0-100)
 * @property {boolean} externalMonitorMuted - External monitor mute state
 * @property {number} externalTrim - External input trim in dB
 * @property {number} generatorMonitorLevel - Generator monitor volume (0-100)
 * @property {boolean} generatorMonitorMuted - Generator monitor mute state
 * @property {number} generatorFrequency - Generator frequency in Hz
 * @property {string} generatorWaveform - Generator waveform type
 * @property {boolean} sidebarCollapsed - Sidebar collapsed state
 * @property {string[]} collapsedPanels - List of collapsed panel IDs
 * @property {string} contextState - AudioContext state
 * @property {number} sampleRate - Active sample rate
 * @property {number} channelCount - Active channel count
 * @property {number} uptime - Session uptime in ms
 */

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON INSTANCE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shared application state store.
 * @type {StateStore}
 */
export const appState = new StateStore();
