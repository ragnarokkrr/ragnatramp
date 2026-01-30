# PowerShell Script Contracts: Reconcile VM IPs + Sync /etc/hosts

**Branch**: `003-reconcile-vm-hosts` | **Date**: 2026-01-30

## Contract 1: Get-VMNetworkAdapter Query

**Builder Function**: `buildGetVMNetworkAdaptersScript(vmName: string): string`

**Input**: VM name (escaped with `escapePowerShellString()`)

**PowerShell Script**:
```powershell
$adapters = Get-VMNetworkAdapter -VMName '<vmName>' -ErrorAction SilentlyContinue |
  Select-Object Name, MacAddress, SwitchName, IPAddresses
if ($adapters -eq $null) { '[]' }
elseif ($adapters -is [array]) { $adapters | ConvertTo-Json -Depth 3 }
else { ConvertTo-Json @($adapters) -Depth 3 }
```

**Returns**: `HyperVNetworkAdapter[]`

```typescript
interface HyperVNetworkAdapter {
  Name: string;           // e.g., "Network Adapter"
  MacAddress: string;     // e.g., "001122334455" (no delimiters)
  SwitchName: string | null; // e.g., "Default Switch" or null
  IPAddresses: string[];  // e.g., ["172.16.0.10", "fe80::1234:..."]
}
```

**Example Response** (2 adapters, one on Default Switch):
```json
[
  {
    "Name": "Network Adapter",
    "MacAddress": "00155D010203",
    "SwitchName": "Default Switch",
    "IPAddresses": ["172.16.0.10", "fe80::1234:5678:abcd:ef01"]
  },
  {
    "Name": "Network Adapter 2",
    "MacAddress": "00155D040506",
    "SwitchName": null,
    "IPAddresses": []
  }
]
```

**Example Response** (no adapters / VM off):
```json
[]
```

**Error Handling**: `-ErrorAction SilentlyContinue` returns empty array for missing/off VMs.

---

## Contract 2: Sync Hosts via PowerShell Direct

**Builder Function**: `buildSyncHostsScript(vmName: string, hostsBlock: string): string`

**Input**:
- `vmName`: VM name (escaped)
- `hostsBlock`: Complete managed block including markers

**PowerShell Script**:
```powershell
$ErrorActionPreference = 'Stop'
$block = @'
# BEGIN RAGNATRAMP
# Managed by ragnatramp - do not edit this block
172.16.0.10 web
172.16.0.11 db
# END RAGNATRAMP
'@
Invoke-Command -VMName '<vmName>' -ScriptBlock {
  param($managedBlock)
  $hostsPath = '/etc/hosts'
  $content = Get-Content $hostsPath -Raw -ErrorAction Stop
  $pattern = '(?s)\n?# BEGIN RAGNATRAMP.*?# END RAGNATRAMP\n?'
  $content = [regex]::Replace($content, $pattern, '')
  $content = $content.TrimEnd() + "`n`n" + $managedBlock + "`n"
  Set-Content -Path $hostsPath -Value $content -NoNewline -ErrorAction Stop
} -ArgumentList $block
ConvertTo-Json @{ success = $true }
```

**Returns**: `{ success: boolean }`

**Hosts Block Format**:
```
# BEGIN RAGNATRAMP
# Managed by ragnatramp - do not edit this block
172.16.0.10 web
172.16.0.11 db
# END RAGNATRAMP
```

**Error Cases**:
- VM not running → PowerShell error (caught by executor)
- Guest PowerShell not available → PowerShell error (caught by executor)
- Permission denied on `/etc/hosts` → PowerShell error from `Set-Content`
- `/etc/hosts` doesn't exist → PowerShell error from `Get-Content`

All errors are caught by `HyperVExecutor.execute()` and converted to `HyperVError`.

---

## Contract 3: Hosts Block Rendering (TypeScript, no PowerShell)

**Function**: `renderHostsBlock(vms: Array<{ hostname: string; ipv4: string }>): string`

**Input**: Array of hostname/IPv4 pairs for running VMs with valid IPs.

**Output**: Complete managed block string.

**Rules**:
1. Entries sorted alphabetically by hostname
2. One entry per line: `<ipv4> <hostname>`
3. Wrapped in `# BEGIN RAGNATRAMP` / `# END RAGNATRAMP` markers
4. Includes comment line: `# Managed by ragnatramp - do not edit this block`

**Example**:
```
# BEGIN RAGNATRAMP
# Managed by ragnatramp - do not edit this block
172.16.0.11 db
172.16.0.10 web
# END RAGNATRAMP
```

---

## Shared Patterns

All new PowerShell scripts follow the existing patterns in `src/hyperv/commands.ts`:

1. **String escaping**: All user-provided values pass through `escapePowerShellString()`
2. **Array handling**: Null check → array check → force-array wrapping for ConvertTo-Json
3. **Error handling**: Use `$ErrorActionPreference = 'Stop'` for scripts that must not fail silently; use `-ErrorAction SilentlyContinue` for query scripts that should return empty on failure
4. **JSON output**: All scripts return JSON via `ConvertTo-Json -Depth 3`
5. **Verbose**: Automatically logged to stderr by `HyperVExecutor` when `--verbose` is enabled
