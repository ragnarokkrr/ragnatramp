# Quickstart: Reconcile VM IPs + Sync /etc/hosts

**Branch**: `003-reconcile-vm-hosts` | **Date**: 2026-01-30

## What This Feature Does

Adds a `ragnatramp reconcile` command that:
1. Discovers IPv4/IPv6 addresses for all managed VMs via Hyper-V
2. Persists network state (IP, MAC, adapter name, etc.) into the state file
3. Syncs `/etc/hosts` inside each running Linux VM so they can resolve each other by hostname

The reconcile step also runs automatically during `ragnatramp up`.

## Usage

### Standalone Reconcile

```bash
# Discover IPs and sync hosts
ragnatramp reconcile ragnatramp.yaml

# Preview what reconcile would do (no writes, no guest changes)
ragnatramp reconcile ragnatramp.yaml --dry-run

# With verbose PowerShell output
ragnatramp reconcile ragnatramp.yaml --verbose

# Machine-readable output
ragnatramp reconcile ragnatramp.yaml --json

# Dry-run with JSON output
ragnatramp reconcile ragnatramp.yaml --dry-run --json
```

### Automatic (via up)

```bash
# VMs are created, started, IPs discovered, and hosts synced automatically
ragnatramp up ragnatramp.yaml
```

### Check Network State (via status)

```bash
# Shows ipv4, adapterName, source per VM
ragnatramp status ragnatramp.yaml
```

## Files Changed

### New Files

| File | Purpose |
|------|---------|
| `src/cli/commands/reconcile.ts` | CLI command handler |
| `src/core/reconcile/discovery.ts` | IP discovery via Get-VMNetworkAdapter |
| `src/core/reconcile/diff.ts` | Detect IP changes, set previousIpv4 |
| `src/core/reconcile/hosts.ts` | Render hosts block, push to guest VMs |
| `src/core/reconcile/orchestrator.ts` | Coordinate discovery → diff → hosts sync |

### Modified Files

| File | Change |
|------|--------|
| `src/state/types.ts` | Add `NetworkState` interface, add `network?` to `VMState` |
| `src/state/manager.ts` | Add `updateVMNetwork()` method |
| `src/hyperv/types.ts` | Add `HyperVNetworkAdapter` interface |
| `src/hyperv/commands.ts` | Add `buildGetVMNetworkAdaptersScript()`, `buildSyncHostsScript()` |
| `src/hyperv/queries.ts` | Add `getVMNetworkAdapters()` query |
| `src/cli/index.ts` | Register `reconcile` command |
| `src/cli/commands/up.ts` | Insert reconcile step after VM actions |
| `src/cli/commands/status.ts` | Display network fields |
| `src/core/errors.ts` | Add `ReconcileError` class |

## Key Design Decisions

1. **Fail-fast IP discovery**: If ANY running VM has no IPv4 after 60s timeout, reconcile aborts. Hosts sync is skipped. This prevents incomplete hosts files.

2. **Per-VM non-fatal hosts sync**: If writing `/etc/hosts` fails on one VM, reconcile continues with others. Failures are reported as warnings.

3. **Managed block markers**: `# BEGIN RAGNATRAMP` / `# END RAGNATRAMP` delimit the managed section in `/etc/hosts`. User entries outside this block are never touched.

4. **PowerShell Direct**: Guest writes use `Invoke-Command -VMName` over VMBus. No SSH needed.

5. **Backward-compatible state**: The `network` field is optional. Old state files work without migration.

6. **Dry-run mode**: `--dry-run` performs discovery and diff without writing state or contacting guests. Shows discovered IPs, state changes, and the rendered hosts block.

## Prerequisites for Guest VMs

- Linux guest with Hyper-V Integration Services enabled
- PowerShell available in the guest (for `Invoke-Command -VMName` to work)
- Standard `/etc/hosts` file at the expected path
