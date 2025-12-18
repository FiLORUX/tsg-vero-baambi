# Contributing to VERO-BAAMBI

## Code Standards

### Style
- ES2023+ modules
- No transpilation, no build step
- 2-space indentation
- Single quotes for strings
- Semicolons required

### Dependencies
- **Zero runtime dependencies** in core application
- Dev tooling (linting, testing) may use npm, but must not affect production bundle
- No CDN imports in production code

### Documentation
- JSDoc types for all public functions
- Reference standards (EBU, ITU-R, IEC) where applicable
- Explain *why*, not just *what*

## Architecture Principles

1. **Metering modules must be pure** — no DOM access, no side effects
2. **UI components receive data** — they do not fetch or calculate it
3. **All classes with resources implement `dispose()`**
4. **State flows through StateStore** — no direct global mutation
5. **Runnable without server** — must work from `file://` protocol for basic testing

## Before Submitting

1. Run `node tests/metering-verification.js` — all tests must pass
2. Open in Chrome, Firefox, and Safari — no console errors
3. Verify British spelling: `grep -rn "color[^u]" src/` should return nothing
4. Verify no new dependencies in core

## Pull Request Process

1. Create feature branch from `main`
2. Make focused, single-purpose commits
3. Update CHANGELOG.md under [Unreleased]
4. Ensure CI passes (when implemented)
5. Request review

## Reporting Issues

- Include browser version and OS
- Include console output if applicable
- For metering accuracy issues, include test signal details and expected vs actual values
