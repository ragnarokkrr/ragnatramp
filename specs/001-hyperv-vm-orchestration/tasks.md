# Tasks: Ragna Tramp MVP - Hyper-V VM Orchestration

**Input**: Design documents from `/specs/001-hyperv-vm-orchestration/`
**Prerequisites**: plan.md, spec.md (7 user stories), research.md, data-model.md, contracts/config-schema.json

**Tests**: Included per user request. Focus on unit tests for parsing/validation/state, safety tests for unmanaged VM protection.

**Organization**: Tasks follow user-requested order: scaffolding → config → state → PowerShell adapter → commands → docs → safety tests.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Exact file paths included in descriptions

---

## Phase 1: Scaffolding (Project Setup)

**Purpose**: Initialize TypeScript project with build tooling, linting, and test runner

- [x] T001 Create `package.json` with name "ragnatramp", type "module", bin entries for `ragnatramp` and `Ragnatramp`
- [x] T002 Create `tsconfig.json` with ES2022 target, NodeNext module, strict mode, outDir "dist"
- [x] T003 [P] Create `eslint.config.js` with TypeScript rules and recommended settings
- [x] T004 [P] Create `.gitignore` with node_modules, dist, .ragnatramp/, coverage/
- [x] T005 Install runtime dependencies: `commander`, `js-yaml`, `ajv`, `ajv-formats`
- [x] T006 Install dev dependencies: `typescript`, `tsx`, `@types/node`, `@types/js-yaml`, `eslint`
- [x] T007 Create directory structure per plan.md: `src/cli/commands/`, `src/config/`, `src/state/`, `src/hyperv/`, `src/core/`, `src/lib/`
- [x] T008 Create empty `tests/` structure: `tests/unit/`, `tests/integration/`, `tests/fixtures/`
- [x] T009 Add npm scripts: "build", "dev", "test", "lint" in `package.json`
- [x] T010 Create minimal CLI entry point in `src/cli/index.ts` with shebang, version from package.json

**Verification**: Run `npm run build` successfully, `npm run lint` passes, `npm test` runs (no tests yet)

**Checkpoint**: Project scaffolding complete. Can build, lint, and run empty test suite.

---

## Phase 2: Configuration Parsing & Validation

**Purpose**: Load YAML config files and validate against JSON Schema with detailed error messages

### Type Definitions

- [x] T011 [P] Create `src/config/types.ts` with RagnatrampConfig, ProjectConfig, DefaultsConfig, MachineConfig, SettingsConfig interfaces
- [x] T012 [P] Create `src/config/types.ts` with ResolvedMachine and ResolvedConfig interfaces (defaults applied)

### Core Implementation

- [x] T013 Copy `contracts/config-schema.json` to `src/config/schema.json`
- [x] T014 Create `src/config/loader.ts` with `loadYamlFile(path)` function using js-yaml safeLoad
- [x] T015 Create `src/config/validator.ts` with `validateConfig(data)` using ajv, allErrors mode, detailed error formatting
- [x] T016 Create `src/config/resolver.ts` with `resolveConfig(config, configPath)` to apply defaults, merge per-machine overrides

### Unit Tests

- [x] T017 [P] Create `tests/fixtures/valid-configs/minimal.yaml` with project name, defaults, 1 machine
- [x] T018 [P] Create `tests/fixtures/valid-configs/two-vms.yaml` per spec example
- [x] T019 [P] Create `tests/fixtures/valid-configs/three-vms.yaml` per spec example
- [x] T020 [P] Create `tests/fixtures/invalid-configs/missing-machines.yaml`
- [x] T021 [P] Create `tests/fixtures/invalid-configs/invalid-cpu-type.yaml` (cpu: "lots")
- [x] T022 [P] Create `tests/fixtures/invalid-configs/missing-base-image.yaml`
- [x] T023 Create `tests/unit/config/loader.test.ts` with tests: load valid YAML, invalid YAML syntax, file not found
- [x] T024 Create `tests/unit/config/validator.test.ts` with tests: valid config passes, missing fields rejected, invalid types rejected
- [x] T025 Create `tests/unit/config/resolver.test.ts` with tests: defaults applied, per-machine overrides work, paths expanded

**Verification**: `npm test` passes all config tests. Invalid configs produce clear, actionable error messages.

**Checkpoint**: Configuration layer complete. Can load, validate, and resolve YAML configs independently.

---

## Phase 3: State Management

**Purpose**: Persist and manage state tracking created VMs, disks, and checkpoints

### Type Definitions

- [x] T026 [P] Create `src/state/types.ts` with StateFile, VMState, CheckpointState interfaces per data-model.md

### Core Implementation

- [x] T027 Create `src/lib/hash.ts` with `computeConfigHash(path)` returning first 8 chars of SHA256
- [x] T028 Create `src/lib/paths.ts` with `expandPath(path)` resolving ~, env vars; `getStatePath(configPath)` returning `.ragnatramp/state.json`
- [x] T029 Create `src/state/manager.ts` with `StateManager` class: `load()`, `save()`, `exists()`, `create()`, `addVM()`, `removeVM()`, `addCheckpoint()`
- [x] T030 Implement atomic write in StateManager: write to `.state.json.tmp` then rename to `state.json`

### Unit Tests

- [x] T031 [P] Create `tests/unit/lib/hash.test.ts` with tests: deterministic output, 8 char length, different inputs produce different hashes
- [x] T032 [P] Create `tests/unit/lib/paths.test.ts` with tests: ~ expansion, state path relative to config
- [x] T033 Create `tests/unit/state/manager.test.ts` with tests: create new state, load existing, add/remove VM, atomic write safety

**Verification**: `npm test` passes all state tests. State file survives concurrent access (atomic write).

**Checkpoint**: State management complete. Can persist and retrieve state independently.

---

## Phase 4: PowerShell Adapter

**Purpose**: Execute Hyper-V cmdlets via PowerShell and parse JSON responses

### Type Definitions

- [ ] T034 [P] Create `src/hyperv/types.ts` with HyperVVM, VMState enum, HyperVCheckpoint interfaces per data-model.md
- [ ] T035 [P] Create `src/hyperv/types.ts` with CreateVMParams, CreateCheckpointParams interfaces

### Core Implementation

- [ ] T036 Create `src/hyperv/executor.ts` with `HyperVExecutor` class: `execute<T>(script)` spawning powershell.exe with -NoProfile -NonInteractive
- [ ] T037 Add stdout/stderr capture and JSON parsing to executor
- [ ] T038 Add exit code handling with error classification (access denied → exit 2, not found → exit 1)
- [ ] T039 Create `src/hyperv/queries.ts` with `getVMs()`, `getVMByName(name)`, `getVMById(id)`, `getVMSnapshots(vmId)`
- [ ] T040 Create `src/hyperv/commands.ts` with `buildGetVMsScript()` returning PowerShell script string
- [ ] T041 Add `buildCreateVMScript(params)` to commands.ts (New-VM, Set-VM, New-VHD differencing, Add-VMHardDiskDrive, Connect-VMNetworkAdapter, Set-VM Notes)
- [ ] T042 Add `buildStartVMScript(vmId)` to commands.ts
- [ ] T043 Add `buildStopVMScript(vmId, force)` to commands.ts
- [ ] T044 Add `buildRemoveVMScript(vmId)` to commands.ts
- [ ] T045 Add `buildCheckpointVMScript(vmId, name)` to commands.ts
- [ ] T046 Add `buildRestoreVMSnapshotScript(vmId, snapshotId)` to commands.ts
- [ ] T047 Add `buildGetVMSnapshotsScript(vmId)` to queries.ts

### Unit Tests (Mock Spawn)

- [ ] T048 Create `tests/fixtures/mock-responses/get-vms-empty.json` (empty array)
- [ ] T049 Create `tests/fixtures/mock-responses/get-vms-two.json` (two VMs with different states)
- [ ] T050 Create `tests/fixtures/mock-responses/create-vm-success.json` (Id, Name)
- [ ] T051 Create `tests/unit/hyperv/executor.test.ts` with mocked spawn: success path, JSON parsing, error handling
- [ ] T052 Create `tests/unit/hyperv/commands.test.ts` with tests: script strings are well-formed, parameters escaped, all cmdlets present

**Verification**: `npm test` passes all PowerShell adapter tests. Scripts contain correct cmdlets and escaping.

**Checkpoint**: PowerShell adapter complete. Can build and (mock) execute Hyper-V commands.

---

## Phase 5: Core Business Logic

**Purpose**: Planning, reconciliation, preflight checks, and error handling

### Type Definitions

- [ ] T053 [P] Create `src/core/types.ts` with ActionType, Action, ActionDetails interfaces per data-model.md
- [ ] T054 [P] Create `src/core/errors.ts` with RagnatrampError class, ErrorCode enum, HyperVError class

### Core Implementation

- [ ] T055 Create `src/core/naming.ts` with `generateVMName(project, machine, configPath)` returning `{project}-{machine}-{hash8}`
- [ ] T056 Create `src/core/preflight.ts` with `checkHyperVAvailable()`, `checkDefaultSwitch()`, `checkBaseImageExists(path)`
- [ ] T057 Create `src/core/preflight.ts` with `verifyOwnership(vmName, state, actualVM, configPath)` implementing triple verification
- [ ] T058 Create `src/core/planner.ts` with `computePlan(config, state, actualVMs)` returning Action[] for create/start/stop
- [ ] T059 Create `src/core/reconciler.ts` with `executeActions(actions, executor, stateManager)` executing each action and updating state
- [ ] T060 Create `src/lib/logger.ts` with `Logger` class supporting human-readable and JSON output modes

### Unit Tests

- [ ] T061 Create `tests/unit/core/naming.test.ts` with tests: deterministic names, hash uniqueness, pattern matching
- [ ] T062 Create `tests/unit/core/planner.test.ts` with tests: create actions for new VMs, start actions for stopped, no actions when converged
- [ ] T063 Create `tests/unit/core/preflight.test.ts` with tests: ownership passes with all checks, fails with missing state, fails with wrong notes

**Verification**: `npm test` passes all core tests. Planner correctly computes drift.

**Checkpoint**: Core business logic complete. Can plan and execute convergence.

---

## Phase 6: CLI Output Layer

**Purpose**: Consistent human-readable and JSON output formatting

- [ ] T064 Create `src/cli/output.ts` with `OutputFormatter` class: `success()`, `error()`, `action()`, `table()`
- [ ] T065 Add JSON output mode to OutputFormatter, toggled by --json flag
- [ ] T066 Create `src/cli/output.ts` with CommandResult, ActionResult, ErrorOutput types per data-model.md

**Verification**: Output matches quickstart.md examples for both human and JSON modes.

**Checkpoint**: Output layer complete. Ready to implement commands.

---

## Phase 7: User Story 1 - Create and Start VMs (Priority: P1) 🎯 MVP

**Goal**: Implement `ragnatramp up <file>` to create and start VMs from YAML

**Independent Test**: `ragnatramp up ragnatramp.yaml` creates 2-3 VMs in Hyper-V

### Implementation

- [ ] T067 [US1] Register `up` command in `src/cli/index.ts` with `<file>` argument and `--json` option
- [ ] T068 [US1] Create `src/cli/commands/up.ts` with upCommand handler: load config, validate, preflight, plan, reconcile, output
- [ ] T069 [US1] Wire up executor, state manager, planner, reconciler in up command
- [ ] T070 [US1] Add progress output showing each VM being created/started
- [ ] T071 [US1] Handle idempotency: skip create if VM exists in state and Hyper-V

### Tests

- [ ] T072 [P] [US1] Create `tests/integration/up.test.ts` with mocked PowerShell: creates VMs when none exist
- [ ] T073 [P] [US1] Create `tests/integration/up.test.ts` with test: idempotent re-run does nothing

**Verification**: `ragnatramp up` with mocked PowerShell creates expected VMs. Re-run is idempotent.

**Checkpoint**: US1 complete. Core MVP functionality working.

---

## Phase 8: User Story 2 - Validate Configuration (Priority: P2)

**Goal**: Implement `ragnatramp validate <file>` to check config without Hyper-V

**Independent Test**: `ragnatramp validate` reports valid/invalid with clear errors

### Implementation

- [ ] T074 [US2] Register `validate` command in `src/cli/index.ts`
- [ ] T075 [US2] Create `src/cli/commands/validate.ts` with validateCommand handler: load, validate schema, output result
- [ ] T076 [US2] Format validation errors with field path, expected type, actual value
- [ ] T077 [US2] Add optional base image existence warning (non-blocking)

### Tests

- [ ] T078 [P] [US2] Create `tests/integration/validate.test.ts` with tests: valid config exits 0, invalid exits 1 with errors

**Verification**: `ragnatramp validate` correctly validates all fixture configs.

**Checkpoint**: US2 complete. Configuration validation standalone.

---

## Phase 9: User Story 3 - Preview Changes (Priority: P2)

**Goal**: Implement `ragnatramp plan <file>` to show intended actions

**Independent Test**: `ragnatramp plan` shows what would happen without modifying Hyper-V

### Implementation

- [ ] T079 [US3] Register `plan` command in `src/cli/index.ts`
- [ ] T080 [US3] Create `src/cli/commands/plan.ts` with planCommand handler: load, validate, query state, compute plan, display
- [ ] T081 [US3] Format plan output: + for create, ~ for modify, showing CPU/memory/disk details
- [ ] T082 [US3] Ensure plan makes NO Hyper-V modifications (read-only queries only)

### Tests

- [ ] T083 [P] [US3] Create `tests/integration/plan.test.ts` with tests: shows create for new VMs, shows "no changes" when converged

**Verification**: `ragnatramp plan` accurately previews without side effects.

**Checkpoint**: US3 complete. Safe preview capability.

---

## Phase 10: User Story 4 - Check Status (Priority: P2)

**Goal**: Implement `ragnatramp status <file>` to show VM states

**Independent Test**: `ragnatramp status` shows Running/Off states accurately

### Implementation

- [ ] T084 [US4] Register `status` command in `src/cli/index.ts`
- [ ] T085 [US4] Create `src/cli/commands/status.ts` with statusCommand handler: load state, query Hyper-V, format table
- [ ] T086 [US4] Format status as table: NAME, STATE, CPU, MEMORY columns
- [ ] T087 [US4] Handle case: VM in state but missing from Hyper-V (show "Missing")

### Tests

- [ ] T088 [P] [US4] Create `tests/integration/status.test.ts` with tests: shows running VMs, shows missing VMs

**Verification**: `ragnatramp status` accurately reports VM states.

**Checkpoint**: US4 complete. Status visibility working.

---

## Phase 11: User Story 5 - Stop VMs (Priority: P3)

**Goal**: Implement `ragnatramp halt <file> [machine] [--all]` to stop VMs

**Independent Test**: `ragnatramp halt` stops running VMs gracefully

### Implementation

- [ ] T089 [US5] Register `halt` command in `src/cli/index.ts` with optional `[machine]` and `--all` option
- [ ] T090 [US5] Create `src/cli/commands/halt.ts` with haltCommand handler: validate machine name, stop VMs
- [ ] T091 [US5] Implement graceful shutdown with force fallback after timeout
- [ ] T092 [US5] Handle idempotency: skip already-stopped VMs

### Tests

- [ ] T093 [P] [US5] Create `tests/integration/halt.test.ts` with tests: stops running VM, idempotent on stopped

**Verification**: `ragnatramp halt` stops VMs safely.

**Checkpoint**: US5 complete. Resource management working.

---

## Phase 12: User Story 6 - Destroy Environment (Priority: P3)

**Goal**: Implement `ragnatramp destroy <file> [machine] [--all]` to remove VMs safely

**Independent Test**: `ragnatramp destroy` removes only managed VMs, never unmanaged

### Implementation

- [ ] T094 [US6] Register `destroy` command in `src/cli/index.ts` with optional `[machine]` and `--all` option
- [ ] T095 [US6] Create `src/cli/commands/destroy.ts` with destroyCommand handler: ownership verification, stop, remove, delete disk
- [ ] T096 [US6] Implement triple ownership verification before any deletion
- [ ] T097 [US6] Delete differencing VHDX file after VM removal
- [ ] T098 [US6] Update/delete state file after all VMs destroyed

### Safety Tests (CRITICAL)

- [ ] T099 [P] [US6] Create `tests/integration/destroy-safety.test.ts` with test: refuses to delete VM not in state file
- [ ] T100 [P] [US6] Create `tests/integration/destroy-safety.test.ts` with test: refuses to delete VM with wrong Notes marker
- [ ] T101 [P] [US6] Create `tests/integration/destroy-safety.test.ts` with test: refuses to delete VM with non-matching name pattern
- [ ] T102 [P] [US6] Create `tests/integration/destroy-safety.test.ts` with test: warns but continues if unmanaged VM has similar name

**Verification**: `ragnatramp destroy` NEVER deletes unmanaged VMs. All safety tests pass.

**Checkpoint**: US6 complete. Safe destruction working.

---

## Phase 13: User Story 7 - Checkpoints (Priority: P4)

**Goal**: Implement `ragnatramp checkpoint/restore <file> --name <n>`

**Independent Test**: Create checkpoint, restore, verify state

### Implementation

- [ ] T103 [US7] Register `checkpoint` command in `src/cli/index.ts` with `--name` required option
- [ ] T104 [US7] Create `src/cli/commands/checkpoint.ts` with checkpointCommand handler: create checkpoint for each VM
- [ ] T105 [US7] Track checkpoints in state file
- [ ] T106 [US7] Register `restore` command in `src/cli/index.ts` with `--name` required option
- [ ] T107 [US7] Create `src/cli/commands/restore.ts` with restoreCommand handler: stop VMs, restore snapshot
- [ ] T108 [US7] Validate checkpoint exists before restore, clear error if not found

### Tests

- [ ] T109 [P] [US7] Create `tests/integration/checkpoint.test.ts` with tests: creates checkpoint, restores checkpoint

**Verification**: Checkpoints created and restored successfully.

**Checkpoint**: US7 complete. State preservation working.

---

## Phase 14: Documentation

**Purpose**: Create quickstart guide, config reference, and command reference

- [ ] T110 [P] Create `docs/quickstart.md` based on `specs/001-hyperv-vm-orchestration/quickstart.md` (copy and verify)
- [ ] T111 [P] Create `docs/config-reference.md` documenting all YAML fields, types, defaults, examples
- [ ] T112 [P] Create `docs/commands.md` documenting all commands, options, exit codes, examples
- [ ] T113 Update `README.md` with project description, installation, basic usage, links to docs

**Verification**: All documented commands work as described. Examples copy-paste correctly.

**Checkpoint**: Documentation complete.

---

## Phase 15: Polish & Final Validation

**Purpose**: Final cleanup, consistency, and validation

- [ ] T114 Add `--version` flag handling in CLI
- [ ] T115 Add `--help` descriptions for all commands
- [ ] T116 Standardize exit codes across all commands (0=success, 1=user error, 2=system error)
- [ ] T117 Review all error messages for actionable guidance
- [ ] T118 [P] Run all fixture configs through full command cycle (validate, plan, up, status, halt, destroy)
- [ ] T119 [P] Run lint and fix any issues
- [ ] T120 [P] Run test coverage and ensure >80% on config/state/core modules
- [ ] T121 Create `npm pack` and verify package installs correctly

**Verification**: `npm test` passes, lint clean, coverage met, package installs.

**Checkpoint**: MVP complete and release-ready.

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Scaffolding)
    ↓
Phase 2 (Config) ──┬── Phase 3 (State) ──┬── Phase 4 (PowerShell)
                   │                      │
                   └──────────────────────┴─→ Phase 5 (Core) → Phase 6 (Output)
                                                    ↓
                                              Phase 7 (US1) 🎯 MVP
                                                    ↓
                   ┌────────────────────────────────┼────────────────────────────────┐
                   ↓                                ↓                                ↓
            Phase 8 (US2)                   Phase 9 (US3)                    Phase 10 (US4)
                   │                                │                                │
                   └────────────────────────────────┼────────────────────────────────┘
                                                    ↓
                   ┌────────────────────────────────┼────────────────────────────────┐
                   ↓                                ↓
            Phase 11 (US5)                  Phase 12 (US6) + Safety Tests
                   │                                │
                   └────────────────────────────────┘
                                                    ↓
                                            Phase 13 (US7)
                                                    ↓
                                            Phase 14 (Docs)
                                                    ↓
                                            Phase 15 (Polish)
```

### Parallel Opportunities

- **Phase 1**: T003, T004 can run in parallel
- **Phase 2**: T011, T012 (types); T017-T022 (fixtures) can run in parallel
- **Phase 3**: T031, T032 (tests) can run in parallel
- **Phase 4**: T034, T035 (types); T048-T050 (fixtures) can run in parallel
- **Phase 5**: T053, T054 (types) can run in parallel
- **Phases 8-10**: US2, US3, US4 can run in parallel after US1
- **Phase 11-12**: US5, US6 can run in parallel
- **Phase 14**: All doc tasks can run in parallel
- **Phase 15**: T118, T119, T120 can run in parallel

---

## Implementation Strategy

### MVP First (Stop at Phase 7)

1. Complete Phases 1-6: Foundation
2. Complete Phase 7: `up` command (US1)
3. **STOP and VALIDATE**: Test with real Hyper-V
4. Demo: `ragnatramp up` creates working VMs

### Safe Incremental Delivery

1. **Phases 1-6**: Foundation (no Hyper-V changes)
2. **Phase 7**: US1 - Create/Start VMs (first Hyper-V mutations)
3. **Phase 8-10**: US2-4 - Validate, Plan, Status (read-only or no Hyper-V)
4. **Phase 11-12**: US5-6 - Halt, Destroy (destructive, needs safety tests)
5. **Phase 13**: US7 - Checkpoints (additive)
6. **Phases 14-15**: Docs and polish

### Testing Milestones

| After Phase | Can Test |
|-------------|----------|
| 2 | Config validation with real YAML files |
| 3 | State persistence with file operations |
| 4 | PowerShell script generation (no execution) |
| 5 | Planning logic with mocked data |
| 7 | Full `up` flow with mocked PowerShell |
| 12 | Safety tests proving unmanaged VMs protected |
| 15 | Full integration with real Hyper-V |

---

## Notes

- [P] tasks can run in parallel (different files, no dependencies)
- [USx] label maps task to user story for traceability
- Each phase has a verification step - don't proceed until it passes
- Safety tests (T099-T102) are CRITICAL - they prove constitution compliance
- Commit after each task or logical group
- Exit codes: 0=success, 1=user/config error, 2=Hyper-V/system error
