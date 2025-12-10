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
 * METER SWITCHER MODULE
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Physics-based 3D carousel for switching between meter displays.
 * Uses continuous circular position model with spring physics and inertia.
 *
 * METER TYPES
 * ───────────
 *   - tp: True Peak Level (dBTP)
 *   - rms: RMS Level (dBFS)
 *   - ppm: Nordic PPM (IEC 60268-10)
 *
 * PHYSICS MODEL
 * ─────────────
 *   - N = 3 states on circular topology (mod 3)
 *   - Position is continuous in ℝ, integrated from velocity
 *   - Velocity responds to target error, decays via damping
 *   - Microscopic overshoot allowed before settling
 *
 * EXACT from audio-meters-grid.html lines 4397-4430
 *
 * @module app/meter-switcher
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const METER_MODE_KEY = 'tsg-meter-mode';
const METER_BADGES = {
  tp: 'True Peak Level (dBTP)',
  rms: 'RMS Level (dBFS)',
  ppm: 'Nordic PPM (IEC 60268-10)'
};

const N = 3; // Number of states
const STEP_DEGREES = 360 / N; // 120° between states
const STATE_TO_INDEX = { tp: 0, rms: 1, ppm: 2 };
const INDEX_TO_STATE = ['tp', 'rms', 'ppm'];

// Physics constants
const STIFFNESS = 0.15; // Spring force coefficient (toward target)
const DAMPING = 0.65; // Velocity retained per frame (lower = more friction = less bounce)
const EPSILON = 0.01; // Settling threshold (degrees)
const V_EPSILON = 0.001; // Velocity settling threshold

// ─────────────────────────────────────────────────────────────────────────────
// MODULE STATE
// ─────────────────────────────────────────────────────────────────────────────

let position = 0; // Continuous position (degrees, ℝ)
let velocity = 0; // Angular velocity (degrees/frame)
let targetPosition = 0; // Target position (degrees)
let animationId = null; // RAF handle

// DOM element references (initialised via setup)
let cylinder = null;
let tabs = null;
let panels = null;
let panelsContainer = null;
let meterBadge = null;

// ─────────────────────────────────────────────────────────────────────────────
// PHYSICS FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive logical state index from continuous position.
 * logicalIndex = floor(mod(position / STEP_DEGREES, N))
 * @returns {number} Current logical index (0, 1, or 2)
 */
function getLogicalIndex() {
  const normalized = ((position / STEP_DEGREES) % N + N) % N;
  return Math.floor(normalized);
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
 * @param {number} index - Panel index (0, 1, or 2)
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
 * @param {string} targetState - Target state ('tp', 'rms', or 'ppm')
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
    });
  }

  // Update badge
  if (meterBadge && METER_BADGES[targetState]) {
    meterBadge.textContent = METER_BADGES[targetState];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set up the meter switcher on a container element.
 * @param {HTMLElement} meterSwitcher - The meter switcher container element
 * @param {HTMLElement} [badgeEl] - Optional badge element for meter description
 */
export function setupMeterSwitcher(meterSwitcher, badgeEl) {
  if (!meterSwitcher) return;

  // Get DOM elements
  tabs = meterSwitcher.querySelectorAll('.meter-tab');
  panels = meterSwitcher.querySelectorAll('.meter-panel');
  panelsContainer = meterSwitcher.querySelector('.meter-panels');
  cylinder = meterSwitcher.querySelector('.meter-cylinder');
  meterBadge = badgeEl || null;

  // Restore saved mode (default: tp)
  const savedMode = localStorage.getItem(METER_MODE_KEY) || 'tp';
  const savedIndex = STATE_TO_INDEX[savedMode] || 0;

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

  if (meterBadge && METER_BADGES[savedMode]) {
    meterBadge.textContent = METER_BADGES[savedMode];
  }

  // Enable transitions after initial render
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (panelsContainer) panelsContainer.classList.add('meter-carousel-ready');
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
  const tabsContainer = meterSwitcher.querySelector('.meter-tabs');
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
