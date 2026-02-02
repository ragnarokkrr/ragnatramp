# Data Model: Reconcile VM IPs + Sync /etc/hosts

**Branch**: `003-reconcile-vm-hosts` | **Date**: 2026-02-02

## Entity Changes

### 1. NetworkState (NEW — added to VMState)

Added as an optional field on the existing `VMState` interface. No migration needed — old state files without `network` parse correctly as `undefined`.

```typescript
/** Network discovery state for a managed VM */
export interface NetworkState {
  /** Discovered IPv4 address, null if VM is off or no IP found */
  ipv4: string | null;
  /** IPv6 addresses reported by adapter (optional, informational) */
  ipv6?: string[];
  /** MAC address of adapter on Default Switch, null if no adapter */
  mac: string | null;
  /** Hyper-V network adapter display name (optional) */
  adapterName?: string | null;
  /** ISO timestamp of when this discovery was performed */
  discoveredAt: string | null;
  /** How the IP was discovered */
  source: 'hyperv' | 'arp' | 'guest-file' | 'guest-cmd';
  /** Previous IPv4 value, stored when address changes (optional) */
  previousIpv4?: string | null;
}
```

**Relationships**: `NetworkState` is a child of `VMState` (1:1 optional). Keyed by machine name via the parent `vms` record.

**Validation Rules**:
- `ipv4`: Must match `^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$` when non-null.
- `mac`: 12 hex chars, no delimiters (e.g., `00155DDE3309`) when non-null.
- `discoveredAt`: ISO 8601 timestamp.
- `source`: Enum — `"hyperv"` when IP came from KVP `IPAddresses`, `"arp"` when from `Get-NetNeighbor`, others reserved for future use.
- `previousIpv4`: Set to prior `ipv4` value only when `ipv4` changes; otherwise left unchanged.

### 2. VMState (MODIFIED)

```typescript
export interface VMState {
  id: string;
  name: string;
  machineName: string;
  diskPath: string;
  createdAt: string;
  checkpoints: CheckpointState[];
  /** Network discovery state — added by reconcile */
  network?: NetworkState;  // NEW — optional, backward-compatible
}
```

**Backward Compatibility**: The `network` field is optional. Code reading it uses optional chaining (`vm.network?.ipv4`). No version bump to `StateFile.version`.

### 3. SSHConfig (NEW — added to config types)

Added to YAML configuration for SSH credential management.

```typescript
/** SSH configuration for guest execution */
export interface SSHConfig {
  /** SSH username */
  user: string;
  /** Path to SSH private key file */
  private_key: string;
}
```

**Relationships**: Can appear at project level (`defaults.ssh`) and per-machine (`machines[].ssh`). Machine-level overrides project default.

### 4. RagnatrampConfig (MODIFIED)

```typescript
export interface DefaultsConfig {
  cpu?: number;
  memory?: number;
  base_image?: string;
  disk_strategy?: 'differencing' | 'copy';
  ssh?: SSHConfig;  // NEW — project-level SSH defaults
}

export interface MachineConfig {
  name: string;
  cpu?: number;
  memory?: number;
  base_image?: string;
  ssh?: SSHConfig;  // NEW — per-machine SSH override
}
```

### 5. ResolvedMachine (MODIFIED)

```typescript
export interface ResolvedMachine {
  name: string;
  cpu: number;
  memory: number;
  baseImage: string;
  diskStrategy: 'differencing' | 'copy';
  ssh?: ResolvedSSHConfig;  // NEW — resolved SSH config (optional; required for hosts sync)
}

export interface ResolvedSSHConfig {
  user: string;
  privateKeyPath: string;  // Absolute, expanded path
}
```

## Transient Types (not persisted)

### DiscoveryResult

Returned by the tiered discovery function for each VM.

```typescript
export interface DiscoveryResult {
  machineName: string;
  vmName: string;
  /** VM Hyper-V state */
  vmState: 'Running' | 'Off' | 'Saved' | 'Paused' | string;
  /** Discovered network state, or null if VM is not running */
  network: NetworkState | null;
  /** Which tier succeeded: 'kvp', 'arp', or null if both failed */
  tier: 'kvp' | 'arp' | null;
  /** Diagnostic warnings generated during discovery */
  warnings: string[];
}
```

### DiagnosticResult

Result of a prerequisite check for a single VM.

```typescript
export interface DiagnosticResult {
  machineName: string;
  vmName: string;
  /** KVP integration service status */
  kvpStatus: 'OK' | 'No Contact' | 'Disabled' | 'Unknown';
  /** Whether SSH port 22 is reachable at the discovered IP */
  sshReachable: boolean | null;  // null if no IP discovered
  /** Human-readable warnings */
  warnings: string[];
}
```

### ReconcileResult

Aggregate result of the reconcile operation.

```typescript
export interface ReconcileResult {
  success: boolean;
  /** Per-VM discovery results */
  discoveries: DiscoveryResult[];
  /** Per-VM state diffs (old → new) */
  diffs: StateDiff[];
  /** Per-VM hosts sync results */
  hostsSyncResults: HostsSyncResult[];
  /** Rendered hosts block (same for all VMs) */
  hostsBlock: string;
  /** Aggregate warnings */
  warnings: string[];
}

export interface StateDiff {
  machineName: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

export interface HostsSyncResult {
  machineName: string;
  success: boolean;
  skipped: boolean;
  skipReason?: string;
  error?: string;
}
```

## JSON Schema Changes

### New `ssh` block in schema.json

```json
{
  "ssh": {
    "type": "object",
    "description": "SSH credentials for guest execution",
    "additionalProperties": false,
    "required": ["user", "private_key"],
    "properties": {
      "user": {
        "type": "string",
        "description": "SSH username",
        "minLength": 1,
        "maxLength": 32
      },
      "private_key": {
        "type": "string",
        "description": "Path to SSH private key file",
        "minLength": 1
      }
    }
  }
}
```

Added to both `defaults.properties` and `machines.items.properties`.

## State Transitions

```
VM Created (no network) → reconcile discovers IP → network.ipv4 set, source set
VM Running (has IP)      → reconcile re-runs     → network unchanged (idempotent) or ipv4 updated + previousIpv4 set
VM Stopped               → reconcile runs        → network fields set to null
VM Destroyed             → VM removed from state  → network removed with VM
```

## Duplicate IP Detection

During reconcile, after all VMs are discovered:
- Build `Map<string, string[]>` of IPv4 → machineNames.
- If any IPv4 maps to more than one machine, flag as conflicting.
- Conflicting VMs: IP still persisted in state, but hosts sync skipped for those VMs with a warning.
