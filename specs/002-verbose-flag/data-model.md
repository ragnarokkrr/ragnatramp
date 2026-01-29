# Data Model: Global --verbose Flag

**Branch**: `002-verbose-flag` | **Date**: 2026-01-29

## Overview

This feature introduces no new data entities, no state changes, and no
persistent storage modifications. The `--verbose` flag is a transient
runtime boolean that exists only for the duration of a single CLI
invocation.

## Changed Interfaces

### `HyperVExecutor` Constructor

The executor gains an optional `verbose` field in its options:

```
HyperVExecutor(options?)
  options.powershellPath: string   (default: 'powershell.exe')
  options.verbose:        boolean  (default: false)
```

The `verbose` flag is stored as a private readonly field and read at the
top of `execute()` before spawning.

### `ExecuteOptions` (unchanged)

No changes to per-call options. Verbose is instance-level, not per-call.

### New Module: `src/hyperv/verbose.ts`

Exports:

```
formatCommand(script: string): string
  - Prepends [PS] prefix to first line
  - Indents continuation lines with 5 spaces
  - Wraps output with blank lines (fence)

supportsAnsi(): boolean
  - Returns true if process.stderr is a TTY
  - Pure check, no side effects
```

## State File Changes

None. The `.ragnatramp/state.json` schema is unchanged.

## JSON Output Changes

None. The `--json` mode output structure is unchanged. Verbose output
goes to stderr and is not part of the JSON payload.
