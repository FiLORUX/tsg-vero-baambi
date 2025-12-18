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
 * DOM UTILITIES
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Helper functions for DOM manipulation and CSS variable access.
 *
 * @module utils/dom
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// CSS VARIABLES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get a CSS custom property value from :root.
 *
 * @param {string} name - CSS variable name (with or without --)
 * @returns {string} Trimmed property value
 *
 * @example
 * getCssVar('--ok')     // "#00d4aa"
 * getCssVar('--hot')    // "#ff4444"
 */
export function getCssVar(name) {
  const varName = name.startsWith('--') ? name : `--${name}`;
  return getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
}

/**
 * Set a CSS custom property on :root.
 *
 * @param {string} name - CSS variable name (with or without --)
 * @param {string} value - Value to set
 */
export function setCssVar(name, value) {
  const varName = name.startsWith('--') ? name : `--${name}`;
  document.documentElement.style.setProperty(varName, value);
}

/**
 * Get multiple CSS variables as an object.
 *
 * @param {string[]} names - Array of variable names
 * @returns {Object<string, string>} Object with variable values
 *
 * @example
 * getCssVars(['--ok', '--warn', '--hot'])
 * // { '--ok': '#00d4aa', '--warn': '#ffaa00', '--hot': '#ff4444' }
 */
export function getCssVars(names) {
  const result = {};
  for (const name of names) {
    result[name] = getCssVar(name);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// CANVAS UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set up a canvas for high-DPI rendering.
 *
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @param {number} [width] - Desired CSS width (defaults to element width)
 * @param {number} [height] - Desired CSS height (defaults to element height)
 * @returns {CanvasRenderingContext2D} 2D context with DPI scaling
 *
 * @example
 * const ctx = setupCanvas(canvas, 300, 200);
 * // Canvas is now properly scaled for retina displays
 */
export function setupCanvas(canvas, width, height) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  const w = width ?? rect.width;
  const h = height ?? rect.height;

  // Set actual canvas size in memory (scaled for DPI)
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);

  // Set display size
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  // Scale context to match DPI
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  return ctx;
}

/**
 * Get device pixel ratio.
 *
 * @returns {number} Device pixel ratio
 */
export function getDPR() {
  return window.devicePixelRatio || 1;
}

/**
 * Clear canvas with optional fill colour.
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {string} [fillColour] - Optional background colour
 */
export function clearCanvas(ctx, fillColour) {
  const canvas = ctx.canvas;
  if (fillColour) {
    ctx.fillStyle = fillColour;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ELEMENT CREATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an element with attributes and children.
 *
 * @param {string} tag - Element tag name
 * @param {Object} [attrs] - Attributes to set
 * @param {(Node|string)[]} [children] - Child nodes or text
 * @returns {HTMLElement} Created element
 *
 * @example
 * const btn = createElement('button', { class: 'primary' }, ['Click me']);
 */
export function createElement(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      el.setAttribute(key, value);
    }
  }

  for (const child of children) {
    if (typeof child === 'string') {
      el.appendChild(document.createTextNode(child));
    } else if (child instanceof Node) {
      el.appendChild(child);
    }
  }

  return el;
}

/**
 * Query selector with type casting.
 *
 * @template {HTMLElement} T
 * @param {string} selector - CSS selector
 * @param {Element} [parent=document] - Parent element
 * @returns {T|null} Found element or null
 */
export function $(selector, parent = document) {
  return parent.querySelector(selector);
}

/**
 * Query selector all as array.
 *
 * @template {HTMLElement} T
 * @param {string} selector - CSS selector
 * @param {Element} [parent=document] - Parent element
 * @returns {T[]} Array of found elements
 */
export function $$(selector, parent = document) {
  return Array.from(parent.querySelectorAll(selector));
}

// ─────────────────────────────────────────────────────────────────────────────
// ANIMATION FRAME
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an animation loop with frame timing.
 *
 * @param {function(number, number): boolean|void} callback - Frame callback (dt, time)
 *   Return false to stop the loop
 * @returns {Object} Controller with start(), stop() methods
 *
 * @example
 * const loop = createAnimationLoop((dt, time) => {
 *   render();
 *   if (shouldStop) return false;
 * });
 * loop.start();
 * // later: loop.stop();
 */
export function createAnimationLoop(callback) {
  let frameId = null;
  let lastTime = null;
  let running = false;

  function frame(time) {
    if (!running) return;

    const dt = lastTime === null ? 0 : (time - lastTime) / 1000;
    lastTime = time;

    const result = callback(dt, time);
    if (result === false) {
      running = false;
      return;
    }

    frameId = requestAnimationFrame(frame);
  }

  return {
    start() {
      if (running) return;
      running = true;
      lastTime = null;
      frameId = requestAnimationFrame(frame);
    },

    stop() {
      running = false;
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
    },

    get isRunning() {
      return running;
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RESIZE OBSERVER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a debounced resize observer.
 *
 * @param {HTMLElement} element - Element to observe
 * @param {function(DOMRect): void} callback - Resize callback
 * @param {number} [debounceMs=100] - Debounce delay
 * @returns {ResizeObserver} Observer instance
 */
export function createResizeObserver(element, callback, debounceMs = 100) {
  let timeout = null;

  const observer = new ResizeObserver(entries => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      const entry = entries[0];
      if (entry) {
        callback(entry.contentRect);
      }
    }, debounceMs);
  });

  observer.observe(element);
  return observer;
}
