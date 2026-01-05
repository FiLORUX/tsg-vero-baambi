# PROJECT A: Drag-and-Drop System Removal

Complete removal of the legacy drag-and-drop panel system to simplify codebase and improve UX consistency.

**Project ID:** PROJECT-A
**Status:** Complete
**Priority:** High
**Estimated Effort:** 4-6 hours
**Actual Effort:** ~45 minutes
**Risk Level:** Low
**Completed:** 2025-12-31

---

## Objective

Remove all drag-and-drop functionality from VERO-BAAMBI to:

1. Eliminate inconsistent UX (2 draggable vs 8 fixed panels)
2. Reduce codebase complexity by ~400 lines
3. Improve performance (remove drag event listeners)
4. Simplify testing surface
5. Align with broadcast industry UX patterns

---

## Rationale

### Why Remove (Not Extend)?

| Factor | Extend to All | Remove Entirely |
|--------|---------------|-----------------|
| Development time | 40-60h | 4-6h |
| UX consistency | Improved | Optimal |
| Cognitive load | Higher | Lower |
| Maintenance | Ongoing | None |
| Broadcast suitability | Poor | Excellent |

See [UI-ANALYSIS.md](./UI-ANALYSIS.md) for full empirical analysis.

### Industry Alignment

Professional broadcast metering tools (SSL Meter Pro, NUGEN VisLM) use fixed layouts. Operators need:

- Predictable element positions
- Muscle memory preservation
- Zero configuration during live transmission
- Consistent shift handovers

---

## Scope

### Files to Modify

| File | Action | Lines Affected |
|------|--------|----------------|
| `src/app/drag-drop.js` | Delete | -340 |
| `src/app/bootstrap.js` | Remove imports and calls | ~10 |
| `index.html` | Remove CSS classes | ~20 |
| `docs/IMPROVEMENTS.md` | Mark as obsolete | ~5 |

### Components to Remove

1. **JavaScript Module**
   - `src/app/drag-drop.js` — entire file

2. **Bootstrap Integration**
   - `initDragDrop()` call
   - `setupDragAndDrop()` call
   - `isDragLayoutFrozen` variable
   - Related DOM references

3. **CSS Classes**
   - `.dragging` — visual state during drag
   - `.drag-over` — drop target highlight
   - `.transitioning` — swap animation
   - `draggable` attribute on `.meter` elements

4. **HTML Attributes**
   - `draggable="true"` on meter panels

---

## Development Process

### Phase 1: Analysis (30 min)

- [ ] Read `src/app/drag-drop.js` completely
- [ ] Identify all imports in `bootstrap.js`
- [ ] Search for drag-related CSS in `index.html`
- [ ] Document all integration points

### Phase 2: Implementation (2h)

- [ ] Remove `src/app/drag-drop.js`
- [ ] Remove imports from `bootstrap.js`
- [ ] Remove `initDragDrop()` call
- [ ] Remove `setupDragAndDrop()` call
- [ ] Remove `isDragLayoutFrozen` variable and usages
- [ ] Remove drag-related CSS from `index.html`
- [ ] Remove `draggable` attributes from HTML

### Phase 3: Testing (1h)

- [ ] Verify application loads without errors
- [ ] Verify all panels render correctly
- [ ] Verify XY canvas still updates
- [ ] Verify panel collapse/expand still works
- [ ] Verify touch interactions work (scroll, buttons)
- [ ] Run existing test suite
- [ ] Test on mobile viewport

### Phase 4: Documentation (30 min)

- [ ] Update IMPROVEMENTS.md with removal note
- [ ] Update ARCHITECTURE.md if applicable
- [ ] Add inline comments explaining fixed layout decision
- [ ] Create this completion log

### Phase 5: Commit (15 min)

- [ ] Stage all changes
- [ ] Write comprehensive commit message
- [ ] Push to remote

---

## Verification Checklist

### Functional Tests

```
[ ] Application loads without console errors
[ ] All meter panels visible and updating
[ ] XY/Goniometer canvas renders correctly
[ ] LUFS radar canvas renders correctly
[ ] PPM meters animate correctly
[ ] Sidebar panels collapse/expand
[ ] Meter switcher (TP/RMS/Nordic/BBC) works
[ ] Touch scrolling works on mobile
[ ] No orphaned event listeners (check DevTools)
```

### Regression Tests

```
[ ] Existing test suite passes (152 tests)
[ ] Calibration workflow functional
[ ] Remote mode functional
[ ] Settings persistence works
```

### Performance Verification

```
[ ] No drag event listeners in DevTools
[ ] Reduced memory footprint (check heap)
[ ] Smooth 60fps rendering maintained
```

---

## Rollback Plan

If issues discovered post-merge:

1. `git revert <commit-hash>`
2. Push revert commit
3. Document issues in this file
4. Re-evaluate approach

---

## Success Criteria

- [ ] Zero console errors on load
- [ ] All 152 existing tests pass
- [ ] ~340 lines of code removed
- [ ] Consistent panel behaviour (none draggable)
- [ ] Documentation updated

---

## Post-Implementation Notes

### Actual Effort
- Analysis: 10 min
- Implementation: 15 min
- Testing: 5 min
- Documentation: 15 min
- **Total:** ~45 min

### Changes Made
1. **Deleted:** `src/app/drag-drop.js` (340 lines)
2. **Modified:** `src/app/bootstrap.js`
   - Removed import
   - Removed isDragLayoutFrozen variable
   - Simplified ResizeObserver callback
   - Set getLayoutFrozen to always return false
3. **Modified:** `index.html`
   - Removed --drag-transition CSS variable
   - Removed .meter.dragging, .meter.drag-over, .meter.transitioning styles
   - Removed @keyframes pulse-glow
   - Kept .meter:hover styles for visual feedback

### Issues Encountered
None. Clean removal with no unexpected dependencies.

### Lessons Learned
- Well-isolated modules are easy to remove
- The drag-drop system was over-engineered for 2 panels
- Fixed layout is more appropriate for broadcast monitoring

---

## Appendix: Code Removal Reference

### src/app/drag-drop.js (DELETE ENTIRE FILE)

```javascript
// This entire module will be deleted
// ~340 lines of drag-and-drop handling
```

### src/app/bootstrap.js (REMOVE THESE LINES)

```javascript
// REMOVE: Import statement
import { initDragDrop, setupDragAndDrop } from './drag-drop.js';

// REMOVE: Variable declaration
let isDragLayoutFrozen = false;

// REMOVE: initDragDrop call in init()
initDragDrop({
  dom: { xy, spatialMeter },
  layoutCallback: layoutXY,
  setLayoutFrozen: (v) => { isDragLayoutFrozen = v; }
});

// REMOVE: setupDragAndDrop call
setupDragAndDrop();

// REMOVE: isDragLayoutFrozen usage in layoutXY()
if (isDragLayoutFrozen) return;
```

### index.html (REMOVE THESE CSS RULES)

```css
/* REMOVE: Drag state styles */
.meter.dragging { ... }
.meter.drag-over { ... }
.meter.transitioning { ... }
```

### index.html (REMOVE THESE ATTRIBUTES)

```html
<!-- REMOVE: draggable attribute from .meter elements -->
<div class="meter" id="spatialMeter" draggable="true">
<!-- becomes -->
<div class="meter" id="spatialMeter">
```

---

## Related Documents

- [UI-ANALYSIS.md](./UI-ANALYSIS.md) — Full analysis and rationale
- [PROJECT-B-REMOTE-CONTROL.md](./PROJECT-B-REMOTE-CONTROL.md) — Next project after this
