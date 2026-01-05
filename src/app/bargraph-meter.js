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
 * BARGRAPH METER MODULE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Physics-based 3D carousel for switching between meter displays.
 * Uses continuous circular position model with spring physics and inertia.
 *
 * METER TYPES
 * ───────────
 *   - tp: True Peak (dBTP) ITU-R BS.1770-4
 *   - rms: RMS Level (dBFS) AES17-1998 Full Scale
 *   - nordic: Nordic PPM (−36 to +9) IEC 60268-10 Type I
 *   - bbc: BBC PPM (1 to 7) IEC 60268-10 Type IIa
 *
 * PHYSICS MODEL
 * ─────────────
 *   - N = 4 states on circular topology (mod 4)
 *   - Position is continuous in ℝ, integrated from velocity
 *   - Velocity responds to target error, decays via damping
 *   - Microscopic overshoot allowed before settling
 *
 * EXACT from audio-meters-grid.html lines 4397-4430
 *
 * @module app/bargraph-meter
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const METER_MODE_KEY = 'tsg-meter-mode';
const METER_BADGES = {
  tp: 'TRUE PEAK (dBTP) ITU-R BS.1770-4',
  rms: 'RMS LEVEL (dBFS) AES17-1998 FULL SCALE',
  nordic: 'NORDIC PPM (−36 TO +9) IEC 60268-10 TYPE I',
  bbc: 'BBC PPM (1 TO 7) IEC 60268-10 TYPE IIA',
  sp: 'SAMPLE PEAK (dBFS) IEC 60268-18 / AES17'
};

const N = 5;                           // Number of states
const STEP_DEGREES = 360 / N;          // 72° between states
const STATE_TO_INDEX = { tp: 0, rms: 1, sp: 2, nordic: 3, bbc: 4 };
const INDEX_TO_STATE = ['tp', 'rms', 'sp', 'nordic', 'bbc'];

// Physics constants
const STIFFNESS = 0.15;      // Spring force coefficient (toward target)
const DAMPING = 0.65;        // Velocity retained per frame (lower = more friction = less bounce)
const EPSILON = 0.01;        // Settling threshold (degrees)
const V_EPSILON = 0.001;     // Velocity settling threshold

// ─────────────────────────────────────────────────────────────────────────────
// MODULE STATE
// ─────────────────────────────────────────────────────────────────────────────

let position = 0;            // Continuous position (degrees, ℝ)
let velocity = 0;            // Angular velocity (degrees/frame)
let targetPosition = 0;      // Target position (degrees)
let animationId = null;      // RAF handle

// DOM element references (initialised via setup)
let cylinder = null;
let tabs = null;
let panels = null;
let panelsContainer = null;
let bargraphBadge = null;

// ─────────────────────────────────────────────────────────────────────────────
// PHYSICS FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive logical state index from continuous position.
 * logicalIndex = floor(mod(position / STEP_DEGREES, N))
 * @returns {number} Current logical index (0, 1, 2, or 3)
 */
function getLogicalIndex() {
  const normalised = ((position / STEP_DEGREES) % N + N) % N;
  return Math.floor(normalised);
}

/**
 * Physics integration step.
 * Called every frame via requestAnimationFrame.
 */
function physicsStep() {
  // Compute error (signed distance to target)
  const error = targetPosition - position;

  // Apply spring force to velocity
  velocity += error * STIFFNESS;

  // Apply damping (friction)
  velocity *= DAMPING;

  // Integrate position from velocity
  position += velocity;

  // Update CSS (no transition - we handle animation)
  if (cylinder) {
    cylinder.style.setProperty('--cylinder-angle', position);
  }

  // Check if settled (both position and velocity near zero error)
  const settled = Math.abs(error) < EPSILON && Math.abs(velocity) < V_EPSILON;

  if (!settled) {
    // Continue animation
    animationId = requestAnimationFrame(physicsStep);
  } else {
    // Settled - snap to exact target (imperceptible)
    position = targetPosition;
    velocity = 0;
    if (cylinder) {
      cylinder.style.setProperty('--cylinder-angle', position);
    }
    animationId = null;
  }
}

/**
 * Start or redirect physics simulation toward target.
 */
function startPhysics() {
  if (animationId === null) {
    animationId = requestAnimationFrame(physicsStep);
  }
  // If already running, physics will naturally redirect
  // due to changed targetPosition (no explicit handling needed)
}

/**
 * Update .facing class based on which panel is at front.
 * @param {number} index - Panel index (0, 1, 2, or 3)
 */
function updateFacingPanel(index) {
  if (!panels) return;
  const state = INDEX_TO_STATE[index];
  panels.forEach(panel => {
    panel.classList.toggle('facing', panel.dataset.meter === state);
  });
}

/**
 * Navigate to target state using shortest circular path.
 * Computes both directions, chooses minimum distance.
 * Sets target and starts physics simulation.
 * @param {string} targetState - Target state ('tp', 'rms', 'ppm', or 'bbc')
 */
function navigateTo(targetState) {
  const targetIndex = STATE_TO_INDEX[targetState];
  const currentNorm = ((position / STEP_DEGREES) % N + N) % N;

  // Compute forward and backward distances on the circle
  const forwardDist = ((targetIndex - currentNorm) % N + N) % N;
  const backwardDist = N - forwardDist;

  // Choose direction with minimum absolute distance
  let delta;
  if (forwardDist <= backwardDist) {
    delta = forwardDist;
  } else {
    delta = -backwardDist;
  }

  // Set target position (velocity will carry us there)
  targetPosition = position + delta * STEP_DEGREES;

  // Start physics (or let it continue with new target)
  startPhysics();

  // Update which panel is facing (for pointer-events and opacity)
  updateFacingPanel(targetIndex);

  // Update tabs (visual + ARIA)
  if (tabs) {
    tabs.forEach(tab => {
      const isActive = tab.dataset.meter === targetState;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      tab.setAttribute('tabindex', isActive ? '0' : '-1');

      // Trigger press animation on active tab (trigger-agnostic)
      if (isActive) {
        tab.classList.remove('pressed');
        // Force reflow to restart animation
        void tab.offsetWidth;
        tab.classList.add('pressed');
        // Clean up after animation
        tab.addEventListener('animationend', () => {
          tab.classList.remove('pressed');
        }, { once: true });
      }
    });
  }

  // Update badge
  if (bargraphBadge && METER_BADGES[targetState]) {
    bargraphBadge.textContent = METER_BADGES[targetState];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set up the bargraph meter on a container element.
 * @param {HTMLElement} bargraphMeter - The bargraph meter container element
 * @param {HTMLElement} [badgeEl] - Optional badge element for meter description
 */
export function setupBargraphMeter(bargraphMeter, badgeEl) {
  if (!bargraphMeter) return;

  // Get DOM elements
  tabs = bargraphMeter.querySelectorAll('.bargraph-tab');
  panels = bargraphMeter.querySelectorAll('.bargraph-panel');
  panelsContainer = bargraphMeter.querySelector('.bargraph-panels');
  cylinder = bargraphMeter.querySelector('.bargraph-cylinder');
  bargraphBadge = badgeEl || null;

  // Migrate legacy 'ppm' to 'nordic'
  if (localStorage.getItem(METER_MODE_KEY) === 'ppm') {
    localStorage.setItem(METER_MODE_KEY, 'nordic');
  }

  // Restore saved mode (default: tp)
  const savedMode = localStorage.getItem(METER_MODE_KEY) || 'tp';
  const savedIndex = STATE_TO_INDEX[savedMode] ?? 0;

  // Set initial position without animation
  position = savedIndex * STEP_DEGREES;
  targetPosition = position;
  velocity = 0;

  if (cylinder) {
    cylinder.style.setProperty('--cylinder-angle', position);
  }
  updateFacingPanel(savedIndex);

  if (tabs) {
    tabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.meter === savedMode);
      tab.setAttribute('aria-selected', tab.dataset.meter === savedMode ? 'true' : 'false');
      tab.setAttribute('tabindex', tab.dataset.meter === savedMode ? '0' : '-1');
    });
  }

  if (bargraphBadge && METER_BADGES[savedMode]) {
    bargraphBadge.textContent = METER_BADGES[savedMode];
  }

  // Enable transitions after initial render
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (panelsContainer) panelsContainer.classList.add('bargraph-carousel-ready');
    });
  });

  // Tab click handlers - navigate via continuous position
  if (tabs) {
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const mode = tab.dataset.meter;
        navigateTo(mode);
        localStorage.setItem(METER_MODE_KEY, mode);
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // KEYBOARD NAVIGATION (a11y)
  // ─────────────────────────────────────────────────────────────────────────
  // Left/Right arrows navigate between tabs, Enter/Space activates
  const tabsContainer = bargraphMeter.querySelector('.bargraph-tabs');
  if (tabsContainer && tabs) {
    tabsContainer.addEventListener('keydown', (e) => {
      const tabsArray = Array.from(tabs);
      const currentIndex = tabsArray.findIndex(t => t === document.activeElement);
      if (currentIndex === -1) return;

      let newIndex = currentIndex;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        newIndex = (currentIndex + 1) % tabsArray.length;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        newIndex = (currentIndex - 1 + tabsArray.length) % tabsArray.length;
      } else if (e.key === 'Home') {
        e.preventDefault();
        newIndex = 0;
      } else if (e.key === 'End') {
        e.preventDefault();
        newIndex = tabsArray.length - 1;
      }

      if (newIndex !== currentIndex) {
        const newTab = tabsArray[newIndex];
        newTab.focus();
        // Activate on arrow key (common pattern for tabs)
        const mode = newTab.dataset.meter;
        navigateTo(mode);
        localStorage.setItem(METER_MODE_KEY, mode);
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export { METER_BADGES, navigateTo, getLogicalIndex };
