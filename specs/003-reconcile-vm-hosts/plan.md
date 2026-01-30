# Implementation Plan: Reconcile VM IPs + Sync /etc/hosts

**Branch**: `003-reconcile-vm-hosts` | **Date**: 2026-01-30 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/003-reconcile-vm-hosts/spec.md`

## Summary

Add a `ragnatramp reconcile <file>` command that discovers VM IPv4 addresses via `Get-VMNetworkAdapter`, persists them (plus MAC, IPv6, adapter name, source, and previousIpv4) into the existing state file, and syncs `/etc/hosts` inside each running Linux VM via PowerShell Direct (`Invoke-Command -VMName`). The reconcile step runs automatically after VM creation/start in the `up` workflow. IP discovery uses fail-fast semantics (any running VM without IPv4 aborts reconcile); hosts sync is per-VM non-fatal.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js >=20.0.0, ES modules
**Primary Dependencies**: Commander.js 12, js-yaml 4, ajv 8 (existing); no new runtime deps
**Storage**: `.ragnatramp/state.json` (JSON, atomic write via temp-file + rename)
**Testing**: `node:test` runner with `node:assert` (existing pattern)
**Target Platform**: Windows 11 Pro with Hyper-V, user-space (Hyper-V Administrators group)
**Project Type**: Single CLI project
**Performance Goals**: IP discovery complete within 60s timeout; hosts sync within 5s per VM
**Constraints**: No admin elevation; no SSH; no Ansible; PowerShell cmdlets only; DHCP only (no static IP)
**Scale/Scope**: 1–3 VMs (MVP constraint)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. User-Space Only (NON-NEGOTIABLE) | PASS | `Get-VMNetworkAdapter` and `Invoke-Command -VMName` work under Hyper-V Administrators membership. No elevation needed. |
| II. Safety First (NON-NEGOTIABLE) | PASS | Reconcile only modifies state for VMs already in the state file. Hosts sync uses marker-delimited blocks to avoid touching user content. Ownership verified before guest execution. |
| III. Idempotent Operations | PASS | Multiple reconcile runs produce identical state/hosts. Managed block is replaced atomically each time. |
| IV. Deterministic Naming & Tagging | PASS | Hostnames in `/etc/hosts` derive from the deterministic machine `name` field in config YAML. No new naming introduced. |
| V. Declarative YAML Only (NON-NEGOTIABLE) | PASS | No new YAML scripting. State schema extended with plain data fields. |
| VI. Audit-Friendly Output | PASS | Reconcile supports `--json` and `--verbose` flags. Per-VM results reported. |
| VII. Predictable Failures | PASS | Fail-fast on IP discovery failure; actionable error messages per VM; clear exit codes. |
| VIII. Explicit State Management | PASS | Network data stored in existing `.ragnatramp/state.json`. Atomic writes preserved. Migration handles old state files gracefully. |
| IX. Explicit CLI Behavior | PASS | `--verbose` prints PowerShell commands to stderr (cosmetic only). No behavioral side effects from flags. |

**Gate Result**: ALL PASS. No violations. Proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/003-reconcile-vm-hosts/
├── plan.md              # This file
├── research.md          # Phase 0: PowerShell cmdlet research
├── data-model.md        # Phase 1: State schema extension
├── quickstart.md        # Phase 1: Developer quickstart
├── contracts/           # Phase 1: PowerShell script contracts
└── tasks.md             # Phase 2: Task breakdown (via /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── cli/
│   ├── index.ts                    # MODIFY: Register reconcile command
│   ├── output.ts                   # NO CHANGE (existing patterns sufficient)
│   └── commands/
│       ├── reconcile.ts            # NEW: reconcile command handler
│       ├── up.ts                   # MODIFY: Insert reconcile step after actions
│       └── status.ts               # MODIFY: Display network fields
├── config/
│   └── (no changes)
├── state/
│   ├── types.ts                    # MODIFY: Add NetworkState interface to VMState
│   └── manager.ts                  # MODIFY: Add updateVMNetwork(), migration logic
├── hyperv/
│   ├── commands.ts                 # MODIFY: Add buildGetVMNetworkAdaptersScript()
│   ├── queries.ts                  # MODIFY: Add getVMNetworkAdapters() query
│   ├── types.ts                    # MODIFY: Add HyperVNetworkAdapter interface
│   └── executor.ts                 # NO CHANGE
├── core/
│   ├── reconcile/                  # NEW: Reconcile module directory
│   │   ├── discovery.ts            # NEW: IP discovery with retry/timeout
│   │   ├── diff.ts                 # NEW: Detect IP changes, set previousIpv4
│   │   ├── hosts.ts                # NEW: Render hosts block, push to guest
│   │   └── orchestrator.ts         # NEW: Orchestrate discovery → diff → hosts sync
│   ├── errors.ts                   # MODIFY: Add ReconcileError class
│   └── reconciler.ts               # NO CHANGE (existing action reconciler unrelated)
└── lib/
    └── (no changes)

tests/
├── unit/
│   ├── reconcile-discovery.test.ts # NEW
│   ├── reconcile-diff.test.ts      # NEW
│   ├── reconcile-hosts.test.ts     # NEW
│   └── state-migration.test.ts     # NEW
└── fixtures/
    └── mock-responses/
        ├── network-adapters.json   # NEW: Mock Get-VMNetworkAdapter responses
        └── invoke-command.json     # NEW: Mock Invoke-Command responses
```

**Structure Decision**: Reconcile logic lives in a new `src/core/reconcile/` module directory with four files (discovery, diff, hosts, orchestrator) to enforce clear module boundaries. This follows the user's requirement for explicit module separation and avoids polluting the existing `src/core/reconciler.ts` (which handles VM action execution, a different concern).

## Module Boundaries

### Module 1: Discovery (`src/core/reconcile/discovery.ts`)

**Responsibility**: Query Hyper-V for VM network adapter data. Retry with polling for DHCP delay.

**Exports**:
- `discoverNetworkState(executor, vmName, options?) → Promise<DiscoveryResult>`
- `discoverAllNetworkState(executor, vms, options?) → Promise<DiscoveryResult[]>`

**Dependencies**: `src/hyperv/executor.ts`, `src/hyperv/queries.ts`

**Algorithm**:
1. Call `getVMNetworkAdapters(executor, vmName)` — new query wrapping `Get-VMNetworkAdapter`
2. Filter adapters to the one connected to "Default Switch"
3. Extract first IPv4 from `IPAddresses` array (filter by IPv4 regex `^\d+\.\d+\.\d+\.\d+$`)
4. Extract all IPv6 addresses (remaining IPs that are not IPv4)
5. If no IPv4 found and VM is Running, poll every 3 seconds up to timeout (default 60s)
6. Return `DiscoveryResult` with all network fields

**Fail-fast**: If ANY running VM has no IPv4 after timeout, the caller (orchestrator) aborts.

### Module 2: Diff (`src/core/reconcile/diff.ts`)

**Responsibility**: Compare discovered network state against existing state. Detect changes and set `previousIpv4`.

**Exports**:
- `diffNetworkState(existing, discovered) → NetworkStateDiff`

**Algorithm**:
1. For each VM, compare `existing.network?.ipv4` vs `discovered.ipv4`
2. If changed: set `previousIpv4 = existing.network.ipv4`
3. If same: preserve existing `previousIpv4` (don't overwrite)
4. Build final `NetworkState` object with all 7 fields
5. Flag VMs with changed IPs for logging

### Module 3: Hosts Rendering + Guest Apply (`src/core/reconcile/hosts.ts`)

**Responsibility**: Render `/etc/hosts` managed block content and push it into each running VM.

**Exports**:
- `renderHostsBlock(vms) → string` — generates the `# BEGIN RAGNATRAMP` ... `# END RAGNATRAMP` block
- `syncHostsToVM(executor, vmName, hostsBlock) → Promise<HostsSyncResult>`
- `syncHostsToAllVMs(executor, vms, hostsBlock) → Promise<HostsSyncResult[]>`

**Hosts block format**:
```
# BEGIN RAGNATRAMP
# Managed by ragnatramp - do not edit this block
172.16.0.10 web
172.16.0.11 db
# END RAGNATRAMP
```

**Guest write mechanism**: `Invoke-Command -VMName '<name>' -ScriptBlock { ... }` where the script block:
1. Reads current `/etc/hosts`
2. Removes any existing `# BEGIN RAGNATRAMP` ... `# END RAGNATRAMP` block (regex)
3. Appends the new managed block
4. Writes back to `/etc/hosts`

**Per-VM non-fatal**: Each VM's sync is wrapped in try/catch. Failures are collected and reported.

### Module 4: Orchestrator (`src/core/reconcile/orchestrator.ts`)

**Responsibility**: Coordinate the full reconcile workflow: discover → diff → update state → sync hosts.

**Exports**:
- `runReconcile(executor, stateManager, config, options?) → Promise<ReconcileResult>`

**Workflow**:
1. Load state, get list of managed VMs
2. Query actual VMs from Hyper-V to determine running state
3. Call `discoverAllNetworkState()` for all running VMs
4. **Fail-fast gate**: If any running VM lacks IPv4, abort with `ReconcileError`
5. Call `diffNetworkState()` for each VM to compute updates
6. Update state with new network data; `save()` atomically
7. Null out network for non-running VMs
8. Render hosts block from running VMs with IPv4
9. Call `syncHostsToAllVMs()` — per-VM non-fatal
10. Return `ReconcileResult` with per-VM outcomes

### Module 5: State Extension (`src/state/types.ts` + `src/state/manager.ts`)

**State schema change**: Add `network` field to `VMState`:

```typescript
interface NetworkState {
  ipv4: string | null;
  ipv6?: string[];
  mac: string | null;
  adapterName?: string | null;
  discoveredAt: string | null;
  source: 'hyperv' | 'guest-file' | 'guest-cmd';
  previousIpv4?: string | null;
}

interface VMState {
  // ... existing fields ...
  network?: NetworkState;  // Optional for backward compat
}
```

**Migration strategy**: The `network` field is optional (`?`). Old state files without it simply have `undefined` for `network`, which the code treats as "never reconciled." No version bump needed — the field is additive and fully backward-compatible. The `StateManager.load()` method already parses the JSON without schema validation, so old files load without error.

### Module 6: PowerShell Scripts (`src/hyperv/commands.ts` + `src/hyperv/queries.ts`)

**New script builder**: `buildGetVMNetworkAdaptersScript(vmName)` — returns JSON array of adapter objects:
```powershell
$adapters = Get-VMNetworkAdapter -VMName '<name>' -ErrorAction SilentlyContinue |
  Select-Object Name, MacAddress, SwitchName, IPAddresses
if ($adapters -eq $null) { '[]' }
elseif ($adapters -is [array]) { $adapters | ConvertTo-Json -Depth 3 }
else { ConvertTo-Json @($adapters) -Depth 3 }
```

**New script builder**: `buildSyncHostsScript(vmName, hostsBlock)` — invokes PowerShell Direct:
```powershell
$ErrorActionPreference = 'Stop'
Invoke-Command -VMName '<name>' -ScriptBlock {
  param($block)
  $hosts = Get-Content /etc/hosts -Raw
  $pattern = '(?s)# BEGIN RAGNATRAMP.*?# END RAGNATRAMP\n?'
  $hosts = [regex]::Replace($hosts, $pattern, '')
  $hosts = $hosts.TrimEnd() + "`n`n" + $block + "`n"
  Set-Content -Path /etc/hosts -Value $hosts -NoNewline
} -ArgumentList '<hostsBlock>'
```

**New query**: `getVMNetworkAdapters(executor, vmName) → Promise<HyperVNetworkAdapter[]>`

**New type**:
```typescript
interface HyperVNetworkAdapter {
  Name: string;
  MacAddress: string;
  SwitchName: string | null;
  IPAddresses: string[];
}
```

## Orchestration Integration

### `up` Command Workflow (Modified)

The `up` command in `src/cli/commands/up.ts` currently follows this flow:

```
1. Load & validate config
2. Preflight checks
3. Load/create state
4. Query VMs
5. Compute plan
6. Execute actions (create/start VMs)
7. Report results
```

**Modified flow** — reconcile inserted as step 6.5:

```
1. Load & validate config
2. Preflight checks
3. Load/create state
4. Query VMs
5. Compute plan
6. Execute actions (create/start VMs)
6.5 Run reconcile (discover IPs → diff → update state → sync hosts)   ← NEW
7. Report results (includes reconcile summary)
```

**Key**: Reconcile runs AFTER actions complete (VMs exist and are started) but BEFORE final reporting. Reconcile failures are caught and reported as warnings — they do NOT cause `up` to exit non-zero.

### `reconcile` Standalone Command

```
1. Load & validate config
2. Create executor (with verbose)
3. Load state (fail if no state)
4. Run reconcile orchestrator
5. Report per-VM results (human or JSON)
6. Exit 0 on success, 1 on fail-fast (IP missing), 2 on system error
```

### `status` Command (Modified)

Add network fields to the status display. For each VM in state:
- Show `ipv4` (or `ipv6` if no IPv4)
- Show `adapterName`
- Show `source`

In `--json` mode, include the full `network` object in the output.

## Verbose / Logging Integration

All PowerShell commands run through `HyperVExecutor.execute()`, which already respects `--verbose`:
- `Get-VMNetworkAdapter` scripts are logged to stderr when verbose
- `Invoke-Command -VMName` scripts are logged to stderr when verbose
- No behavioral changes from `--verbose` (Constitution IX compliance)

Progress reporting uses the existing `OutputFormatter` patterns:
- `output.info()` for discovery progress ("Discovering IPs...")
- `output.success()` for per-VM success ("web: 172.16.0.10")
- `output.warning()` for per-VM warnings ("db: powered off, skipped")
- `output.error()` for failures

## Complexity Tracking

No constitution violations. No complexity justifications needed.

## Phase 0 Outputs

See [research.md](./research.md) for PowerShell cmdlet research.

## Phase 1 Outputs

- [data-model.md](./data-model.md) — State schema extension
- [quickstart.md](./quickstart.md) — Developer quickstart
- [contracts/](./contracts/) — PowerShell script contracts

## Post-Design Constitution Re-Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. User-Space Only | PASS | `Get-VMNetworkAdapter` and `Invoke-Command -VMName` are user-space Hyper-V cmdlets. |
| II. Safety First | PASS | Only modifies state for VMs in state file. Hosts block uses markers to isolate changes. |
| III. Idempotent | PASS | Repeat reconcile produces same state. Hosts block replaced, not appended. |
| IV. Deterministic Naming | PASS | Hostnames from config `name` field. No new naming scheme. |
| V. Declarative YAML Only | PASS | No scripting in config. State extension is plain data. |
| VI. Audit-Friendly | PASS | `--json` and `--verbose` supported. Per-VM results. |
| VII. Predictable Failures | PASS | Fail-fast on missing IPv4. Actionable error messages. Clear exit codes. |
| VIII. Explicit State | PASS | Network data in `.ragnatramp/state.json`. Atomic writes. |
| IX. Explicit CLI | PASS | `--verbose` is cosmetic. No hidden behavior. |

**Post-Design Gate**: ALL PASS.
