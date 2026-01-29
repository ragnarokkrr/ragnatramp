# Feature Specification: Global --verbose Flag

**Feature Branch**: `002-verbose-flag`
**Created**: 2026-01-29
**Status**: Draft
**Input**: User description: "Add a global CLI flag --verbose. When present, RagnaTramp prints the exact underlying Hyper-V/PowerShell commands it is about to execute, before executing them. The printed commands must be copy-paste runnable. Use a subdued gray style so it's visible but not noisy. When --verbose is absent, do not print any underlying commands. This must not change command behavior or the existing stdout/stderr content from Hyper-V operations."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Debug a Failing VM Operation (Priority: P1)

A user runs `ragnatramp up ragnatramp.yaml --verbose` and a VM creation step fails. Because `--verbose` is active, the user sees the exact PowerShell command that was about to execute, printed in subdued gray text immediately before the operation runs. The user copies that command, pastes it into a PowerShell terminal, and reproduces the error independently to diagnose the root cause.

**Why this priority**: This is the core value proposition. Users need to see the exact commands to debug Hyper-V failures without reading source code.

**Independent Test**: Run any command (e.g., `up`, `halt`, `destroy`) with `--verbose` and confirm that each PowerShell command is printed to stderr in gray before execution. Copy a printed command and paste it into PowerShell to confirm it runs without modification.

**Acceptance Scenarios**:

1. **Given** a valid `ragnatramp.yaml`, **When** the user runs `ragnatramp up ragnatramp.yaml --verbose`, **Then** each PowerShell command is printed to stderr in subdued gray before it executes, and the normal stdout output remains unchanged.
2. **Given** a failing Hyper-V operation, **When** the user runs with `--verbose`, **Then** the last printed command before the error is the exact command that failed, and it is copy-paste runnable in a PowerShell terminal.
3. **Given** a multi-machine configuration, **When** the user runs `ragnatramp up ragnatramp.yaml --verbose`, **Then** every PowerShell invocation across all machines is printed in order of execution.

---

### User Story 2 - Silent Default Behavior (Priority: P2)

A user runs `ragnatramp up ragnatramp.yaml` without `--verbose`. No underlying PowerShell commands are printed. The output is identical to today's behavior.

**Why this priority**: Preserving backward compatibility and clean default output is essential. Users who don't need verbose output must not see any new content.

**Independent Test**: Run any command without `--verbose` and diff the output against the current behavior. The outputs must be identical.

**Acceptance Scenarios**:

1. **Given** a valid config, **When** the user runs `ragnatramp up ragnatramp.yaml` (no `--verbose`), **Then** no PowerShell commands appear in stdout or stderr, and all existing output remains unchanged.
2. **Given** `--json` mode without `--verbose`, **When** the user runs `ragnatramp status ragnatramp.yaml --json`, **Then** the JSON output structure is identical to the current format with no additional fields.

---

### User Story 3 - Pipe-Safe Verbose Output (Priority: P3)

A user runs `ragnatramp up ragnatramp.yaml --verbose 2>verbose.log` to capture verbose command output separately. The gray styling degrades gracefully to plain text when stderr is piped or redirected, preserving readability in log files.

**Why this priority**: Users in enterprise environments frequently redirect output to log files for audit trails. Verbose output must remain useful outside a terminal.

**Independent Test**: Run a command with `--verbose` while redirecting stderr to a file. Open the file and confirm it contains readable, unstyled command text with no ANSI escape codes.

**Acceptance Scenarios**:

1. **Given** stderr is redirected to a file, **When** the user runs with `--verbose`, **Then** the captured verbose output contains plain text commands with no ANSI escape sequences.
2. **Given** stderr is piped to another process, **When** the user runs with `--verbose`, **Then** the piped output is plain text without styling artifacts.

---

### Edge Cases

- What happens when `--verbose` and `--json` are used together? The verbose command output still goes to stderr in gray (or plain text); the JSON output on stdout is unaffected.
- What happens when a PowerShell command contains special characters or very long strings? The printed command must still be copy-paste runnable; no truncation or escaping artifacts.
- What happens when `--verbose` is used with commands that perform no PowerShell operations (e.g., `validate`)? No verbose command lines are printed since no PowerShell commands are executed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: CLI MUST accept a global `--verbose` flag on every command
- **FR-002**: When `--verbose` is present, the CLI MUST print the full PowerShell command string to stderr immediately before each PowerShell invocation
- **FR-003**: Printed commands MUST be copy-paste runnable in a PowerShell terminal without modification
- **FR-004**: Verbose output MUST use subdued gray styling (dim/gray ANSI color) when stderr is a TTY
- **FR-005**: Verbose output MUST omit ANSI escape codes when stderr is not a TTY (pipe, redirect, or non-interactive terminal)
- **FR-006**: When `--verbose` is absent, no PowerShell commands MUST appear in stdout or stderr
- **FR-007**: The `--verbose` flag MUST NOT alter command behavior, execution paths, retry logic, or any functional output
- **FR-008**: The `--verbose` flag MUST NOT add fields to `--json` output or change the JSON structure
- **FR-009**: Verbose output MUST include a recognizable prefix (e.g., `[PS]`) so users can distinguish command lines from other stderr content
- **FR-010**: Each printed command MUST appear as a single logical unit, even if the underlying script spans multiple lines
- **FR-011**: Multi-line commands MUST be visually fenced with a blank line before and after the command block
- **FR-012**: Continuation lines of a multi-line command MUST be indented with spaces to align under the command text after the `[PS] ` prefix

### Assumptions

- **A-001**: Verbose output goes to stderr so it does not interfere with stdout piping or `--json` mode
- **A-002**: The prefix `[PS]` is used to label verbose command lines (chosen for brevity and clarity; "PS" is universally understood as PowerShell)
- **A-003**: Multi-line PowerShell scripts are printed preserving their original line breaks for readability, with the `[PS]` prefix on the first line only. Continuation lines are indented to align under the command text. A blank line is emitted before and after each command block to visually fence it from surrounding output

## Clarifications

### Session 2026-01-29

- Q: How should continuation lines of multi-line commands be presented? → A: Indent continuation lines with spaces aligned under the command text after `[PS] `, plus emit a blank line before and after each command block as a visual fence.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of PowerShell commands executed by any CLI command are printed to stderr when `--verbose` is active
- **SC-002**: Every printed command can be copied from the terminal and executed in a standalone PowerShell session without edits
- **SC-003**: Running any command without `--verbose` produces output byte-identical to the current behavior
- **SC-004**: Verbose output in a non-TTY context contains zero ANSI escape sequences
