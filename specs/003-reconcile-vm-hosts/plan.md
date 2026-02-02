# Implementation Plan: Reconcile VM IPs + Sync /etc/hosts

**Branch**: `003-reconcile-vm-hosts` | **Date**: 2026-02-02 | **Spec**: `specs/003-reconcile-vm-hosts/spec.md`
**Input**: Feature specification from `/specs/003-reconcile-vm-hosts/spec.md`

## Summary

Add a `ragnatramp reconcile <file>` command that discovers VM IPv4 addresses using a tiered host-only strategy (KVP → ARP fallback), persists network state, and syncs `/etc/hosts` inside Linux guests via SSH. Integrates automatically into the `up` workflow. Supports `--dry-run`, `--verbose`, and `--json` flags.

## Technical Context

**Language/Version**: TypeScript 5.4, Node.js 20+ (ES modules)
**Primary Dependencies**: commander (CLI), js-yaml (YAML), ajv (schema validation), child_process (PowerShell + SSH spawning)
**Storage**: `.ragnatramp/state.json` (additive `network` field on existing `VMState`)
**Testing**: Node.js built-in `node:test` module with `tsx` loader
**Target Platform**: Windows 11 Pro with Hyper-V, user-space only
**Project Type**: Single CLI project
**Performance Goals**: IP discovery completes within 60s timeout per VM; hosts sync per VM within 10s SSH round-trip
**Constraints**: No npm dependencies added (SSH via system `ssh` binary, PowerShell via system `powershell.exe`); no admin elevation; no guest-side dependencies beyond `sshd`
**Scale/Scope**: 2–3 VMs per project (MVP constraint)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. User-Space Only | **PASS** | All operations use `Get-VMNetworkAdapter`, `Get-NetNeighbor`, `Get-VMIntegrationService` (Hyper-V Administrators), and system `ssh` binary. No elevation. |
| II. Safety First | **PASS** | Only modifies state for VMs tracked in state file. Only writes managed block in `/etc/hosts` (delimited markers). Ownership verified before any action. |
| III. Idempotent Operations | **PASS** | `reconcile` converges to current state; repeated runs produce identical results. Managed hosts block replaced atomically. |
| IV. Deterministic Naming & Tagging | **PASS** | No new naming. Uses existing VM names from state. Machine `name` from config used as hostname in hosts entries. |
| V. Declarative YAML Only | **PASS** | New `ssh.user` and `ssh.private_key` fields are static declarations. No scripting. Schema-validated. |
| VI. Audit-Friendly Output | **PASS** | `--verbose` shows PowerShell scripts and SSH commands. `--json` for machine output. Diagnostics emit actionable warnings. |
| VII. Predictable Failures | **PASS** | Two-tier failure policy (fail-fast IP, per-VM non-fatal hosts sync). KVP diagnostic warns with fix instructions. SSH reachability pre-checked. |
| VIII. Explicit State Management | **PASS** | Network state stored in `.ragnatramp/state.json` under existing `vms` records. No new files. Additive, backward-compatible. |
| IX. Explicit CLI Behavior | **PASS** | `--dry-run` does exactly one thing: read-only preview. `--verbose` doesn't change execution paths. Diagnostics are informational only. |

**Gate result**: All principles pass. No violations to justify.

## Project Structure

### Documentation (this feature)

```text
specs/003-reconcile-vm-hosts/
├── plan.md              # This file
├── research.md          # Phase 0 output (complete — R1–R8)
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── reconcile-cli.md # CLI contract (not REST — this is a CLI tool)
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── cli/
│   ├── commands/
│   │   ├── reconcile.ts          # NEW — reconcile command handler
│   │   ├── up.ts                 # MODIFY — integrate reconcile after actions
│   │   └── status.ts             # MODIFY — display network fields
│   └── output.ts                 # MODIFY — add reconcile output formatting
│
├── config/
│   ├── types.ts                  # MODIFY — add SSHConfig to machine/defaults types
│   ├── schema.json               # MODIFY — add ssh block to JSON Schema
│   └── resolver.ts               # MODIFY — resolve ssh defaults + path expansion
│
├── core/
│   └── errors.ts                 # MODIFY — add ReconcileError, SSHError
│
├── hyperv/
│   └── commands.ts               # MODIFY — add network adapter + integration service scripts
│
├── network/                      # NEW — network discovery module
│   ├── discovery.ts              # Tiered IP discovery (KVP → ARP)
│   ├── commands.ts               # PowerShell script builders for network queries
│   ├── diagnostics.ts            # KVP status check, SSH reachability check
│   └── types.ts                  # NetworkState, DiscoveryResult, DiagnosticResult
│
├── hosts/                        # NEW — /etc/hosts sync module
│   ├── renderer.ts               # Build managed hosts block from VM IPs
│   ├── sync.ts                   # SSH-based /etc/hosts read-modify-write
│   └── ssh.ts                    # SSH command spawning wrapper
│
├── state/
│   └── types.ts                  # MODIFY — add NetworkState to VMState
│
└── lib/
    └── logger.ts                 # MODIFY — add reconcile-specific log helpers (if needed)

tests/
├── unit/
│   ├── network/
│   │   ├── discovery.test.ts     # KVP parsing, ARP parsing, tiered fallback
│   │   ├── commands.test.ts      # PowerShell script output verification
│   │   └── diagnostics.test.ts   # KVP status parsing, SSH port check
│   ├── hosts/
│   │   ├── renderer.test.ts      # Hosts block generation, idempotency
│   │   └── ssh.test.ts           # SSH command construction, escaping
│   ├── config/
│   │   └── ssh-config.test.ts    # SSH config validation, defaults merging
│   └── state/
│       └── network-state.test.ts # NetworkState serialization, backward compat
├── integration/
│   ├── reconcile.test.ts         # End-to-end reconcile with mocked PowerShell + SSH
│   └── reconcile-dryrun.test.ts  # Dry-run output verification
└── fixtures/
    └── mock-responses/
        ├── network-adapter.json  # Mock Get-VMNetworkAdapter responses
        ├── arp-neighbor.json     # Mock Get-NetNeighbor responses
        └── integration-service.json  # Mock Get-VMIntegrationService responses
```

**Structure Decision**: Follows existing single-project layout. New `src/network/` and `src/hosts/` modules parallel the existing `src/hyperv/` and `src/state/` separation. Network discovery is isolated from hosts sync because they have different dependencies (PowerShell-only vs SSH).

## Complexity Tracking

No violations to justify. The design adds two new modules (`network/`, `hosts/`) which is the minimum separation needed: network discovery (host-only, PowerShell) and hosts sync (guest execution, SSH) are independent concerns with different failure modes.
