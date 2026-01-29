# Implementation Plan: Global --verbose Flag

**Branch**: `002-verbose-flag` | **Date**: 2026-01-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-verbose-flag/spec.md`

## Summary

Add a global `--verbose` CLI flag that prints the exact PowerShell commands
to stderr before each Hyper-V invocation. The flag is a single boolean
threaded from Commander.js parsing into the `HyperVExecutor` constructor
— no global mutable state, no environment variables. The executor is the
sole print site, preventing duplicates. ANSI SGR 90 (bright black / gray)
styling is used when stderr is a TTY; plain text when it is not. No new
dependencies are introduced.

## Technical Context

**Language/Version**: TypeScript 5.4+, Node.js >=20
**Primary Dependencies**: Commander.js 12, js-yaml, ajv (unchanged)
**Storage**: N/A (no data changes)
**Testing**: Node.js built-in `node:test` runner, `assert` module
**Target Platform**: Windows 11 Pro (PowerShell, Hyper-V)
**Project Type**: Single CLI project
**Performance Goals**: Zero measurable overhead when `--verbose` is off
**Constraints**: No new runtime dependencies; verbose output on stderr only
**Scale/Scope**: 8 command handlers, 1 executor class, 1 new helper module

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. User-Space Only | ✅ Pass | No privilege changes; flag is CLI-only |
| II. Safety First | ✅ Pass | Flag is read-only observation; no state mutation |
| III. Idempotent Operations | ✅ Pass | Flag does not alter execution; idempotency preserved |
| IV. Deterministic Naming | ✅ Pass | No naming changes |
| V. Declarative YAML Only | ✅ Pass | No config changes |
| VI. Audit-Friendly Output | ✅ Pass | Verbose output enhances auditability |
| VII. Predictable Failures | ✅ Pass | No failure path changes |
| VIII. Explicit State Management | ✅ Pass | No state changes |
| IX. Explicit CLI Behavior | ✅ Pass | Single-purpose flag, cosmetic styling only, TTY-aware degradation |

All gates pass. No violations to justify.

## Project Structure

### Documentation (this feature)

```text
specs/002-verbose-flag/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (minimal — no data entities)
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
src/
├── cli/
│   ├── index.ts              # Add --verbose to program-level options
│   ├── output.ts             # No changes needed
│   └── commands/
│       ├── up.ts             # Thread verbose into executor
│       ├── validate.ts       # Thread verbose (no-op: no PS calls)
│       ├── plan.ts           # Thread verbose into executor
│       ├── status.ts         # Thread verbose into executor
│       ├── halt.ts           # Thread verbose into executor
│       ├── destroy.ts        # Thread verbose into executor
│       ├── checkpoint.ts     # Thread verbose into executor
│       └── restore.ts        # Thread verbose into executor
├── hyperv/
│   ├── executor.ts           # Accept verbose boolean; print before spawn
│   ├── verbose.ts            # NEW: formatCommand(), supportsAnsi()
│   └── (other files unchanged)
└── (other dirs unchanged)

tests/
└── unit/
    └── hyperv/
        ├── executor.test.ts  # Existing (add verbose tests)
        └── verbose.test.ts   # NEW: unit tests for formatCommand, supportsAnsi
```

**Structure Decision**: Single project layout. One new file
(`src/hyperv/verbose.ts`) for the formatting helper. Tests added alongside
existing test structure.

## Complexity Tracking

No constitution violations. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none)    |            |                                     |
