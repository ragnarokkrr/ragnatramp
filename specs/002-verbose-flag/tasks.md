# Tasks: Global --verbose Flag

**Input**: Design documents from `/specs/002-verbose-flag/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md

**Tests**: Unit tests are included — explicitly requested in user input ("Add unit tests to verify...").

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root

---

## Phase 1: Setup

**Purpose**: Create the new verbose helper module and wire it into the barrel export.

- [x] T001 [P] Create `src/hyperv/verbose.ts` with `formatCommand()` and `supportsAnsi()`
  - Implement `supportsAnsi(): boolean`
    - Return `Boolean(process.stderr.isTTY)` — truthy when stderr is a real terminal, falsy when piped/redirected
  - Implement `formatCommand(script: string, ansi: boolean): string`
    - Split `script` on `\n` into lines
    - Build output string:
      - Start with `\n` (blank line fence before)
      - First line: `[PS] ` + first line of script + `\n`
      - Each subsequent line: 5 spaces (matching `[PS] ` width) + line content + `\n`
      - End with `\n` (blank line fence after)
    - If `ansi` is `true`, prepend `\x1b[90m` before the opening blank line and append `\x1b[0m` after the closing blank line
    - If `ansi` is `false`, return the plain text as-is
  - Export both functions as named exports
  - Use `verbatimModuleSyntax`-compatible export style (no `export default`)
- [x] T002 [P] Add `export * from './verbose.js';` to `src/hyperv/index.ts`

**Checkpoint**: Verbose helper module exists and compiles (`npm run build` succeeds).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Modify `HyperVExecutor` to accept and act on the `verbose` flag. This MUST be complete before any user story can be verified.

**CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T003 Refactor `HyperVExecutor` constructor in `src/hyperv/executor.ts` to accept an options object
  - Change constructor from `constructor(powershellPath: string = 'powershell.exe')` to `constructor(options?: { powershellPath?: string; verbose?: boolean })`
  - Store `verbose` as `private readonly verbose: boolean` (default `false`)
  - Store `powershellPath` as before (default `'powershell.exe'`)
  - Preserve backward compatibility: if a plain string is passed, treat it as `powershellPath` (OPTIONAL — may break existing callers; prefer options-only if all callers are updated in T005–T012)
- [ ] T004 Add verbose print logic to `execute()` method in `src/hyperv/executor.ts`
  - At the top of `execute()`, before the `spawn()` call, add:
    ```
    if (this.verbose) {
      const formatted = formatCommand(script, supportsAnsi());
      process.stderr.write(formatted);
    }
    ```
  - Import `formatCommand` and `supportsAnsi` from `./verbose.js`
  - This is the ONLY print site — `executeVoid()` delegates to `execute()`, so it is automatically covered

**Checkpoint**: Executor accepts `verbose` and prints commands when enabled. All existing callers still pass `new HyperVExecutor()` (no verbose), so existing behavior is unchanged.

---

## Phase 3: User Story 1 — Debug a Failing VM Operation (Priority: P1) MVP

**Goal**: User can run any command with `--verbose` and see PowerShell commands printed to stderr before execution.

**Independent Test**: Run `ragnatramp up ragnatramp.yaml --verbose` and confirm `[PS]` prefixed commands appear on stderr in gray.

### Implementation for User Story 1

- [ ] T005 [US1] Add `--verbose` as a global option on the Commander program in `src/cli/index.ts`
  - Add `.option('--verbose', 'Print PowerShell commands before execution')` on the `program` object (before any `.command()` calls)
  - Commander will automatically parse it and make it available via `program.opts().verbose`
- [ ] T006 [US1] Thread `verbose` into `upCommand` in `src/cli/commands/up.ts`
  - Add `verbose?: boolean` to `UpCommandOptions` interface
  - Change `const executor = new HyperVExecutor();` to `const executor = new HyperVExecutor({ verbose: options.verbose });`
- [ ] T007 [P] [US1] Thread `verbose` into `planCommand` in `src/cli/commands/plan.ts`
  - Add `verbose?: boolean` to `PlanCommandOptions` interface
  - Change `const executor = new HyperVExecutor();` to `const executor = new HyperVExecutor({ verbose: options.verbose });`
- [ ] T008 [P] [US1] Thread `verbose` into `statusCommand` in `src/cli/commands/status.ts`
  - Add `verbose?: boolean` to `StatusCommandOptions` interface
  - Change `const executor = new HyperVExecutor();` to `const executor = new HyperVExecutor({ verbose: options.verbose });`
- [ ] T009 [P] [US1] Thread `verbose` into `haltCommand` in `src/cli/commands/halt.ts`
  - Add `verbose?: boolean` to `HaltCommandOptions` interface
  - Change `const executor = new HyperVExecutor();` to `const executor = new HyperVExecutor({ verbose: options.verbose });`
- [ ] T010 [P] [US1] Thread `verbose` into `destroyCommand` in `src/cli/commands/destroy.ts`
  - Add `verbose?: boolean` to `DestroyCommandOptions` interface
  - Change `const executor = new HyperVExecutor();` to `const executor = new HyperVExecutor({ verbose: options.verbose });`
- [ ] T011 [P] [US1] Thread `verbose` into `checkpointCommand` in `src/cli/commands/checkpoint.ts`
  - Add `verbose?: boolean` to `CheckpointCommandOptions` interface
  - Change `const executor = new HyperVExecutor();` to `const executor = new HyperVExecutor({ verbose: options.verbose });`
- [ ] T012 [P] [US1] Thread `verbose` into `restoreCommand` in `src/cli/commands/restore.ts`
  - Add `verbose?: boolean` to `RestoreCommandOptions` interface
  - Change `const executor = new HyperVExecutor();` to `const executor = new HyperVExecutor({ verbose: options.verbose });`

**Checkpoint**: Running any command with `--verbose` prints `[PS]` lines to stderr. Running without `--verbose` produces no change.

---

## Phase 4: User Story 2 — Silent Default Behavior (Priority: P2)

**Goal**: Verify that omitting `--verbose` produces zero changes to existing output.

**Independent Test**: Run any command without `--verbose` and confirm stdout/stderr are byte-identical to pre-feature behavior.

### Implementation for User Story 2

No new code is needed — US2 is satisfied by the default `verbose: false` in the executor constructor (T003). This phase exists for verification only.

- [ ] T013 [US2] Verify `validate` command (no executor) is unaffected — run `ragnatramp validate ragnatramp.yaml` and confirm no `[PS]` output in `src/cli/commands/validate.ts`
  - `validate` does not create an `HyperVExecutor`, so no threading is needed. Confirm the command handler does not import or reference the verbose module.

**Checkpoint**: All commands without `--verbose` produce identical output to the pre-feature baseline.

---

## Phase 5: User Story 3 — Pipe-Safe Verbose Output (Priority: P3)

**Goal**: Verbose output omits ANSI escape codes when stderr is not a TTY.

**Independent Test**: Run `ragnatramp up ragnatramp.yaml --verbose 2>verbose.log` and confirm the log file contains no `\x1b` sequences.

### Implementation for User Story 3

No new code is needed — US3 is satisfied by the `supportsAnsi()` check in the verbose helper (T001) and the conditional ANSI wrapping in `formatCommand()` (T001). The executor passes `supportsAnsi()` at call time (T004), so TTY detection is evaluated per-invocation.

- [ ] T014 [US3] Verify ANSI-free output by manually testing `--verbose` with stderr redirected to a file — confirm no escape codes in output

**Checkpoint**: Verbose output degrades to plain text in non-TTY environments.

---

## Phase 6: Tests

**Purpose**: Unit tests for verbose formatting and executor verbose behavior. Explicitly requested by user.

- [ ] T015 [P] Create unit tests for verbose helper in `tests/unit/hyperv/verbose.test.ts`
  - Test `formatCommand()` with single-line script: output starts with `[PS] `, has blank line before and after
  - Test `formatCommand()` with multi-line script: first line has `[PS] ` prefix, continuation lines have 5-space indent, blank line fence
  - Test `formatCommand()` with `ansi: true`: output contains `\x1b[90m` and `\x1b[0m`
  - Test `formatCommand()` with `ansi: false`: output contains no ANSI escape sequences
  - Test `supportsAnsi()` returns a boolean (smoke test — TTY state depends on environment)
- [ ] T016 [P] Add verbose executor tests in `tests/unit/hyperv/executor.test.ts`
  - Test: executor with `verbose: false` (default) does NOT write to `process.stderr` — spy on `process.stderr.write`, call `execute()` with a trivial script, assert spy was NOT called with `[PS]` content (script will fail on non-Hyper-V, but stderr spy fires before spawn)
  - Test: executor with `verbose: true` DOES write to `process.stderr` exactly once per `execute()` call — spy on `process.stderr.write`, call `execute()`, assert spy was called with string containing `[PS]` and the exact script content
  - Test: printed string matches the exact command passed to `execute()` — compare spy argument content against input script
  - Test: executor with `verbose: true` does not change the resolve/reject behavior of `execute()` — functional output is unchanged

**Checkpoint**: All unit tests pass. `npm test` exits 0.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Build verification and cleanup.

- [ ] T017 Run `npm run build` and verify zero TypeScript compilation errors
- [ ] T018 Run `npm test` and verify all tests pass (existing + new)
- [ ] T019 Run quickstart.md validation — manually walk through `specs/002-verbose-flag/quickstart.md` scenarios

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on T001 (verbose helper exists)
- **User Story 1 (Phase 3)**: Depends on T003, T004 (executor accepts verbose)
- **User Story 2 (Phase 4)**: Depends on T005 (CLI option registered) — verification only
- **User Story 3 (Phase 5)**: Depends on T001 (supportsAnsi implemented) — verification only
- **Tests (Phase 6)**: Depends on T001–T004 (implementation exists to test)
- **Polish (Phase 7)**: Depends on all prior phases

### Within Each Phase

- T001 and T002 can run in parallel (different files)
- T003 must complete before T004 (constructor change before usage)
- T005 must complete before T006–T012 (global option before command threading)
- T006–T012 can all run in parallel (different files, same pattern)
- T015 and T016 can run in parallel (different test files)

### Parallel Opportunities

```text
# Phase 1 — all parallel:
Task: T001 Create verbose helper in src/hyperv/verbose.ts
Task: T002 Export verbose module from src/hyperv/index.ts

# Phase 3 — after T005, all command handlers in parallel:
Task: T007 Thread verbose into planCommand
Task: T008 Thread verbose into statusCommand
Task: T009 Thread verbose into haltCommand
Task: T010 Thread verbose into destroyCommand
Task: T011 Thread verbose into checkpointCommand
Task: T012 Thread verbose into restoreCommand

# Phase 6 — both test files in parallel:
Task: T015 Verbose helper tests in tests/unit/hyperv/verbose.test.ts
Task: T016 Executor verbose tests in tests/unit/hyperv/executor.test.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T002)
2. Complete Phase 2: Foundational (T003–T004)
3. Complete Phase 3: User Story 1 (T005–T012)
4. **STOP and VALIDATE**: Test `--verbose` on any command
5. If working, proceed to tests and polish

### Incremental Delivery

1. T001–T002 → Verbose helper ready
2. T003–T004 → Executor prints commands
3. T005–T012 → All commands support `--verbose`
4. T013–T014 → Verify silent default and pipe safety
5. T015–T016 → Unit tests pass
6. T017–T019 → Build, test, validate

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- US2 and US3 require no new code — they are satisfied by the design in US1 (default false, TTY detection)
- The `validate` command has no executor, so it needs no threading — just confirmation
- Total tasks: 19
- Commit after each phase or logical group
