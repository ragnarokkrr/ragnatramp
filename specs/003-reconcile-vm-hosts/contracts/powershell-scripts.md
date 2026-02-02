# Contracts: Reconcile VM IPs + Sync /etc/hosts

**Branch**: `003-reconcile-vm-hosts` | **Date**: 2026-02-02

## Contract 1: Get-VMNetworkAdapter Query

**Purpose**: Discover network adapter details for a VM, including MAC and KVP-reported IP addresses.

**PowerShell Script**:
```powershell
$adapter = Get-VMNetworkAdapter -VMName '<name>' |
  Where-Object { $_.SwitchName -eq 'Default Switch' } |
  Select-Object Name, MacAddress, SwitchName,
    @{N='Status';E={$_.Status.ToString()}},
    @{N='IPAddresses';E={@($_.IPAddresses)}}
if ($adapter) { $adapter | ConvertTo-Json -Depth 3 } else { 'null' }
```

**Return Type** (JSON → TypeScript):
```typescript
interface VMNetworkAdapterResult {
  Name: string;           // e.g., "Network Adapter"
  MacAddress: string;     // e.g., "00155DDE3309" (no delimiters)
  SwitchName: string;     // e.g., "Default Switch"
  Status: string;         // e.g., "Ok"
  IPAddresses: string[];  // e.g., ["172.18.185.163", "fe80::215:5dff:fede:3309"]
} | null
```

**Edge Cases**:
- VM has no adapter on Default Switch → returns `null`
- VM has multiple adapters → filter returns first Default Switch adapter
- `IPAddresses` empty → KVP daemon not running, fall back to ARP (Contract 2)
- VM is off → adapter exists but `IPAddresses` empty and `Status` may differ

---

## Contract 2: Get-NetNeighbor ARP Query (fallback)

**Purpose**: Resolve VM IPv4 from the host ARP table by cross-referencing the adapter MAC address.

**PowerShell Script**:
```powershell
$neighbor = Get-NetNeighbor -InterfaceAlias 'vEthernet (Default Switch)' -ErrorAction SilentlyContinue |
  Where-Object { $_.LinkLayerAddress -eq '<formatted-mac>' -and $_.AddressFamily -eq 'IPv4' } |
  Select-Object IPAddress, LinkLayerAddress, State
if ($neighbor) { $neighbor | ConvertTo-Json } else { 'null' }
```

**MAC Format**: Input MAC `00155DDE3309` must be formatted as `00-15-5D-DE-33-09` (dash-separated pairs) before matching against `LinkLayerAddress`.

**Return Type**:
```typescript
interface ARPNeighborResult {
  IPAddress: string;        // e.g., "172.18.185.163"
  LinkLayerAddress: string; // e.g., "00-15-5D-DE-33-09"
  State: string;            // e.g., "Permanent"
} | null
```

**Edge Cases**:
- No ARP entry for MAC → returns `null` (VM hasn't communicated on network yet)
- Stale entry from deleted VM → irrelevant (we only query MACs of known VMs)
- Multiple entries for same MAC → take IPv4 one (filtered by `AddressFamily`)

---

## Contract 3: Get-VMIntegrationService KVP Check

**Purpose**: Diagnostic check — determine if KVP Data Exchange is functional for a VM.

**PowerShell Script**:
```powershell
$svc = Get-VMIntegrationService -VMName '<name>' -Name 'Key-Value Pair Exchange' -ErrorAction SilentlyContinue |
  Select-Object Enabled, PrimaryStatusDescription
if ($svc) { $svc | ConvertTo-Json } else { 'null' }
```

**Return Type**:
```typescript
interface KVPServiceResult {
  Enabled: boolean;                    // e.g., true
  PrimaryStatusDescription: string;    // e.g., "OK" or "No Contact"
} | null
```

**Interpretation**:
| Enabled | Status | Meaning |
|---------|--------|---------|
| `true` | `"OK"` | KVP working — `IPAddresses` should be populated |
| `true` | `"No Contact"` | Host enabled but guest daemon not running — use ARP fallback |
| `false` | any | KVP disabled at host level — use ARP fallback |
| `null` | — | VM not found or integration service query failed |

---

## Contract 4: SSH Hosts Sync

**Purpose**: Read `/etc/hosts` inside guest, replace the managed block, write it back via `sudo`.

**SSH Command** (spawned via `child_process.execFile`):
```
ssh -i <private_key> -o StrictHostKeyChecking=no -o ConnectTimeout=10 <user>@<ip> <script>
```

**Remote Script** (passed as single command string):
```bash
sudo sh -c '
  HOSTS=$(cat /etc/hosts)
  CLEAN=$(echo "$HOSTS" | sed "/^# BEGIN RAGNATRAMP$/,/^# END RAGNATRAMP$/d")
  printf "%s\n%s\n" "$CLEAN" "<managed_block>" > /etc/hosts
'
```

Where `<managed_block>` is:
```
# BEGIN RAGNATRAMP
# Managed by ragnatramp - do not edit this block
172.18.185.163 web
172.18.186.136 db
# END RAGNATRAMP
```

**Return**: Exit code 0 on success; non-zero on failure. Stderr captured for error reporting.

**Edge Cases**:
- No existing managed block → block is appended at end
- Existing managed block → replaced in-place (sed removes old, printf appends new)
- Permission denied → caught per-VM, reported as warning, other VMs continue
- SSH timeout → 10s `ConnectTimeout`, treated as unreachable
- Host key changed → `-o StrictHostKeyChecking=no` bypasses (acceptable for local Hyper-V VMs on Default Switch)

---

## Contract 5: SSH Port Reachability Check

**Purpose**: Dry-run and pre-sync diagnostic — verify SSH port 22 is open without authenticating.

**PowerShell Script**:
```powershell
$result = Test-NetConnection -ComputerName '<ip>' -Port 22 -WarningAction SilentlyContinue -InformationLevel Quiet
@{ reachable = $result } | ConvertTo-Json
```

**Return Type**:
```typescript
interface SSHReachabilityResult {
  reachable: boolean;
}
```

---

## Contract 6: Reconcile CLI Interface

### Command Signature

```
ragnatramp reconcile <file> [--dry-run] [--verbose] [--json]
```

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success — all running VMs discovered and hosts synced |
| `1` | Fail-fast — a running VM had no IPv4 after timeout (FR-009a) |
| `2` | System error — Hyper-V unavailable, config invalid, or unrecoverable |

### JSON Output Schema

```typescript
interface ReconcileJsonOutput {
  success: boolean;
  command: 'reconcile';
  data: {
    dryRun?: boolean;
    diagnostics?: DiagnosticResult[];
    discoveries: Array<{
      machineName: string;
      vmName: string;
      vmState: string;
      ipv4: string | null;
      source: string;
      mac: string | null;
      tier: 'kvp' | 'arp' | null;
      warnings: string[];
    }>;
    diffs: Array<{
      machineName: string;
      field: string;
      oldValue: string | null;
      newValue: string | null;
    }>;
    hostsSync?: Array<{
      machineName: string;
      success: boolean;
      skipped: boolean;
      skipReason?: string;
      error?: string;
    }>;
    hostsBlock: string;
    warnings: string[];
  };
}
```

### Integration with `up` command

After actions execute in `up.ts`, reconcile runs automatically. Reconcile failure is treated as a non-fatal warning per FR-011.
