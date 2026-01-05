# VERO-BAAMBI Development Process

Standardised development methodology for UI improvements and feature implementation.

**Version:** 1.0
**Last Updated:** 2025-12-31

---

## Process Overview

All significant changes follow this structured process:

```
┌─────────┐   ┌──────────────┐   ┌────────────┐   ┌──────────┐   ┌────────┐
│ Analyse │──►│ Plan (MD)    │──►│ Implement  │──►│  Test    │──►│ Deploy │
│         │   │              │   │            │   │          │   │        │
└─────────┘   └──────────────┘   └────────────┘   └──────────┘   └────────┘
     │              │                  │               │              │
     ▼              ▼                  ▼               ▼              ▼
  Research     Project MD         Code + Docs     Autonomous      Commit
  Industry     Success criteria   Inline docs     verification    Push
  Empirical    Rollback plan                      152+ tests
```

---

## Phase 1: Analysis

### Requirements

- Empirical research with cited sources
- Industry precedent review
- Architecture impact assessment
- Alternative approaches evaluated
- Decision matrix with clear recommendation

### Deliverable

`docs/UI-ANALYSIS.md` or similar analysis document

### Quality Criteria

| Criterion | Requirement |
|-----------|-------------|
| Research depth | Minimum 5 industry sources |
| Alternatives | At least 3 approaches compared |
| Metrics | Quantified effort estimates |
| Decision clarity | Explicit recommendation with rationale |

---

## Phase 2: Planning

### Requirements

- Detailed project markdown (PROJECT-X-NAME.md)
- File-level change specification
- Phase breakdown with time estimates
- Verification checklist
- Rollback plan
- Success criteria

### Project MD Structure

```markdown
# PROJECT X: Title

**Status:** Planned | In Progress | Complete
**Priority:** High | Medium | Low
**Estimated Effort:** Xh
**Risk Level:** Low | Medium | High

## Objective
Clear statement of what and why

## Scope
### Files to Modify
| File | Action | Lines |
### Components Affected
List with descriptions

## Development Process
### Phase 1: Name (Xh)
- [ ] Task 1
- [ ] Task 2

## Verification Checklist
### Functional Tests
### Regression Tests
### Performance Tests

## Rollback Plan
Step-by-step reversion

## Success Criteria
Measurable outcomes

## Post-Implementation Notes
Actual effort, issues, lessons
```

### Quality Criteria

| Criterion | Requirement |
|-----------|-------------|
| Granularity | Tasks ≤ 2h each |
| Testability | Every change verifiable |
| Reversibility | Complete rollback possible |
| Traceability | Links to analysis document |

---

## Phase 3: Implementation

### Requirements

- No magic numbers (use named constants)
- Pure functions where possible
- No breaking changes to existing APIs
- Inline documentation for non-obvious logic

### Code Quality Standards

```javascript
/**
 * Calculate true peak using polyphase FIR filter.
 *
 * Implements ITU-R BS.1770-4 Annex 2 compliant 4× oversampling
 * using 12-tap polyphase decomposition of 48-tap prototype filter.
 *
 * @param {Float32Array} samples - Input audio samples
 * @returns {number} Maximum intersample peak in linear scale
 */
function calculateTruePeakPolyphase(samples) {
  // Guard: insufficient samples for filter
  if (!samples || samples.length < POLYPHASE_TAPS_PER_PHASE) {
    return 0;
  }
  // ... implementation
}
```

### Commit Standards

```
<type>: <description>

<body - what and why>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`

---

## Phase 4: Testing

### Autonomous Test Requirements

1. **Unit Tests** — Pure function verification
2. **Integration Tests** — Component interaction
3. **Regression Tests** — Existing functionality preserved
4. **Performance Tests** — No degradation

### Test Execution

```bash
# Run all tests
node tests/metering-verification.js
node tests/storage-migration-test.js
node tests/calibration-profiles-test.js
node tests/rest-api-test.js

# Expected: All tests pass
```

### Manual Verification

Browser-based testing for:
- Visual rendering
- User interactions
- Responsive layouts
- Touch functionality

---

## Phase 5: Documentation

### Requirements

- Update relevant docs/*.md files
- Mark obsolete features clearly

### Documentation Checklist

```
[ ] ARCHITECTURE.md updated if structure changed
[ ] IMPROVEMENTS.md updated with new features
[ ] README.md updated if user-facing
[ ] Inline code comments complete
[ ] Project MD post-implementation notes filled
```

---

## Phase 6: Deployment

### Pre-Push Checklist

```
[ ] All tests pass (152+)
[ ] No console errors in browser
[ ] Git status clean
[ ] Commit message follows standard
[ ] Documentation complete
```

### Push Process

```bash
git add -A
git status  # Verify changes
git commit -m "..."
git push
```

---

## Quality Assessment: Project MDs

### PROJECT-A-DRAG-DROP-REMOVAL.md

| Criterion | Score | Notes |
|-----------|-------|-------|
| Objective clarity | 5/5 | Clear purpose with 5 benefits listed |
| Scope definition | 5/5 | File-level detail with line counts |
| Phase breakdown | 5/5 | 5 phases with time estimates |
| Verification | 5/5 | Functional, regression, performance checklists |
| Rollback plan | 5/5 | Single-command reversion |
| Code examples | 5/5 | Exact lines to remove provided |
| **Overall** | **30/30** | Senior-level documentation |

### PROJECT-B-REMOTE-CONTROL.md

| Criterion | Score | Notes |
|-----------|-------|-------|
| Architecture diagram | 5/5 | Clear before/after state |
| Protocol specification | 5/5 | TypeScript interfaces |
| Implementation phases | 5/5 | 5 phases with estimates |
| Security considerations | 5/5 | LAN-only + optional auth |
| Test scenarios | 5/5 | Unit, integration, E2E |
| Success criteria | 5/5 | Measurable metrics |
| **Overall** | **30/30** | Senior-level documentation |

### Industry Alignment

Both project MDs follow best practices from:

- **RFC 2119** — Requirement levels (MUST, SHOULD, MAY)
- **ADR (Architecture Decision Records)** — Decision documentation
- **INVEST criteria** — Independent, Negotiable, Valuable, Estimable, Small, Testable
- **Definition of Done** — Clear completion criteria

---

## Process Compliance Checklist

For each project, verify:

```
[ ] Analysis document exists with research
[ ] Project MD follows template
[ ] All phases have time estimates
[ ] Verification checklist complete
[ ] Rollback plan documented
[ ] Success criteria measurable
[ ] Post-implementation notes template ready
[ ] No breaking changes to existing code
```

---

## Related Documents

- [UI-ANALYSIS.md](./UI-ANALYSIS.md) — Analysis methodology example
- [PROJECT-A-DRAG-DROP-REMOVAL.md](./PROJECT-A-DRAG-DROP-REMOVAL.md) — Removal project
- [PROJECT-B-REMOTE-CONTROL.md](./PROJECT-B-REMOTE-CONTROL.md) — Feature project
- [ARCHITECTURE.md](../ARCHITECTURE.md) — System architecture
- [CONTRIBUTING.md](../CONTRIBUTING.md) — Contribution guidelines
