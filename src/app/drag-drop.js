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
 * DRAG AND DROP SYSTEM
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Enables drag-and-drop reordering of meter panels in the grid.
 * Supports both mouse and touch interactions.
 *
 * FEATURES
 * ────────
 *   - Native HTML5 drag and drop (mouse)
 *   - Touch support for mobile devices
 *   - Canvas state preservation during drag
 *   - Smooth transition animations
 *   - Layout freeze during drag to prevent glitches
 *
 * @module app/drag-drop
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// MODULE STATE
// ─────────────────────────────────────────────────────────────────────────────

// Dependencies initialised via initDragDrop()
let dom = null;
let layoutCallback = null;
let setLayoutFrozen = null;

// Drag state
let draggedElement = null;
let isDragging = false;
const dragOffset = { x: 0, y: 0 };

// ResizeObserver debouncer
const resizeDebouncer = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// INITIALISATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialise drag and drop with required dependencies.
 *
 * @param {Object} deps - Dependencies
 * @param {Object} deps.dom - DOM element references (xy canvas, xyCard)
 * @param {Function} deps.layoutCallback - Function to call after layout changes
 * @param {Function} deps.setLayoutFrozen - Function to set layout frozen state
 */
export function initDragDrop(deps) {
  dom = deps.dom;
  layoutCallback = deps.layoutCallback;
  setLayoutFrozen = deps.setLayoutFrozen;
}

/**
 * Set up drag and drop event listeners.
 * Call after DOM is ready and dependencies are initialised.
 */
export function setupDragAndDrop() {
  const meterPanels = document.querySelectorAll('.meter');

  meterPanels.forEach(panel => {
    panel.addEventListener('mousedown', handleDragStart);
    panel.addEventListener('dragover', handleDragOver);
    panel.addEventListener('drop', handleDrop);
    panel.addEventListener('touchstart', handleTouchStart);
    panel.draggable = true;
    panel.addEventListener('dragstart', handleDragStartNative);
  });

  document.addEventListener('mousemove', handleDragMove);
  document.addEventListener('mouseup', handleDragEnd);
  document.addEventListener('touchmove', handleTouchMove);
  document.addEventListener('touchend', handleTouchEnd);
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT UPDATE SCHEDULER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schedule a layout update with debouncing.
 * @param {HTMLElement} element - Element to track
 * @param {Function} callback - Layout callback function
 */
function scheduleLayoutUpdate(element, callback) {
  if (resizeDebouncer.has(element)) {
    cancelAnimationFrame(resizeDebouncer.get(element));
  }
  const rafId = requestAnimationFrame(() => {
    try {
      resizeDebouncer.delete(element);
      callback();
    } catch (error) {
      console.error('Layout update failed:', error);
      resizeDebouncer.delete(element);
    }
  });
  resizeDebouncer.set(element, rafId);
}

// ─────────────────────────────────────────────────────────────────────────────
// CANVAS STATE PRESERVATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Preserve canvas state before drag operations.
 * Returns a restore function that can be called to restore the state.
 * @returns {Function} Restore function
 */
function preserveCanvasState() {
  if (!dom.xy || !dom.xy.width || !dom.xy.height) {
    return () => {};
  }
  try {
    const ctx = dom.xy.getContext('2d');
    const canvasState = {
      width: dom.xy.width,
      height: dom.xy.height,
      imageData: ctx.getImageData(0, 0, dom.xy.width, dom.xy.height)
    };
    return () => {
      try {
        if (dom.xy.width === canvasState.width && dom.xy.height === canvasState.height) {
          ctx.putImageData(canvasState.imageData, 0, 0);
        }
      } catch (error) {
        console.warn('Canvas restoration failed:', error);
      }
    };
  } catch (error) {
    return () => {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MOUSE DRAG HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

function handleDragStart(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  dragOffset.x = e.clientX - rect.left;
  dragOffset.y = e.clientY - rect.top;
  draggedElement = e.currentTarget;
}

function handleDragStartNative(e) {
  document.querySelectorAll('.meter.dragging').forEach(el => {
    el.classList.remove('dragging');
  });

  draggedElement = e.currentTarget;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/html', e.currentTarget.outerHTML);

  const restoreCanvas = preserveCanvasState();
  setLayoutFrozen(true);
  isDragging = true;

  setTimeout(() => {
    if (draggedElement) {
      draggedElement.classList.add('dragging');
      restoreCanvas();
    }
  }, 0);
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  document.querySelectorAll('.meter').forEach(el => {
    el.classList.remove('drag-over');
  });

  if (e.currentTarget !== draggedElement && e.currentTarget.classList.contains('meter')) {
    e.currentTarget.classList.add('drag-over');
  }
}

function handleDrop(e) {
  e.preventDefault();

  const dropTarget = e.currentTarget;
  dropTarget.classList.remove('drag-over');

  if (draggedElement && dropTarget !== draggedElement && dropTarget.classList.contains('meter')) {
    swapElements(draggedElement, dropTarget);
  }

  setLayoutFrozen(false);

  if (draggedElement) {
    draggedElement.classList.remove('dragging');
    draggedElement = null;
  }

  isDragging = false;

  document.querySelectorAll('.meter').forEach(el => {
    el.classList.remove('drag-over');
  });

  scheduleLayoutUpdate(dom.xyCard, layoutCallback);
}

function handleDragMove(e) {
  if (!draggedElement) return;

  const rect = draggedElement.getBoundingClientRect();
  const currentX = e.clientX;
  const currentY = e.clientY;
  const initialX = rect.left + dragOffset.x;
  const initialY = rect.top + dragOffset.y;

  const distance = Math.sqrt(
    Math.pow(currentX - initialX, 2) + Math.pow(currentY - initialY, 2)
  );

  if (distance > 5 && !isDragging) {
    isDragging = true;
    setLayoutFrozen(true);

    document.querySelectorAll('.meter.dragging').forEach(el => {
      if (el !== draggedElement) {
        el.classList.remove('dragging');
      }
    });

    draggedElement.classList.add('dragging');
  }
}

function handleDragEnd(e) {
  if (draggedElement) {
    draggedElement.classList.remove('dragging');
  }

  draggedElement = null;
  isDragging = false;
  setLayoutFrozen(false);
  scheduleLayoutUpdate(dom.xyCard, layoutCallback);
}

// ─────────────────────────────────────────────────────────────────────────────
// TOUCH DRAG HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

function handleTouchStart(e) {
  const touch = e.touches[0];
  const rect = e.currentTarget.getBoundingClientRect();
  dragOffset.x = touch.clientX - rect.left;
  dragOffset.y = touch.clientY - rect.top;

  draggedElement = e.currentTarget;
  draggedElement.classList.add('dragging');
  isDragging = true;
  setLayoutFrozen(true);

  e.preventDefault();
}

function handleTouchMove(e) {
  if (!isDragging || !draggedElement) return;

  const touch = e.touches[0];
  const elementUnderTouch = document.elementFromPoint(touch.clientX, touch.clientY);

  document.querySelectorAll('.meter').forEach(el => {
    el.classList.remove('drag-over');
  });

  if (elementUnderTouch && elementUnderTouch.classList.contains('meter') && elementUnderTouch !== draggedElement) {
    elementUnderTouch.classList.add('drag-over');
  }

  e.preventDefault();
}

function handleTouchEnd(e) {
  if (!isDragging || !draggedElement) return;

  const touch = e.changedTouches[0];
  const elementUnderTouch = document.elementFromPoint(touch.clientX, touch.clientY);

  if (elementUnderTouch && elementUnderTouch.classList.contains('meter') && elementUnderTouch !== draggedElement) {
    swapElements(draggedElement, elementUnderTouch);
  }

  draggedElement.classList.remove('dragging');
  document.querySelectorAll('.meter').forEach(el => {
    el.classList.remove('drag-over');
  });

  draggedElement = null;
  isDragging = false;
  setLayoutFrozen(false);
  scheduleLayoutUpdate(dom.xyCard, layoutCallback);
}

// ─────────────────────────────────────────────────────────────────────────────
// ELEMENT SWAP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Swap positions of two elements in the DOM.
 * @param {HTMLElement} el1 - First element
 * @param {HTMLElement} el2 - Second element
 */
function swapElements(el1, el2) {
  el1.classList.add('transitioning');
  el2.classList.add('transitioning');

  const temp = document.createElement('div');
  temp.style.display = 'none';

  el1.parentNode.insertBefore(temp, el1);
  el2.parentNode.insertBefore(el1, el2);
  temp.parentNode.insertBefore(el2, temp);
  temp.remove();

  setTimeout(() => {
    el1.classList.remove('transitioning');
    el2.classList.remove('transitioning');
  }, 400);
}
