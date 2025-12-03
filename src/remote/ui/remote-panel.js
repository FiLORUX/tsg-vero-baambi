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
 * REMOTE PANEL – DISTRIBUTED METERING CONTROL INTERFACE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE
 * ───────
 * Self-contained UI component for remote metering functionality. Manages both
 * probe mode (streaming metrics to broker) and client mode (receiving metrics
 * from remote probes). Designed for broadcast environments where multiple
 * monitoring positions need synchronised level information.
 *
 * ARCHITECTURE
 * ────────────
 *   ┌─────────────────────────────────────────────────────────────────────────┐
 *   │  RemotePanel                                                            │
 *   │  ├── Header (collapsible, shows status when minimised)                  │
 *   │  ├── Settings Section (always editable)                                 │
 *   │  │   ├── Broker URL input                                               │
 *   │  │   └── Check Connection button                                        │
 *   │  ├── Probe Section (disabled when broker unavailable)                   │
 *   │  │   ├── Stream toggle                                                  │
 *   │  │   └── Probe name input                                               │
 *   │  └── Client Section (disabled when broker unavailable)                  │
 *   │       ├── Receive toggle                                                │
 *   │       └── Available probes list                                         │
 *   └─────────────────────────────────────────────────────────────────────────┘
 *
 * AVAILABILITY BEHAVIOUR
 * ──────────────────────
 * The panel automatically tests broker reachability on initialisation. When
 * the broker is unavailable:
 *
 *   • Header badge shows "Unavailable" (visible when collapsed)
 *   • Probe/Client sections are greyed out (pointer-events: none)
 *   • Settings section remains fully interactive
 *   • "Check Connection" button allows manual re-test
 *
 * This ensures users can always configure the broker URL even when offline,
 * whilst preventing accidental activation of unavailable features.
 *
 * PERSISTENCE
 * ───────────
 * Uses the centralised storage system (config/storage.js):
 *
 *   • Broker URL: STORAGE_KEYS.BROKER_URL
 *   • Probe ID: STORAGE_KEYS.PROBE_ID
 *   • Collapse state: localStorage (panel-local)
 *
 * EVENT EMISSION
 * ──────────────
 * The panel emits custom events on the container element:
 *
 *   • 'remote:metrics' – Remote metrics received (detail: { probeId, metrics })
 *   • 'remote:status' – Status change (detail: { status, available })
 *   • 'remote:error' – Error occurred (detail: { error, context })
 *
 * INTEGRATION
 * ───────────
 *   import { RemotePanel } from './remote/ui/index.js';
 *
 *   const panel = new RemotePanel({
 *     container: document.getElementById('remote-section'),
 *     meters: { lufsMeter, truePeakMeter, ppmMeter }
 *   });
 *
 *   // Listen for remote metrics
 *   panel.container.addEventListener('remote:metrics', (e) => {
 *     updateRemoteDisplay(e.detail.probeId, e.detail.metrics);
 *   });
 *
 * @module remote/ui/remote-panel
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { ProbeSender } from '../probe/index.js';
import { MetricsReceiver } from '../client/index.js';
import { STORAGE_KEYS, getItem, setItem } from '../../config/storage.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default broker URL when none is configured.
 * Uses localhost for development; production deployments override via storage.
 * @type {string}
 */
const DEFAULT_BROKER_URL = 'ws://localhost:8765';

/**
 * Timeout for availability check (milliseconds).
 * Balances responsiveness with network latency tolerance.
 * @type {number}
 */
const AVAILABILITY_CHECK_TIMEOUT_MS = 5000;

/**
 * Debounce delay for URL input changes (milliseconds).
 * Prevents excessive connection attempts whilst typing.
 * @type {number}
 */
const URL_INPUT_DEBOUNCE_MS = 800;

/**
 * Debounce delay for name input changes (milliseconds).
 * @type {number}
 */
const NAME_INPUT_DEBOUNCE_MS = 300;

/**
 * LocalStorage key for panel collapse state (panel-local, not in STORAGE_KEYS).
 * @type {string}
 */
const STORAGE_KEY_COLLAPSED = 'vero_remote_panel_collapsed';

/**
 * LocalStorage key for probe name.
 * @type {string}
 */
const STORAGE_KEY_PROBE_NAME = 'vero_remote_probe_name';

// ─────────────────────────────────────────────────────────────────────────────
// CSS CLASS NAMES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CSS class names for consistent styling.
 * Matches BEM-like naming convention used elsewhere in the codebase.
 * @type {Readonly<Object<string, string>>}
 */
const CSS = Object.freeze({
  PANEL: 'remote-panel',
  HEADER: 'remote-header',
  HEADER_STATUS: 'remote-header-status',
  CHEVRON: 'remote-chevron',
  CONTENT: 'remote-content',
  SECTION: 'remote-section',
  SECTION_SETTINGS: 'remote-section--settings',
  SECTION_DISABLED: 'remote-section--disabled',
  FIELD: 'remote-field',
  INPUT: 'remote-input',
  BUTTON: 'remote-btn',
  TOGGLE: 'remote-toggle',
  STATUS: 'remote-status',
  STATUS_ACTIVE: 'remote-status--active',
  STATUS_ERROR: 'remote-status--error',
  STATUS_CONNECTING: 'remote-status--connecting',
  STATUS_UNAVAILABLE: 'remote-status--unavailable',
  PROBE_LIST: 'remote-probe-list',
  PROBE_ITEM: 'remote-probe-item',
  PROBE_EMPTY: 'remote-probe-empty'
});

// ─────────────────────────────────────────────────────────────────────────────
// STATUS MAPPINGS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Human-readable status text for UI display.
 * @type {Readonly<Object<string, string>>}
 */
const STATUS_TEXT = Object.freeze({
  disabled: 'Disabled',
  connecting: 'Connecting…',
  streaming: 'Streaming',
  reconnecting: 'Reconnecting…',
  error: 'Error',
  connected: 'Connected',
  disconnected: 'Disconnected',
  unavailable: 'Unavailable',
  checking: 'Checking…',
  available: 'Available'
});

/**
 * Header badge text for collapsed state display.
 * @type {Readonly<Object<string, string>>}
 */
const HEADER_STATUS_TEXT = Object.freeze({
  unavailable: 'Offline',
  available: 'Ready',
  connected: 'Active',
  streaming: 'Live',
  error: 'Error',
  checking: '…'
});

// ─────────────────────────────────────────────────────────────────────────────
// REMOTE PANEL CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Remote metering panel UI component.
 *
 * Provides a collapsible interface for managing remote metering connections.
 * Handles both probe mode (sending) and client mode (receiving) with
 * availability-aware control states.
 *
 * @example
 * const panel = new RemotePanel({
 *   container: document.getElementById('remoteSection'),
 *   meters: { lufsMeter, truePeakMeter, ppmMeter }
 * });
 *
 * // React to remote metrics
 * panel.onRemoteMetrics((probeId, metrics) => {
 *   console.log(`Metrics from ${probeId}:`, metrics);
 * });
 *
 * // Manual availability check after URL change
 * await panel.checkAvailability();
 */
export class RemotePanel {
  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE FIELDS
  // ═══════════════════════════════════════════════════════════════════════════

  /** @type {HTMLElement} */
  #container;

  /** @type {Object} */
  #meters;

  /** @type {ProbeSender|null} */
  #probe = null;

  /** @type {MetricsReceiver|null} */
  #receiver = null;

  /** @type {Object<string, HTMLElement>} */
  #elements = {};

  /** @type {function(): void|null} */
  #probeStatusUnsubscribe = null;

  /** @type {Array<function(): void>} */
  #receiverUnsubscribes = [];

  /** @type {Array<function(string, Object): void>} */
  #metricsCallbacks = [];

  /** @type {boolean} */
  #isCollapsed = false;

  /** @type {boolean} */
  #isRemoteAvailable = false;

  /** @type {boolean} */
  #isCheckingAvailability = false;

  /** @type {'unavailable'|'available'|'connected'|'streaming'|'error'} */
  #overallStatus = 'unavailable';

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSTRUCTOR
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a RemotePanel instance.
   *
   * @param {Object} config - Configuration object
   * @param {HTMLElement} config.container - Container element for panel
   * @param {Object} [config.meters={}] - Meter instances for probe mode
   * @param {Object} [config.meters.lufsMeter] - LUFS meter instance
   * @param {Object} [config.meters.truePeakMeter] - True Peak meter instance
   * @param {Object} [config.meters.ppmMeter] - PPM meter instance
   */
  constructor(config) {
    if (!config?.container) {
      throw new Error('[RemotePanel] Container element is required');
    }

    this.#container = config.container;
    this.#meters = config.meters || {};
    this.#isCollapsed = this.#loadCollapsedState();

    this.#render();
    this.#bindEvents();
    this.#checkRemoteAvailability();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC GETTERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the container element.
   * Useful for adding event listeners.
   * @returns {HTMLElement}
   */
  get container() {
    return this.#container;
  }

  /**
   * Get the probe sender instance (if active).
   * @returns {ProbeSender|null}
   */
  get probe() {
    return this.#probe;
  }

  /**
   * Get the metrics receiver instance (if active).
   * @returns {MetricsReceiver|null}
   */
  get receiver() {
    return this.#receiver;
  }

  /**
   * Check if remote broker is currently available.
   * @returns {boolean}
   */
  get isRemoteAvailable() {
    return this.#isRemoteAvailable;
  }

  /**
   * Get overall remote status for display.
   * @returns {'unavailable'|'available'|'connected'|'streaming'|'error'}
   */
  get overallStatus() {
    return this.#overallStatus;
  }

  /**
   * Check if panel is currently collapsed.
   * @returns {boolean}
   */
  get isCollapsed() {
    return this.#isCollapsed;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Register callback for received remote metrics.
   *
   * @param {function(string, Object): void} callback - (probeId, metrics) => void
   * @returns {function(): void} Unsubscribe function
   *
   * @example
   * const unsubscribe = panel.onRemoteMetrics((probeId, metrics) => {
   *   console.log(`${probeId}: ${metrics.lufs.momentary} LUFS`);
   * });
   *
   * // Later: unsubscribe();
   */
  onRemoteMetrics(callback) {
    this.#metricsCallbacks.push(callback);
    return () => {
      const idx = this.#metricsCallbacks.indexOf(callback);
      if (idx !== -1) this.#metricsCallbacks.splice(idx, 1);
    };
  }

  /**
   * Manually trigger a remote availability check.
   * Useful after broker URL has been changed.
   *
   * @returns {Promise<boolean>} Whether remote is available
   */
  async checkAvailability() {
    return this.#checkRemoteAvailability();
  }

  /**
   * Set panel visibility.
   *
   * @param {boolean} visible - Whether panel should be visible
   */
  setVisible(visible) {
    if (this.#container) {
      this.#container.style.display = visible ? '' : 'none';
    }
  }

  /**
   * Expand the panel (opposite of collapse).
   */
  expand() {
    if (this.#isCollapsed) {
      this.#toggleCollapse();
    }
  }

  /**
   * Collapse the panel.
   */
  collapse() {
    if (!this.#isCollapsed) {
      this.#toggleCollapse();
    }
  }

  /**
   * Clean up resources and subscriptions.
   * Call this before removing the panel from DOM.
   */
  dispose() {
    this.#stopProbe();
    this.#stopReceiver();
    this.#probeStatusUnsubscribe?.();
    this.#receiverUnsubscribes.forEach(fn => fn?.());
    this.#metricsCallbacks = [];
    this.#elements = {};

    // Clear container
    if (this.#container) {
      this.#container.innerHTML = '';
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: RENDERING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Render panel HTML structure.
   * @private
   */
  #render() {
    const brokerUrl = getItem(STORAGE_KEYS.BROKER_URL, DEFAULT_BROKER_URL);
    const probeName = getItem(STORAGE_KEY_PROBE_NAME, '');

    this.#container.innerHTML = `
      <div class="${CSS.PANEL}">
        <header class="${CSS.HEADER}">
          <span class="remote-icon" aria-hidden="true">📡</span>
          <span class="remote-title">Remote</span>
          <span class="${CSS.HEADER_STATUS} ${CSS.STATUS_UNAVAILABLE}"
                id="remoteHeaderStatus"
                title="Remote connection status">
            ${HEADER_STATUS_TEXT.unavailable}
          </span>
          <span class="${CSS.CHEVRON}" aria-hidden="true">
            ${this.#isCollapsed ? '▶' : '▼'}
          </span>
        </header>

        <div class="${CSS.CONTENT}"
             id="remoteContent"
             style="${this.#isCollapsed ? 'display:none' : ''}"
             role="region"
             aria-label="Remote metering settings">

          <!-- Settings Section (always editable) -->
          <section class="${CSS.SECTION} ${CSS.SECTION_SETTINGS}">
            <div class="${CSS.FIELD}">
              <label for="remoteBrokerUrl">Broker URL</label>
              <input type="url"
                     id="remoteBrokerUrl"
                     class="${CSS.INPUT}"
                     placeholder="${DEFAULT_BROKER_URL}"
                     value="${this.#escapeHtml(brokerUrl)}"
                     autocomplete="off"
                     spellcheck="false" />
            </div>
            <button type="button"
                    id="remoteCheckBtn"
                    class="${CSS.BUTTON}">
              Check Connection
            </button>
          </section>

          <!-- Probe Section -->
          <section class="${CSS.SECTION}"
                   id="remoteProbeSection"
                   data-mode="probe">
            <label class="${CSS.TOGGLE}">
              <input type="checkbox"
                     id="remoteProbeTog"
                     aria-describedby="probeStatus" />
              <span class="toggle-label">Stream Metrics</span>
              <span id="probeStatus"
                    class="${CSS.STATUS}">
                ${STATUS_TEXT.disabled}
              </span>
            </label>

            <div class="remote-details" id="remoteProbeDetails" hidden>
              <div class="${CSS.FIELD}">
                <label for="remoteProbeName">Probe Name</label>
                <input type="text"
                       id="remoteProbeName"
                       class="${CSS.INPUT}"
                       placeholder="Studio A"
                       maxlength="32"
                       value="${this.#escapeHtml(probeName)}" />
              </div>
              <p class="remote-probe-id" id="remoteProbeId" aria-live="polite"></p>
            </div>
          </section>

          <!-- Client Section -->
          <section class="${CSS.SECTION}"
                   id="remoteClientSection"
                   data-mode="client">
            <label class="${CSS.TOGGLE}">
              <input type="checkbox"
                     id="remoteClientTog"
                     aria-describedby="clientStatus" />
              <span class="toggle-label">Receive Remote</span>
              <span id="clientStatus"
                    class="${CSS.STATUS}">
                ${STATUS_TEXT.disabled}
              </span>
            </label>

            <div class="remote-details" id="remoteClientDetails" hidden>
              <div class="${CSS.PROBE_LIST}" id="remoteProbeList" role="list">
                <p class="${CSS.PROBE_EMPTY}">No probes available</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    `;

    // Cache element references
    this.#elements = {
      panel: this.#container.querySelector(`.${CSS.PANEL}`),
      header: this.#container.querySelector(`.${CSS.HEADER}`),
      headerStatus: this.#container.querySelector('#remoteHeaderStatus'),
      content: this.#container.querySelector('#remoteContent'),
      chevron: this.#container.querySelector(`.${CSS.CHEVRON}`),
      brokerUrl: this.#container.querySelector('#remoteBrokerUrl'),
      checkBtn: this.#container.querySelector('#remoteCheckBtn'),
      probeSection: this.#container.querySelector('#remoteProbeSection'),
      probeTog: this.#container.querySelector('#remoteProbeTog'),
      probeStatus: this.#container.querySelector('#probeStatus'),
      probeDetails: this.#container.querySelector('#remoteProbeDetails'),
      probeName: this.#container.querySelector('#remoteProbeName'),
      probeId: this.#container.querySelector('#remoteProbeId'),
      clientSection: this.#container.querySelector('#remoteClientSection'),
      clientTog: this.#container.querySelector('#remoteClientTog'),
      clientStatus: this.#container.querySelector('#clientStatus'),
      clientDetails: this.#container.querySelector('#remoteClientDetails'),
      probeList: this.#container.querySelector('#remoteProbeList')
    };

    // Apply initial disabled state
    this.#updateDisabledState();
  }

  /**
   * Escape HTML entities for safe insertion.
   * @private
   * @param {string} str - String to escape
   * @returns {string} Escaped string
   */
  #escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: EVENT BINDING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Bind UI event handlers.
   * @private
   */
  #bindEvents() {
    const {
      header,
      headerStatus,
      checkBtn,
      probeTog,
      clientTog,
      probeName,
      brokerUrl
    } = this.#elements;

    // Header collapse toggle (but not on status badge click)
    header?.addEventListener('click', (e) => {
      if (e.target === headerStatus) return;
      this.#toggleCollapse();
    });

    // Check connection button
    checkBtn?.addEventListener('click', () => {
      this.#checkRemoteAvailability();
    });

    // Probe mode toggle
    probeTog?.addEventListener('change', (e) => {
      if (!this.#isRemoteAvailable && e.target.checked) {
        e.target.checked = false;
        this.#emitError('Cannot enable streaming: broker unavailable', 'probe');
        return;
      }
      if (e.target.checked) {
        this.#startProbe();
      } else {
        this.#stopProbe();
      }
    });

    // Client mode toggle
    clientTog?.addEventListener('change', (e) => {
      if (!this.#isRemoteAvailable && e.target.checked) {
        e.target.checked = false;
        this.#emitError('Cannot enable receiving: broker unavailable', 'client');
        return;
      }
      if (e.target.checked) {
        this.#startReceiver();
      } else {
        this.#stopReceiver();
      }
    });

    // Probe name input (debounced, persisted)
    let nameTimer = null;
    probeName?.addEventListener('input', (e) => {
      clearTimeout(nameTimer);
      nameTimer = setTimeout(() => {
        const value = e.target.value.trim();
        setItem(STORAGE_KEY_PROBE_NAME, value);
        if (this.#probe) {
          this.#probe.probeName = value;
        }
      }, NAME_INPUT_DEBOUNCE_MS);
    });

    // Broker URL input (debounced, persisted, triggers availability check)
    let urlTimer = null;
    brokerUrl?.addEventListener('input', (e) => {
      clearTimeout(urlTimer);
      urlTimer = setTimeout(() => {
        const value = e.target.value.trim();
        setItem(STORAGE_KEYS.BROKER_URL, value);

        // Update existing instances
        if (this.#probe) {
          this.#probe.brokerUrl = value;
        }
        if (this.#receiver) {
          this.#receiver.brokerUrl = value;
        }

        // Re-check availability
        this.#checkRemoteAvailability();
      }, URL_INPUT_DEBOUNCE_MS);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: COLLAPSE STATE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Toggle panel collapse state.
   * @private
   */
  #toggleCollapse() {
    this.#isCollapsed = !this.#isCollapsed;
    this.#saveCollapsedState();

    const { content, chevron } = this.#elements;
    if (content) {
      content.hidden = this.#isCollapsed;
      content.style.display = this.#isCollapsed ? 'none' : '';
    }
    if (chevron) {
      chevron.textContent = this.#isCollapsed ? '▶' : '▼';
    }
  }

  /**
   * Load collapse state from localStorage.
   * @private
   * @returns {boolean}
   */
  #loadCollapsedState() {
    try {
      return localStorage.getItem(STORAGE_KEY_COLLAPSED) === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Save collapse state to localStorage.
   * @private
   */
  #saveCollapsedState() {
    try {
      localStorage.setItem(STORAGE_KEY_COLLAPSED, String(this.#isCollapsed));
    } catch {
      // localStorage unavailable; degrade gracefully
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: AVAILABILITY CHECK
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if remote broker is reachable.
   * Performs a quick WebSocket connection test.
   * @private
   * @returns {Promise<boolean>}
   */
  async #checkRemoteAvailability() {
    if (this.#isCheckingAvailability) {
      return this.#isRemoteAvailable;
    }

    this.#isCheckingAvailability = true;
    this.#updateHeaderStatus('checking');

    const { checkBtn, brokerUrl } = this.#elements;
    const originalBtnText = checkBtn?.textContent;
    if (checkBtn) {
      checkBtn.disabled = true;
      checkBtn.textContent = 'Checking…';
    }

    const url = brokerUrl?.value?.trim() || DEFAULT_BROKER_URL;

    try {
      const available = await this.#testWebSocketConnection(url);
      this.#isRemoteAvailable = available;
      this.#updateOverallStatus();
      this.#updateDisabledState();

      console.log(
        `[RemotePanel] Broker ${url}: ${available ? 'available' : 'unavailable'}`
      );

      this.#emitStatus();
      return available;

    } catch (error) {
      console.warn('[RemotePanel] Availability check failed:', error);
      this.#isRemoteAvailable = false;
      this.#overallStatus = 'unavailable';
      this.#updateHeaderStatus('unavailable');
      this.#updateDisabledState();
      this.#emitStatus();
      return false;

    } finally {
      this.#isCheckingAvailability = false;
      if (checkBtn) {
        checkBtn.disabled = false;
        checkBtn.textContent = originalBtnText || 'Check Connection';
      }
    }
  }

  /**
   * Test WebSocket connection to broker.
   * Opens a connection and immediately closes it if successful.
   * @private
   * @param {string} url - WebSocket URL to test
   * @returns {Promise<boolean>}
   */
  #testWebSocketConnection(url) {
    return new Promise((resolve) => {
      let socket = null;
      let timer = null;
      let resolved = false;

      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        if (timer) clearTimeout(timer);
        if (socket) {
          socket.onopen = null;
          socket.onerror = null;
          socket.onclose = null;
          try {
            socket.close();
          } catch {
            // Ignore close errors
          }
        }
      };

      try {
        socket = new WebSocket(url);

        timer = setTimeout(() => {
          cleanup();
          resolve(false);
        }, AVAILABILITY_CHECK_TIMEOUT_MS);

        socket.onopen = () => {
          cleanup();
          resolve(true);
        };

        socket.onerror = () => {
          cleanup();
          resolve(false);
        };

      } catch {
        cleanup();
        resolve(false);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: STATUS UPDATES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Update overall status based on current state.
   * @private
   */
  #updateOverallStatus() {
    if (!this.#isRemoteAvailable) {
      this.#overallStatus = 'unavailable';
    } else if (this.#probe?.isStreaming) {
      this.#overallStatus = 'streaming';
    } else if (this.#receiver?.isConnected) {
      this.#overallStatus = 'connected';
    } else {
      this.#overallStatus = 'available';
    }
    this.#updateHeaderStatus(this.#overallStatus);
  }

  /**
   * Update header status badge.
   * @private
   * @param {string} status - Status key
   */
  #updateHeaderStatus(status) {
    const { headerStatus } = this.#elements;
    if (!headerStatus) return;

    headerStatus.textContent = HEADER_STATUS_TEXT[status] || status;
    headerStatus.className = CSS.HEADER_STATUS;

    switch (status) {
      case 'unavailable':
        headerStatus.classList.add(CSS.STATUS_UNAVAILABLE);
        break;
      case 'available':
        headerStatus.classList.add(CSS.STATUS_ACTIVE);
        break;
      case 'connected':
      case 'streaming':
        headerStatus.classList.add(CSS.STATUS_ACTIVE);
        break;
      case 'error':
        headerStatus.classList.add(CSS.STATUS_ERROR);
        break;
      case 'checking':
        headerStatus.classList.add(CSS.STATUS_CONNECTING);
        break;
    }
  }

  /**
   * Update disabled state of control sections.
   * @private
   */
  #updateDisabledState() {
    const {
      probeSection,
      probeTog,
      clientSection,
      clientTog
    } = this.#elements;

    const disabled = !this.#isRemoteAvailable;

    // Update probe section
    if (probeSection) {
      probeSection.classList.toggle(CSS.SECTION_DISABLED, disabled);
    }
    if (probeTog) {
      probeTog.disabled = disabled;
      if (disabled && probeTog.checked) {
        probeTog.checked = false;
        this.#stopProbe();
      }
    }

    // Update client section
    if (clientSection) {
      clientSection.classList.toggle(CSS.SECTION_DISABLED, disabled);
    }
    if (clientTog) {
      clientTog.disabled = disabled;
      if (disabled && clientTog.checked) {
        clientTog.checked = false;
        this.#stopReceiver();
      }
    }
  }

  /**
   * Update probe section status display.
   * @private
   * @param {string} status - Status key
   */
  #updateProbeStatus(status) {
    const { probeStatus } = this.#elements;
    if (!probeStatus) return;

    probeStatus.textContent = STATUS_TEXT[status] || status;
    probeStatus.className = CSS.STATUS;

    if (status === 'streaming') {
      probeStatus.classList.add(CSS.STATUS_ACTIVE);
    } else if (status === 'error') {
      probeStatus.classList.add(CSS.STATUS_ERROR);
    } else if (status === 'connecting' || status === 'reconnecting') {
      probeStatus.classList.add(CSS.STATUS_CONNECTING);
    }

    this.#updateOverallStatus();
  }

  /**
   * Update client section status display.
   * @private
   * @param {string} status - Status key
   */
  #updateClientStatus(status) {
    const { clientStatus } = this.#elements;
    if (!clientStatus) return;

    clientStatus.textContent = STATUS_TEXT[status] || status;
    clientStatus.className = CSS.STATUS;

    if (status === 'connected') {
      clientStatus.classList.add(CSS.STATUS_ACTIVE);
    } else if (status === 'error' || status === 'disconnected') {
      clientStatus.classList.add(CSS.STATUS_ERROR);
    } else if (status === 'connecting' || status === 'reconnecting') {
      clientStatus.classList.add(CSS.STATUS_CONNECTING);
    }

    this.#updateOverallStatus();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: PROBE MODE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start probe mode (streaming metrics to broker).
   * @private
   */
  async #startProbe() {
    const { probeDetails, probeName, brokerUrl, probeId } = this.#elements;

    // Show details
    if (probeDetails) probeDetails.hidden = false;

    // Create probe sender if needed
    if (!this.#probe) {
      const url = brokerUrl?.value?.trim() || DEFAULT_BROKER_URL;
      const name = probeName?.value?.trim() || undefined;

      this.#probe = new ProbeSender({
        name,
        brokerUrl: url
      });

      // Connect meter sources
      this.#probe.collector.setSources(this.#meters);

      // Subscribe to status changes
      this.#probeStatusUnsubscribe = this.#probe.onStatusChange((status) => {
        this.#updateProbeStatus(status);
      });

      // Show probe ID
      if (probeId) {
        const shortId = this.#probe.probeId.slice(0, 8);
        probeId.textContent = `Probe ID: ${shortId}…`;
      }
    }

    try {
      this.#updateProbeStatus('connecting');
      await this.#probe.start();
    } catch (error) {
      console.error('[RemotePanel] Probe start failed:', error);
      this.#updateProbeStatus('error');
      this.#emitError(error.message, 'probe');

      // Reset toggle
      const { probeTog } = this.#elements;
      if (probeTog) probeTog.checked = false;
    }
  }

  /**
   * Stop probe mode.
   * @private
   */
  #stopProbe() {
    const { probeDetails } = this.#elements;

    if (this.#probe) {
      this.#probe.stop();
    }

    if (probeDetails) probeDetails.hidden = true;
    this.#updateProbeStatus('disabled');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: CLIENT MODE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start client mode (receiving metrics from broker).
   * @private
   */
  async #startReceiver() {
    const { clientDetails, brokerUrl } = this.#elements;

    // Show details
    if (clientDetails) clientDetails.hidden = false;

    // Create receiver if needed
    if (!this.#receiver) {
      const url = brokerUrl?.value?.trim() || DEFAULT_BROKER_URL;

      this.#receiver = new MetricsReceiver({
        brokerUrl: url
      });

      // Subscribe to probe list changes
      this.#receiverUnsubscribes.push(
        this.#receiver.onProbeListChange((probes) => {
          this.#renderProbeList(probes);
        })
      );

      // Subscribe to metrics
      this.#receiverUnsubscribes.push(
        this.#receiver.onMetrics((probeId, metrics) => {
          this.#handleRemoteMetrics(probeId, metrics);
        })
      );

      // Subscribe to connection state
      this.#receiverUnsubscribes.push(
        this.#receiver.onConnectionChange((state) => {
          this.#updateClientStatus(state);
        })
      );
    }

    try {
      this.#updateClientStatus('connecting');
      await this.#receiver.connect();
      this.#receiver.requestProbeList();
    } catch (error) {
      console.error('[RemotePanel] Client connect failed:', error);
      this.#updateClientStatus('error');
      this.#emitError(error.message, 'client');

      // Reset toggle
      const { clientTog } = this.#elements;
      if (clientTog) clientTog.checked = false;
    }
  }

  /**
   * Stop client mode.
   * @private
   */
  #stopReceiver() {
    const { clientDetails, probeList } = this.#elements;

    if (this.#receiver) {
      this.#receiver.disconnect();
    }

    if (clientDetails) clientDetails.hidden = true;
    if (probeList) {
      probeList.innerHTML = `<p class="${CSS.PROBE_EMPTY}">No probes available</p>`;
    }
    this.#updateClientStatus('disabled');
  }

  /**
   * Render available probes list.
   * @private
   * @param {Array<Object>} probes - Available probes
   */
  #renderProbeList(probes) {
    const { probeList } = this.#elements;
    if (!probeList) return;

    if (!probes || probes.length === 0) {
      probeList.innerHTML = `<p class="${CSS.PROBE_EMPTY}">No probes available</p>`;
      return;
    }

    probeList.innerHTML = probes.map(probe => {
      const displayName = this.#escapeHtml(probe.name) ||
                          probe.id.slice(0, 8);
      const location = this.#escapeHtml(probe.location) || '';
      const isSubscribed = this.#receiver?.isSubscribed(probe.id);

      return `
        <div class="${CSS.PROBE_ITEM}"
             data-probe-id="${probe.id}"
             role="listitem">
          <label>
            <input type="checkbox"
                   ${isSubscribed ? 'checked' : ''}
                   aria-label="Subscribe to ${displayName}" />
            <span class="probe-name">${displayName}</span>
            ${location ? `<span class="probe-location">${location}</span>` : ''}
            <span class="probe-latency" id="latency-${probe.id}"></span>
          </label>
        </div>
      `;
    }).join('');

    // Bind subscription toggles
    probeList.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const item = e.target.closest(`.${CSS.PROBE_ITEM}`);
        const probeId = item?.dataset.probeId;
        if (!probeId || !this.#receiver) return;

        if (e.target.checked) {
          this.#receiver.subscribe(probeId);
        } else {
          this.#receiver.unsubscribe(probeId);
        }
      });
    });
  }

  /**
   * Handle received remote metrics.
   * @private
   * @param {string} probeId - Source probe ID
   * @param {Object} metrics - Metrics data
   */
  #handleRemoteMetrics(probeId, metrics) {
    // Update latency display
    this.#updateProbeLatency(probeId);

    // Notify callbacks
    for (const callback of this.#metricsCallbacks) {
      try {
        callback(probeId, metrics);
      } catch (error) {
        console.error('[RemotePanel] Metrics callback error:', error);
      }
    }

    // Emit DOM event
    this.#container.dispatchEvent(new CustomEvent('remote:metrics', {
      detail: { probeId, metrics },
      bubbles: true
    }));
  }

  /**
   * Update latency display for a probe.
   * @private
   * @param {string} probeId - Probe ID
   */
  #updateProbeLatency(probeId) {
    const latencyEl = this.#elements.probeList?.querySelector(`#latency-${probeId}`);
    if (!latencyEl) return;

    const latency = this.#receiver?.getLatency(probeId);
    if (latency !== null && latency !== undefined) {
      latencyEl.textContent = `${latency}ms`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: EVENT EMISSION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Emit status event on container.
   * @private
   */
  #emitStatus() {
    this.#container.dispatchEvent(new CustomEvent('remote:status', {
      detail: {
        status: this.#overallStatus,
        available: this.#isRemoteAvailable
      },
      bubbles: true
    }));
  }

  /**
   * Emit error event on container.
   * @private
   * @param {string} error - Error message
   * @param {string} context - Error context (probe, client, etc.)
   */
  #emitError(error, context) {
    this.#container.dispatchEvent(new CustomEvent('remote:error', {
      detail: { error, context },
      bubbles: true
    }));
  }
}
