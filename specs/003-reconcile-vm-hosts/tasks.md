# Tasks: Reconcile VM IPs + Sync /etc/hosts

**Input**: Design documents from `/specs/003-reconcile-vm-hosts/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/powershell-scripts.md

**Tests**: Included per user request (task group 6).

**Organization**: Tasks are grouped by user story (P1–P4) to enable independent implementation and testing. User-requested task groups are mapped to user stories as follows:
- Group 1 (State schema) → Phase 2 (Foundational)
- Group 2 (IP discovery) → Phase 3 (US1)
- Group 3 (Reconcile engine) → Phase 3 (US1)
- Group 4 (Hosts sync) → Phase 4 (US2)
- Group 5 (Orchestration) → Phase 5 (US3)
- Group 6 (Tests) → Distributed across phases
- Group 7 (Docs) → Phase 7 (Polish)

Note: User-requested "fallback (guest-file or guest-cmd) as a pluggable strategy" is out of scope per spec clarification (single-pass only via `Get-VMNetworkAdapter`). The `source` enum supports future extensibility but no fallback is implemented.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Create the new module directory and error infrastructure shared by all stories.

- [ ] T001 Create `src/core/reconcile/` directory structure per plan.md (discovery.ts, diff.ts, hosts.ts, orchestrator.ts as empty module stubs with placeholder exports)
- [ ] T002 [P] Add `ReconcileError` class to `src/core/errors.ts` with codes `RECONCILE_IP_FAILED`, `RECONCILE_HOSTS_FAILED`, `RECONCILE_NO_VMS` and exit code mapping (1, 2, 0)
- [ ] T003 [P] Add `HyperVNetworkAdapter` interface to `src/hyperv/types.ts` with fields: `Name`, `MacAddress`, `SwitchName`, `IPAddresses` per contracts/powershell-scripts.md

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: State schema extension and Hyper-V query infrastructure that ALL user stories depend on.

**CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T004 Add `NetworkState` interface to `src/state/types.ts` with all 7 fields (`ipv4`, `ipv6`, `mac`, `adapterName`, `discoveredAt`, `source`, `previousIpv4`) per data-model.md. Add optional `network?: NetworkState` field to `VMState` interface.
- [ ] T005 Add `updateVMNetwork(machineName: string, network: NetworkState)` method to `src/state/manager.ts` that sets `vm.network` for a given machine and marks state dirty (caller must call `save()`). Also add `clearVMNetwork(machineName: string)` to null out network fields for powered-off VMs while preserving `previousIpv4`.
- [ ] T006 [P] Add `buildGetVMNetworkAdaptersScript(vmName: string): string` to `src/hyperv/commands.ts` per Contract 1 in contracts/powershell-scripts.md. Use `escapePowerShellString()` for vmName. Handle null/array/single-object JSON output.
- [ ] T007 Add `getVMNetworkAdapters(executor, vmName): Promise<HyperVNetworkAdapter[]>` query to `src/hyperv/queries.ts` following existing `getVMs()`/`getVMByName()` patterns. Call `buildGetVMNetworkAdaptersScript()`, execute, parse JSON response.
- [ ] T008 Add `ReconcileResult`, `DiscoveryResult`, `NetworkStateDiff`, `HostsSyncResult`, and `ReconcileOptions` type definitions to `src/core/reconcile/orchestrator.ts` (or a shared types file within the reconcile module) per data-model.md.

**Checkpoint**: Foundation ready — state schema, Hyper-V query, and reconcile types in place. User story implementation can begin.

---

## Phase 3: User Story 1 — Discover and Persist VM IP Addresses (Priority: P1) MVP

**Goal**: `ragnatramp reconcile <file>` discovers IPv4 addresses for all managed VMs via Hyper-V and persists network state into the state file.

**Independent Test**: Run `ragnatramp reconcile ragnatramp.yaml` against a multi-VM environment, inspect state file for `network.ipv4` per VM.

### Tests for User Story 1

- [ ] T009 [P] [US1] Unit test for IPv4 extraction from `IPAddresses` array in `tests/unit/reconcile-discovery.test.ts` — test cases: single IPv4, mixed IPv4+IPv6, no IPv4 (IPv6 only), empty array, multiple adapters (filter by Default Switch)
- [ ] T010 [P] [US1] Unit test for network state diffing in `tests/unit/reconcile-diff.test.ts` — test cases: first discovery (no prior state), IP unchanged, IP changed (verify `previousIpv4`), VM powered off (null fields)
- [ ] T011 [P] [US1] Unit test for state migration in `tests/unit/state-migration.test.ts` — test loading old state files without `network` field, verify `vm.network` is `undefined`, verify first reconcile populates it

### Implementation for User Story 1

- [ ] T012 [US1] Implement `discoverNetworkState(executor, vmName, options?)` in `src/core/reconcile/discovery.ts` — query `getVMNetworkAdapters()`, filter adapter by `SwitchName === 'Default Switch'`, extract first IPv4 via regex `^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$`, collect all IPv6, build and return `DiscoveryResult`
- [ ] T013 [US1] Implement `discoverAllNetworkState(executor, vms, options?)` in `src/core/reconcile/discovery.ts` — iterate managed VMs, call `discoverNetworkState()` per VM, implement polling retry (3s interval, 60s timeout) for running VMs with no IPv4, return `DiscoveryResult[]`
- [ ] T014 [US1] Implement `diffNetworkState(existing, discovered)` in `src/core/reconcile/diff.ts` — compare `existing.network?.ipv4` vs `discovered.ipv4`, set `previousIpv4` on change, preserve on no-change, build final `NetworkStateDiff`, detect duplicate IPs across VMs (warn per R7 in research.md)
- [ ] T015 [US1] Implement initial orchestrator `runReconcile()` in `src/core/reconcile/orchestrator.ts` — steps 1–7 only (discover → fail-fast gate → diff → update state → save). No hosts sync yet. Wire `ReconcileOptions` with `dryRun` and `timeout`. Return `ReconcileResult` with `discovery`, `diffs`, `summary`.
- [ ] T016 [US1] Add mock fixture `tests/fixtures/mock-responses/network-adapters.json` with sample `HyperVNetworkAdapter[]` responses (2 adapters on Default Switch, no adapters, mixed IPv4/IPv6)

**Checkpoint**: `ragnatramp reconcile` discovers IPs and persists network state. No hosts sync yet.

---

## Phase 4: User Story 2 — Sync /etc/hosts Across Running VMs (Priority: P2)

**Goal**: After IP discovery, sync `/etc/hosts` inside each running VM with a managed block containing all peer VM hostnames and IPs.

**Independent Test**: Run `ragnatramp reconcile ragnatramp.yaml`, SSH into each VM, verify `/etc/hosts` contains correct entries for all peers.

### Tests for User Story 2

- [ ] T017 [P] [US2] Unit test for hosts block rendering in `tests/unit/reconcile-hosts.test.ts` — test cases: 2 VMs sorted alphabetically, single VM, empty array, markers present, comment line included
- [ ] T018 [P] [US2] Add mock fixture `tests/fixtures/mock-responses/invoke-command.json` with sample `{ success: true }` and error responses for guest write scenarios

### Implementation for User Story 2

- [ ] T019 [US2] Implement `renderHostsBlock(vms)` in `src/core/reconcile/hosts.ts` — sort by hostname, format `<ipv4> <hostname>` lines, wrap in `# BEGIN RAGNATRAMP` / `# END RAGNATRAMP` markers with comment line per Contract 3
- [ ] T020 [US2] Add `buildSyncHostsScript(vmName, hostsBlock)` to `src/hyperv/commands.ts` per Contract 2 in contracts/powershell-scripts.md — use `Invoke-Command -VMName`, regex replace of existing block, `$ErrorActionPreference = 'Stop'`
- [ ] T021 [US2] Implement `syncHostsToVM(executor, vmName, hostsBlock)` and `syncHostsToAllVMs(executor, vms, hostsBlock)` in `src/core/reconcile/hosts.ts` — per-VM non-fatal (try/catch per VM, collect failures), return `HostsSyncResult[]`
- [ ] T022 [US2] Extend orchestrator `runReconcile()` in `src/core/reconcile/orchestrator.ts` — add steps 8–10: null out network for non-running VMs, render hosts block, call `syncHostsToAllVMs()`. Update `ReconcileResult` with `hostsBlock` and `hostSync` fields.

**Checkpoint**: Full reconcile cycle works — discover IPs, persist state, sync `/etc/hosts` to all running VMs.

---

## Phase 5: User Story 3 — Automatic Reconcile in the Up Workflow (Priority: P3)

**Goal**: `ragnatramp up` automatically runs reconcile after VM creation/start, so VMs are fully configured in one command.

**Independent Test**: Run `ragnatramp up ragnatramp.yaml` from scratch, verify state has IPs and VMs have correct `/etc/hosts` entries without running `reconcile` manually.

### Implementation for User Story 3

- [ ] T023 [US3] Modify `src/cli/commands/up.ts` to insert reconcile step after action execution (step 6.5 per plan.md). Import and call `runReconcile()` with executor, stateManager, config. Wrap in try/catch — reconcile failures are warnings, not fatal to `up`. Include reconcile summary in final report.
- [ ] T024 [US3] Register `reconcile` command in `src/cli/index.ts` — add `reconcile <file>` subcommand with options `--json`, `--verbose` (via `withGlobalOpts()`), `--dry-run`. Wire to handler in `src/cli/commands/reconcile.ts`.
- [ ] T025 [US3] Implement `src/cli/commands/reconcile.ts` standalone command handler — load config, create executor, load state (fail if no state), call `runReconcile()` with options, format human or JSON output, exit with appropriate code (0 success, 1 fail-fast, 2 system error).

**Checkpoint**: `ragnatramp up` includes automatic reconcile. Standalone `reconcile` command available.

---

## Phase 6: User Story 4 — Dry-Run Preview of Reconcile (Priority: P4)

**Goal**: `ragnatramp reconcile --dry-run` previews discovered IPs, state diffs, and rendered hosts block without writing state or touching guests.

**Independent Test**: Run `ragnatramp reconcile ragnatramp.yaml --dry-run`, verify state file checksum unchanged, verify no `Invoke-Command` executed (via `--verbose`).

### Implementation for User Story 4

- [ ] T026 [US4] Add dry-run output formatting to `src/cli/commands/reconcile.ts` — detect `dryRun: true` in `ReconcileResult`, print "Dry run — no changes will be applied." header, format discovered IPs table, state diffs (old → new or "unchanged"), and rendered hosts block per plan.md human output format. Support `--dry-run --json` (return full `ReconcileResult` with `dryRun: true`).
- [ ] T027 [US4] Verify orchestrator dry-run path in `src/core/reconcile/orchestrator.ts` — ensure `dryRun: true` skips state writes (`save()`) and guest commands (`syncHostsToAllVMs()`), but still computes discovery, diffs, and renders hosts block. Set `ReconcileResult.dryRun = true`, `hostSync = []`, `summary.synced = 0`, `summary.failed = 0`.

**Checkpoint**: `--dry-run` works for both human and JSON output modes. No side effects.

---

## Phase 7: User Story Cross-Cutting — Status Display (FR-017)

**Goal**: `ragnatramp status` displays network fields per VM.

- [ ] T028 Modify `src/cli/commands/status.ts` to display `network.ipv4` (or `network.ipv6` if no IPv4), `network.adapterName`, and `network.source` per VM in human-readable output. In `--json` mode, include the full `network` object in each VM's output.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Tests, docs, and quality improvements.

- [ ] T029 [P] Ensure all unit tests pass: run `npm test` against `tests/unit/reconcile-discovery.test.ts`, `tests/unit/reconcile-diff.test.ts`, `tests/unit/reconcile-hosts.test.ts`, `tests/unit/state-migration.test.ts`
- [ ] T030 [P] Verify TypeScript strict mode compliance: run `npm run build` with no errors (noUncheckedIndexedAccess, exactOptionalPropertyTypes, verbatimModuleSyntax)
- [ ] T031 Run quickstart.md validation — verify all usage examples work: `reconcile`, `reconcile --dry-run`, `reconcile --verbose`, `reconcile --json`, `reconcile --dry-run --json`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all user stories
- **Phase 3 (US1: IP Discovery)**: Depends on Phase 2
- **Phase 4 (US2: Hosts Sync)**: Depends on Phase 3 (needs discovery + diff + orchestrator)
- **Phase 5 (US3: Up Integration)**: Depends on Phase 4 (needs full reconcile cycle)
- **Phase 6 (US4: Dry-Run)**: Depends on Phase 5 (needs standalone command registered)
- **Phase 7 (Status Display)**: Depends on Phase 2 only (reads state, no reconcile logic needed)
- **Phase 8 (Polish)**: Depends on all prior phases

### User Story Dependencies

- **US1 (P1)**: Can start after Phase 2 — no story dependencies
- **US2 (P2)**: Depends on US1 (needs discovery results and orchestrator from Phase 3)
- **US3 (P3)**: Depends on US2 (needs full reconcile including hosts sync)
- **US4 (P4)**: Depends on US3 (needs standalone command to add `--dry-run` flag)
- **Status (FR-017)**: Independent of US1–US4 — can start after Phase 2

### Parallel Opportunities

- **Phase 1**: T002 and T003 can run in parallel (different files)
- **Phase 2**: T004 + T006 can run in parallel (different files); T005 depends on T004; T007 depends on T006
- **Phase 3 tests**: T009, T010, T011 can all run in parallel
- **Phase 4 tests**: T017, T018 can run in parallel
- **Phase 7**: T028 can run in parallel with Phases 3–6 (only needs Phase 2)
- **Phase 8**: T029, T030 can run in parallel

---

## Parallel Example: User Story 1

```
# Launch all tests for US1 together:
T009: "Unit test for IPv4 extraction in tests/unit/reconcile-discovery.test.ts"
T010: "Unit test for network state diffing in tests/unit/reconcile-diff.test.ts"
T011: "Unit test for state migration in tests/unit/state-migration.test.ts"

# Then implement sequentially (file dependencies):
T012: discovery.ts (discoverNetworkState)
T013: discovery.ts (discoverAllNetworkState — depends on T012)
T014: diff.ts (diffNetworkState)
T015: orchestrator.ts (runReconcile — depends on T012, T013, T014)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T003)
2. Complete Phase 2: Foundational (T004–T008)
3. Complete Phase 3: User Story 1 (T009–T016)
4. **STOP and VALIDATE**: Run `ragnatramp reconcile ragnatramp.yaml`, verify IPs in state file
5. State file has network data — MVP delivered

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add US1 (IP discovery + state) → Validate → MVP!
3. Add US2 (hosts sync) → Validate → VMs can resolve each other
4. Add US3 (up integration + CLI) → Validate → Full automation
5. Add US4 (dry-run) → Validate → Safety preview available
6. Status display (FR-017) → Can run anytime after Phase 2
7. Polish → All tests green, build clean, quickstart validated

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- User-requested "fallback strategy" (guest-file/guest-cmd) is NOT implemented per spec clarification — only `source: "hyperv"` is used. The `source` enum is extensible for future work.
- Atomic write and backup on state change is ALREADY implemented in `StateManager.save()` (temp file + rename). No additional work needed.
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
