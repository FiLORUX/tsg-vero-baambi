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
 * EFFICIENT HISTORY PRUNER
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Provides O(log n) pruning for timestamped history arrays, avoiding the O(n²)
 * cost of repeated Array.shift() calls in a while loop.
 *
 * PERFORMANCE CHARACTERISTICS
 * ───────────────────────────
 *   - Binary search to find cutoff index: O(log n)
 *   - Single splice operation for removal: O(n) - but done once, not per element
 *   - Optional requestIdleCallback for bulk operations
 *
 * Compare to naive shift() loop:
 *   - Each shift() is O(n) as all elements must move
 *   - k shifts = O(k × n) → O(n²) worst case when clearing history
 *
 * @module utils/history-pruner
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────

/** @type {number|null} Pending idle callback ID */
let pendingIdleCallback = null;

/** @type {Array<{array: Array, cutoff: number, key: string}>} Queued prune operations */
const pruneQueue = [];

// ─────────────────────────────────────────────────────────────────────────────
// BINARY SEARCH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Binary search to find the first index where array[index].key >= cutoff.
 * Returns array.length if all elements are below cutoff.
 *
 * @param {Array<Object>} array - Sorted array of objects with timestamp key
 * @param {number} cutoff - Cutoff timestamp
 * @param {string} key - Key name for timestamp field (e.g., 't')
 * @returns {number} First index >= cutoff, or array.length
 * @private
 */
function binarySearchCutoff(array, cutoff, key) {
  let low = 0;
  let high = array.length;

  while (low < high) {
    const mid = (low + high) >>> 1;
    if (array[mid][key] < cutoff) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

// ─────────────────────────────────────────────────────────────────────────────
// SYNCHRONOUS PRUNING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prune elements older than cutoff from a sorted timestamped array.
 * Uses binary search + splice for O(log n + removal) instead of O(n²).
 *
 * @param {Array<Object>} array - Array sorted by timestamp (oldest first)
 * @param {number} cutoff - Remove elements with timestamp < cutoff
 * @param {string} [key='t'] - Property name containing timestamp
 * @returns {number} Number of elements removed
 *
 * @example
 * const history = [{t: 100, v: 1}, {t: 200, v: 2}, {t: 300, v: 3}];
 * pruneHistory(history, 250, 't'); // Returns 2, history = [{t: 300, v: 3}]
 */
export function pruneHistory(array, cutoff, key = 't') {
  if (array.length === 0) return 0;

  // Quick check: if newest element is below cutoff, clear everything
  if (array[array.length - 1][key] < cutoff) {
    const removed = array.length;
    array.length = 0;
    return removed;
  }

  // Quick check: if oldest element is at or above cutoff, nothing to prune
  if (array[0][key] >= cutoff) {
    return 0;
  }

  // Binary search to find cutoff index
  const cutoffIndex = binarySearchCutoff(array, cutoff, key);

  if (cutoffIndex > 0) {
    array.splice(0, cutoffIndex);
  }

  return cutoffIndex;
}

/**
 * Quick check if pruning is needed without performing it.
 * Useful for avoiding function call overhead when nothing to prune.
 *
 * @param {Array<Object>} array - Array sorted by timestamp
 * @param {number} cutoff - Cutoff timestamp
 * @param {string} [key='t'] - Property name containing timestamp
 * @returns {boolean} True if array has elements below cutoff
 */
export function needsPruning(array, cutoff, key = 't') {
  return array.length > 0 && array[0][key] < cutoff;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFERRED PRUNING (requestIdleCallback)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schedule pruning to run during idle time.
 * Multiple calls are batched into a single idle callback.
 * Falls back to setTimeout if requestIdleCallback is unavailable.
 *
 * @param {Array<Object>} array - Array to prune
 * @param {number} cutoff - Cutoff timestamp
 * @param {string} [key='t'] - Property name containing timestamp
 */
export function schedulePrune(array, cutoff, key = 't') {
  // Check if this array is already queued
  const existing = pruneQueue.find(item => item.array === array);
  if (existing) {
    // Update cutoff if new one is more recent
    existing.cutoff = Math.max(existing.cutoff, cutoff);
    return;
  }

  pruneQueue.push({ array, cutoff, key });

  // Schedule processing if not already pending
  if (pendingIdleCallback === null) {
    if (typeof requestIdleCallback === 'function') {
      pendingIdleCallback = requestIdleCallback(processPruneQueue, { timeout: 100 });
    } else {
      // Fallback for browsers without requestIdleCallback
      pendingIdleCallback = setTimeout(processPruneQueue, 16);
    }
  }
}

/**
 * Process queued prune operations during idle time.
 * @private
 */
function processPruneQueue() {
  pendingIdleCallback = null;

  while (pruneQueue.length > 0) {
    const { array, cutoff, key } = pruneQueue.shift();
    pruneHistory(array, cutoff, key);
  }
}

/**
 * Cancel any pending deferred prune operations.
 * Call this when disposing resources.
 */
export function cancelPendingPrunes() {
  if (pendingIdleCallback !== null) {
    if (typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(pendingIdleCallback);
    } else {
      clearTimeout(pendingIdleCallback);
    }
    pendingIdleCallback = null;
  }
  pruneQueue.length = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// THROTTLED PRUNING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a throttled pruner that limits how often pruning occurs.
 * Useful when pruning is called frequently (e.g., every frame) but the
 * operation only needs to run periodically.
 *
 * @param {number} [intervalMs=1000] - Minimum interval between prune operations
 * @returns {{prune: function, reset: function}} Throttled prune function and reset
 *
 * @example
 * const throttledPrune = createThrottledPruner(1000);
 *
 * // In 20 Hz loop - pruning actually runs at most once per second
 * throttledPrune.prune(radarHistory, cutoff, 't');
 */
export function createThrottledPruner(intervalMs = 1000) {
  let lastPruneTime = 0;

  return {
    /**
     * Prune if enough time has elapsed since last prune.
     * @param {Array<Object>} array - Array to prune
     * @param {number} cutoff - Cutoff timestamp
     * @param {string} [key='t'] - Property name containing timestamp
     * @returns {number} Elements removed, or 0 if throttled
     */
    prune(array, cutoff, key = 't') {
      const now = performance.now();
      if (now - lastPruneTime < intervalMs) {
        return 0;
      }
      lastPruneTime = now;
      return pruneHistory(array, cutoff, key);
    },

    /**
     * Reset throttle timer, allowing immediate next prune.
     */
    reset() {
      lastPruneTime = 0;
    }
  };
}
