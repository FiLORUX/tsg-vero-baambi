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
 * REMOTE PANEL UI
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Provides the user interface for remote metering functionality. Renders controls
 * for toggling probe mode (streaming metrics out) and client mode (receiving
 * remote metrics for display).
 *
 * DESIGN PRINCIPLES
 * ─────────────────
 * - Progressive disclosure: advanced settings hidden until needed
 * - Clear status indication: connection state always visible
 * - Graceful degradation: works offline, remote features purely additive
 * - Consistent styling: matches existing VERO-BAAMBI visual language
 *
 * @module remote/ui/remote-panel
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { ProbeSender } from '../probe/index.js';
import { MetricsReceiver } from '../client/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CSS class names for styling consistency.
 * @type {Object}
 */
const CSS = Object.freeze({
  PANEL: 'remote-panel',
  SECTION: 'remote-section',
  TOGGLE: 'remote-toggle',
  STATUS: 'remote-status',
  INPUT: 'remote-input',
  BUTTON: 'remote-btn',
  ACTIVE: 'active',
  ERROR: 'error',
  CONNECTING: 'connecting',
  PROBE_LIST: 'remote-probe-list',
  PROBE_ITEM: 'remote-probe-item'
});

/**
 * Status text mappings.
 * @type {Object}
 */
const STATUS_TEXT = Object.freeze({
  disabled: 'Disabled',
  connecting: 'Connecting…',
  streaming: 'Streaming',
  reconnecting: 'Reconnecting…',
  error: 'Error',
  connected: 'Connected',
  disconnected: 'Disconnected'
});

/**
 * LocalStorage key for panel collapse state.
 * @type {string}
 */
const STORAGE_KEY_COLLAPSED = 'vero-baambi-remote-collapsed';

// ─────────────────────────────────────────────────────────────────────────────
// REMOTE PANEL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Remote metering panel UI component.
 *
 * Manages both probe (sender) and client (receiver) modes with unified
 * settings and status display.
 *
 * @example
 * const panel = new RemotePanel({
 *   container: document.getElementById('remoteSection'),
 *   meters: { lufsMeter, truePeakMeter, ppmMeter }
 * });
 */
export class RemotePanel {
  /** @type {HTMLElement} */
  #container;

  /** @type {ProbeSender|null} */
  #probe = null;

  /** @type {MetricsReceiver|null} */
  #receiver = null;

  /** @type {Object} */
  #meters;

  /** @type {Object<string, HTMLElement>} */
  #elements = {};

  /** @type {function(): void|null} */
  #probeUnsubscribe = null;

  /** @type {function(): void|null} */
  #receiverUnsubscribes = [];

  /** @type {function(string, Object): void|null} */
  #metricsCallback = null;

  /** @type {boolean} */
  #isCollapsed = false;

  /**
   * Create a remote panel.
   *
   * @param {Object} config - Configuration
   * @param {HTMLElement} config.container - Container element
   * @param {Object} config.meters - Meter instances for probe mode
   * @param {Object} [config.meters.lufsMeter] - LUFS meter
   * @param {Object} [config.meters.truePeakMeter] - True peak meter
   * @param {Object} [config.meters.ppmMeter] - PPM meter
   */
  constructor(config) {
    this.#container = config.container;
    this.#meters = config.meters || {};
    this.#isCollapsed = this.#loadCollapsedState();

    this.#render();
    this.#bindEvents();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the probe sender instance.
   * @returns {ProbeSender|null}
   */
  get probe() {
    return this.#probe;
  }

  /**
   * Get the metrics receiver instance.
   * @returns {MetricsReceiver|null}
   */
  get receiver() {
    return this.#receiver;
  }

  /**
   * Register callback for received remote metrics.
   *
   * @param {function(string, Object): void} callback - (probeId, metrics) => void
   * @returns {function(): void} Unsubscribe function
   */
  onRemoteMetrics(callback) {
    this.#metricsCallback = callback;
    return () => { this.#metricsCallback = null; };
  }

  /**
   * Update panel visibility.
   * @param {boolean} visible - Whether panel should be visible
   */
  setVisible(visible) {
    if (this.#container) {
      this.#container.style.display = visible ? '' : 'none';
    }
  }

  /**
   * Clean up resources.
   */
  dispose() {
    this.#stopProbe();
    this.#stopReceiver();
    this.#probeUnsubscribe?.();
    this.#receiverUnsubscribes.forEach(fn => fn?.());
    this.#elements = {};
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: RENDERING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Render panel HTML.
   * @private
   */
  #render() {
    this.#container.innerHTML = `
      <div class="${CSS.PANEL}">
        <h3 class="remote-header">
          <span class="remote-icon">📡</span>
          <span>Remote</span>
          <span class="remote-chevron">${this.#isCollapsed ? '▶' : '▼'}</span>
        </h3>

        <div class="remote-content" style="${this.#isCollapsed ? 'display:none' : ''}">
          <!-- Probe Mode Section -->
          <div class="${CSS.SECTION}" data-mode="probe">
            <label class="${CSS.TOGGLE}">
              <input type="checkbox" id="remoteProbeTog" />
              <span class="toggle-label">Stream Metrics</span>
              <span id="remoteProbeStatus" class="${CSS.STATUS}">Disabled</span>
            </label>

            <div class="remote-details" id="remoteProbeDetails" style="display:none">
              <div class="remote-field">
                <label for="remoteProbeName">Name</label>
                <input type="text" id="remoteProbeName" class="${CSS.INPUT}"
                       placeholder="Studio A" maxlength="32" />
              </div>
              <div class="remote-field">
                <label for="remoteBrokerUrl">Broker</label>
                <input type="text" id="remoteBrokerUrl" class="${CSS.INPUT}"
                       placeholder="ws://localhost:8765" />
              </div>
              <div class="remote-info">
                <span id="remoteProbeId" class="remote-id"></span>
              </div>
            </div>
          </div>

          <!-- Client Mode Section -->
          <div class="${CSS.SECTION}" data-mode="client">
            <label class="${CSS.TOGGLE}">
              <input type="checkbox" id="remoteClientTog" />
              <span class="toggle-label">Receive Remote</span>
              <span id="remoteClientStatus" class="${CSS.STATUS}">Disabled</span>
            </label>

            <div class="remote-details" id="remoteClientDetails" style="display:none">
              <div class="${CSS.PROBE_LIST}" id="remoteProbeList">
                <div class="remote-empty">No probes available</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Cache element references
    this.#elements = {
      header: this.#container.querySelector('.remote-header'),
      content: this.#container.querySelector('.remote-content'),
      chevron: this.#container.querySelector('.remote-chevron'),
      probeTog: this.#container.querySelector('#remoteProbeTog'),
      probeStatus: this.#container.querySelector('#remoteProbeStatus'),
      probeDetails: this.#container.querySelector('#remoteProbeDetails'),
      probeName: this.#container.querySelector('#remoteProbeName'),
      brokerUrl: this.#container.querySelector('#remoteBrokerUrl'),
      probeId: this.#container.querySelector('#remoteProbeId'),
      clientTog: this.#container.querySelector('#remoteClientTog'),
      clientStatus: this.#container.querySelector('#remoteClientStatus'),
      clientDetails: this.#container.querySelector('#remoteClientDetails'),
      probeList: this.#container.querySelector('#remoteProbeList')
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: EVENT BINDING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Bind UI event handlers.
   * @private
   */
  #bindEvents() {
    const { header, probeTog, clientTog, probeName, brokerUrl } = this.#elements;

    // Header collapse toggle
    header?.addEventListener('click', () => this.#toggleCollapse());

    // Probe mode toggle
    probeTog?.addEventListener('change', (e) => {
      if (e.target.checked) {
        this.#startProbe();
      } else {
        this.#stopProbe();
      }
    });

    // Client mode toggle
    clientTog?.addEventListener('change', (e) => {
      if (e.target.checked) {
        this.#startReceiver();
      } else {
        this.#stopReceiver();
      }
    });

    // Probe name change (debounced)
    let nameTimer = null;
    probeName?.addEventListener('input', (e) => {
      clearTimeout(nameTimer);
      nameTimer = setTimeout(() => {
        if (this.#probe) {
          this.#probe.probeName = e.target.value;
        }
      }, 300);
    });

    // Broker URL change (debounced)
    let urlTimer = null;
    brokerUrl?.addEventListener('input', (e) => {
      clearTimeout(urlTimer);
      urlTimer = setTimeout(() => {
        if (this.#probe) {
          this.#probe.brokerUrl = e.target.value;
        }
        if (this.#receiver) {
          this.#receiver.brokerUrl = e.target.value;
        }
      }, 500);
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
    if (content) content.style.display = this.#isCollapsed ? 'none' : '';
    if (chevron) chevron.textContent = this.#isCollapsed ? '▶' : '▼';
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
      // Ignore
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: PROBE MODE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start probe mode.
   * @private
   */
  async #startProbe() {
    const { probeDetails, probeStatus, probeName, brokerUrl, probeId } = this.#elements;

    // Show details
    if (probeDetails) probeDetails.style.display = '';

    // Create probe if needed
    if (!this.#probe) {
      this.#probe = new ProbeSender({
        name: probeName?.value || undefined,
        brokerUrl: brokerUrl?.value || undefined
      });

      // Connect meter sources
      this.#probe.collector.setSources(this.#meters);

      // Listen for status changes
      this.#probeUnsubscribe = this.#probe.onStatusChange((status) => {
        this.#updateProbeStatus(status);
      });

      // Populate fields from persisted values
      if (probeName) probeName.value = this.#probe.probeName || '';
      if (brokerUrl) brokerUrl.value = this.#probe.brokerUrl || '';
      if (probeId) probeId.textContent = `ID: ${this.#probe.probeId.slice(0, 8)}…`;
    }

    try {
      this.#updateProbeStatus('connecting');
      await this.#probe.start();
    } catch (error) {
      console.error('[RemotePanel] Probe start failed:', error);
      this.#updateProbeStatus('error');

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

    // Hide details
    if (probeDetails) probeDetails.style.display = 'none';
    this.#updateProbeStatus('disabled');
  }

  /**
   * Update probe status display.
   * @private
   */
  #updateProbeStatus(status) {
    const { probeStatus } = this.#elements;
    if (!probeStatus) return;

    probeStatus.textContent = STATUS_TEXT[status] || status;
    probeStatus.className = CSS.STATUS;

    if (status === 'streaming') {
      probeStatus.classList.add(CSS.ACTIVE);
    } else if (status === 'error') {
      probeStatus.classList.add(CSS.ERROR);
    } else if (status === 'connecting' || status === 'reconnecting') {
      probeStatus.classList.add(CSS.CONNECTING);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: CLIENT MODE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start client mode.
   * @private
   */
  async #startReceiver() {
    const { clientDetails, brokerUrl } = this.#elements;

    // Show details
    if (clientDetails) clientDetails.style.display = '';

    // Create receiver if needed
    if (!this.#receiver) {
      this.#receiver = new MetricsReceiver({
        brokerUrl: brokerUrl?.value || undefined
      });

      // Listen for probe list changes
      this.#receiverUnsubscribes.push(
        this.#receiver.onProbeListChange((probes) => {
          this.#renderProbeList(probes);
        })
      );

      // Listen for metrics
      this.#receiverUnsubscribes.push(
        this.#receiver.onMetrics((probeId, metrics) => {
          this.#metricsCallback?.(probeId, metrics);
          this.#updateProbeLatency(probeId, metrics);
        })
      );

      // Listen for connection state
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

    // Hide details and clear probe list
    if (clientDetails) clientDetails.style.display = 'none';
    if (probeList) probeList.innerHTML = '<div class="remote-empty">No probes available</div>';
    this.#updateClientStatus('disabled');
  }

  /**
   * Update client status display.
   * @private
   */
  #updateClientStatus(state) {
    const { clientStatus } = this.#elements;
    if (!clientStatus) return;

    const text = STATUS_TEXT[state] || state;
    clientStatus.textContent = text;
    clientStatus.className = CSS.STATUS;

    if (state === 'connected') {
      clientStatus.classList.add(CSS.ACTIVE);
    } else if (state === 'error' || state === 'disconnected') {
      clientStatus.classList.add(CSS.ERROR);
    } else if (state === 'connecting' || state === 'reconnecting') {
      clientStatus.classList.add(CSS.CONNECTING);
    }
  }

  /**
   * Render available probe list.
   * @private
   */
  #renderProbeList(probes) {
    const { probeList } = this.#elements;
    if (!probeList) return;

    if (!probes || probes.length === 0) {
      probeList.innerHTML = '<div class="remote-empty">No probes available</div>';
      return;
    }

    probeList.innerHTML = probes.map(probe => `
      <div class="${CSS.PROBE_ITEM}" data-probe-id="${probe.id}">
        <label>
          <input type="checkbox"
                 ${this.#receiver?.isSubscribed(probe.id) ? 'checked' : ''} />
          <span class="probe-name">${probe.name || probe.id.slice(0, 8)}</span>
          <span class="probe-location">${probe.location || ''}</span>
          <span class="probe-latency" id="latency-${probe.id}"></span>
        </label>
      </div>
    `).join('');

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
   * Update latency display for a probe.
   * @private
   */
  #updateProbeLatency(probeId, metrics) {
    const latencyEl = this.#elements.probeList?.querySelector(`#latency-${probeId}`);
    if (!latencyEl) return;

    const latency = this.#receiver?.getLatency(probeId);
    if (latency !== null && latency !== undefined) {
      latencyEl.textContent = `${latency}ms`;
    }
  }
}
