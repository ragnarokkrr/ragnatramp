# Data Model: Reconcile VM IPs + Sync /etc/hosts

**Branch**: `003-reconcile-vm-hosts` | **Date**: 2026-01-30

## State Schema Extension

### Existing VMState (unchanged fields)

```typescript
interface VMState {
  id: string;                    // Hyper-V VM GUID
  name: string;                  // Full VM name: {project}-{machine}-{hash8}
  machineName: string;           // Machine name from config (key reference)
  diskPath: string;              // Absolute path to VHDX
  createdAt: string;             // ISO timestamp
  checkpoints: CheckpointState[];
  network?: NetworkState;        // NEW — optional for backward compatibility
}
```

### New NetworkState Interface

```typescript
interface NetworkState {
  /** Discovered IPv4 address, null if VM is off or no IPv4 assigned */
  ipv4: string | null;

  /** All IPv6 addresses reported by the adapter (optional, may be empty) */
  ipv6?: string[];

  /** MAC address of the adapter on the Default Switch, null if off */
  mac: string | null;

  /** Hyper-V network adapter display name (optional) */
  adapterName?: string | null;

  /** ISO timestamp of when this network state was last discovered */
  discoveredAt: string | null;

  /** Discovery mechanism used */
  source: 'hyperv' | 'guest-file' | 'guest-cmd';

  /** Previous IPv4 address, set when ipv4 changes (optional) */
  previousIpv4?: string | null;
}
```

### Field Details

| Field | Type | Nullable | Optional | Source |
|-------|------|----------|----------|--------|
| `ipv4` | `string` | Yes (null) | No | `Get-VMNetworkAdapter` → `IPAddresses` → first IPv4 match |
| `ipv6` | `string[]` | — | Yes | `Get-VMNetworkAdapter` → `IPAddresses` → all non-IPv4 |
| `mac` | `string` | Yes (null) | No | `Get-VMNetworkAdapter` → `MacAddress` |
| `adapterName` | `string` | Yes (null) | Yes | `Get-VMNetworkAdapter` → `Name` |
| `discoveredAt` | `string` | Yes (null) | No | Set to `new Date().toISOString()` at discovery time |
| `source` | enum | — | No | Always `"hyperv"` in this feature (extensible) |
| `previousIpv4` | `string` | Yes (null) | Yes | Set to prior `ipv4` when value changes |

### State Lifecycle

```
VM Created (up command)
  → VMState created with network: undefined

First Reconcile
  → network populated with all fields
  → source = "hyperv"
  → previousIpv4 = undefined (first discovery)

Subsequent Reconcile (IP unchanged)
  → network updated: discoveredAt refreshed
  → previousIpv4 unchanged

Subsequent Reconcile (IP changed)
  → network.previousIpv4 = prior ipv4
  → network.ipv4 = new address
  → discoveredAt refreshed

VM Powered Off
  → network fields set to null (ipv4, mac, discoveredAt)
  → previousIpv4 preserved (last known)

VM Destroyed
  → VMState removed entirely (existing behavior)
```

### Example State File (after reconcile)

```json
{
  "version": 1,
  "configHash": "a1b2c3d4",
  "configPath": "C:\\project\\ragnatramp.yaml",
  "project": "myproject",
  "createdAt": "2026-01-30T10:00:00.000Z",
  "updatedAt": "2026-01-30T10:05:00.000Z",
  "vms": {
    "web": {
      "id": "abc12345-...",
      "name": "myproject-web-a1b2c3d4",
      "machineName": "web",
      "diskPath": "C:\\...\\web.vhdx",
      "createdAt": "2026-01-30T10:00:00.000Z",
      "checkpoints": [],
      "network": {
        "ipv4": "172.16.0.10",
        "ipv6": ["fe80::1234:5678:abcd:ef01"],
        "mac": "00:15:5D:01:02:03",
        "adapterName": "Network Adapter",
        "discoveredAt": "2026-01-30T10:05:00.000Z",
        "source": "hyperv"
      }
    },
    "db": {
      "id": "def67890-...",
      "name": "myproject-db-a1b2c3d4",
      "machineName": "db",
      "diskPath": "C:\\...\\db.vhdx",
      "createdAt": "2026-01-30T10:00:05.000Z",
      "checkpoints": [],
      "network": {
        "ipv4": "172.16.0.11",
        "mac": "00:15:5D:01:02:04",
        "discoveredAt": "2026-01-30T10:05:00.000Z",
        "source": "hyperv"
      }
    }
  }
}
```

### Migration Compatibility

Old state files (pre-reconcile) have no `network` field on VMState entries. The new code:

1. **Reading**: `vm.network?.ipv4` returns `undefined` — treated as "never reconciled"
2. **Writing**: First reconcile populates the `network` object
3. **No version bump**: `version: 1` remains valid — the change is additive

No migration code needed. No backward-breaking changes.

## Hyper-V Types Extension

### New: HyperVNetworkAdapter

```typescript
interface HyperVNetworkAdapter {
  /** Adapter display name (e.g., "Network Adapter") */
  Name: string;
  /** MAC address without delimiters (e.g., "001122334455") */
  MacAddress: string;
  /** Connected virtual switch name (null if disconnected) */
  SwitchName: string | null;
  /** IP addresses reported by guest integration services (mixed IPv4/IPv6) */
  IPAddresses: string[];
}
```

## Reconcile Result Types

### DiscoveryResult

```typescript
interface DiscoveryResult {
  machineName: string;
  vmName: string;
  state: 'discovered' | 'no-ip' | 'off' | 'missing';
  network: NetworkState | null;
}
```

### NetworkStateDiff

```typescript
interface NetworkStateDiff {
  machineName: string;
  changed: boolean;
  previousIpv4: string | null;
  network: NetworkState;
}
```

### HostsSyncResult

```typescript
interface HostsSyncResult {
  machineName: string;
  vmName: string;
  status: 'synced' | 'skipped' | 'failed';
  error?: string;
}
```

### ReconcileResult

```typescript
interface ReconcileResult {
  success: boolean;
  dryRun: boolean;
  discovery: DiscoveryResult[];
  diffs: NetworkStateDiff[];
  hostsBlock: string;              // Rendered managed block (always computed)
  hostSync: HostsSyncResult[];     // Empty when dryRun is true
  summary: {
    discovered: number;
    changed: number;
    synced: number;                // 0 when dryRun is true
    skipped: number;
    failed: number;                // 0 when dryRun is true
  };
}
```

## Error Types

### ReconcileError

```typescript
class ReconcileError extends RagnatrampError {
  constructor(
    message: string,
    code: 'RECONCILE_IP_FAILED' | 'RECONCILE_HOSTS_FAILED' | 'RECONCILE_NO_VMS',
    suggestion?: string
  )
}
```

Exit code mapping:
- `RECONCILE_IP_FAILED` → exit 1 (user-actionable: VM has no IP)
- `RECONCILE_HOSTS_FAILED` → exit 2 (system error: guest write failed)
- `RECONCILE_NO_VMS` → exit 0 (informational: no VMs to reconcile)
