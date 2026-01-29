# Research: Global --verbose Flag

**Branch**: `002-verbose-flag` | **Date**: 2026-01-29

## R1: Verbose Flag Threading Strategy

**Decision**: Pass `verbose: boolean` as a constructor option to
`HyperVExecutor`. Each command handler reads the parsed CLI option and
passes it at construction time.

**Rationale**: The executor is the single site where PowerShell commands
are dispatched. Injecting verbose at construction ensures every `execute()`
and `executeVoid()` call is covered without per-call opt-in. No global
mutable state, no environment variable, no middleware pattern.

**Alternatives considered**:
- Global mutable flag (`process.env.RAGNATRAMP_VERBOSE` or module-level
  boolean): Rejected. Constitution Principle IX forbids hidden global flags.
- Per-call `ExecuteOptions.verbose`: Rejected. Every call site would need
  to remember to pass it, inviting omissions. The executor instance already
  scopes to a single CLI invocation.
- Middleware/interceptor wrapping executor: Rejected. Over-engineered for
  a single boolean.

## R2: ANSI Gray Styling on Windows

**Decision**: Use SGR escape code `\x1b[90m` (bright black / gray) for
verbose prefix and command text, reset with `\x1b[0m`. Detect TTY via
`process.stderr.isTTY`. On Windows 10 1511+ and Windows 11, the conhost
and Windows Terminal both support ANSI natively when `ENABLE_VIRTUAL_
TERMINAL_PROCESSING` is set (Node.js sets this by default for TTY streams).

**Rationale**: Node.js >=16 on Windows enables VT processing for TTY
file descriptors automatically. `process.stderr.isTTY` returns `true` only
when the stream is a genuine terminal, so redirected and piped scenarios
naturally fall through to plain text.

**Alternatives considered**:
- chalk / kleur / picocolors dependency: Rejected. Constitution dependency
  policy prefers Node.js built-ins. Two string constants and one boolean
  check do not justify a dependency.
- `NO_COLOR` / `FORCE_COLOR` env var support: Deferred. The `NO_COLOR`
  convention could be added later without architectural change (just one
  more condition in `supportsAnsi()`). Not needed for MVP.

## R3: Output Channel — stderr vs stdout

**Decision**: Verbose command output goes to `process.stderr.write()`.

**Rationale**: The spec requires that `--verbose` output does not change
functional stdout content. Existing stdout carries human-readable status
or `--json` structured data. Using stderr keeps verbose output orthogonal
to both modes. Users can redirect stderr independently
(`2>verbose.log`).

**Alternatives considered**:
- stdout with custom stream: Rejected. Would interleave with functional
  output and break `--json` pipe consumers.

## R4: Command Formatting

**Decision**: Print commands with `[PS] ` prefix on the first line.
Multi-line scripts indent continuation lines with 5 spaces (matching the
width of `[PS] `). A blank line is emitted before and after each command
block.

**Rationale**: The `[PS]` prefix is short, unambiguous, and universally
recognizable as PowerShell. Indented continuation preserves the
copy-paste-runnable property (the user selects from the first character
after `[PS] ` through the last line). The blank-line fence separates
command blocks from surrounding stderr content (e.g., error output from
a failed command).

**Alternatives considered**:
- `[hyperv]` prefix: User input mentioned this but `[PS]` was adopted in
  the spec clarification phase as more universally understood.
- No prefix, rely on color alone: Rejected. Non-TTY environments would
  have no way to distinguish verbose lines from other stderr.

## R5: Testing Strategy

**Decision**: Unit-test the formatting helper (`formatCommand`,
`supportsAnsi`) in isolation. Test the executor's verbose print behavior
by capturing `process.stderr.write` calls with a mock/spy — no actual
PowerShell needed for these tests. Use Node.js built-in `node:test` and
`assert`.

**Rationale**: The executor's `execute()` spawns a real process, which
makes full-path testing complex in CI. But the verbose print happens
*before* spawning, so we can test it by:
1. Constructing an executor with `verbose: true`
2. Spying on `process.stderr.write`
3. Calling `execute()` (which will fail if no PowerShell, but the spy
   fires first)
4. Asserting the spy received the expected formatted command

The `formatCommand` and `supportsAnsi` helpers are pure functions and
trivially testable.

**Alternatives considered**:
- Integration tests only: Rejected. Verbose output is deterministic and
  should be fast-testable without Hyper-V.
