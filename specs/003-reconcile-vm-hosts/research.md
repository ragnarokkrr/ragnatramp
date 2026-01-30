# Research: Reconcile VM IPs + Sync /etc/hosts

**Branch**: `003-reconcile-vm-hosts` | **Date**: 2026-01-30

## R1: Get-VMNetworkAdapter Output Format

**Decision**: Use `Get-VMNetworkAdapter -VMName '<name>'` to discover network state per VM.

**Rationale**: This is the standard Hyper-V cmdlet for querying VM network adapter details. It returns adapter-level data including IP addresses reported by Hyper-V Integration Services (guest-to-host IP reporting). No guest-side execution needed for IP discovery.

**Key Properties**:
- `Name` (string): Adapter display name (e.g., "Network Adapter")
- `MacAddress` (string): MAC in format `001122334455` (no delimiters)
- `SwitchName` (string | null): Connected virtual switch name (e.g., "Default Switch")
- `IPAddresses` (string[]): Array of IP addresses reported by guest integration services. Contains both IPv4 and IPv6 addresses as strings. May be empty if guest tools not ready or VM not running.

**Alternatives Considered**:
- `Get-VM | Select-Object -ExpandProperty NetworkAdapters`: Same data but less explicit. Rejected because direct `Get-VMNetworkAdapter` is clearer and allows filtering.
- `Invoke-Command -VMName ... { ip addr }`: Guest-side query. Rejected per clarification — single-pass hypervisor-only discovery.
- WMI/CIM (`Get-CimInstance Msvm_ComputerSystem`): Lower-level API. Rejected — unnecessary complexity for this use case.

**Edge Cases Discovered**:
- `IPAddresses` is empty when VM is off or guest integration services haven't reported yet.
- `IPAddresses` contains both IPv4 and IPv6 mixed — must filter by regex.
- A VM can have multiple adapters; must filter by `SwitchName -eq 'Default Switch'`.
- `MacAddress` has no delimiters — format as `00:11:22:33:44:55` for display if needed.

## R2: IPv4 Extraction from IPAddresses Array

**Decision**: Filter `IPAddresses` with regex `^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$` to select IPv4. Take the first match.

**Rationale**: The `IPAddresses` array contains both IPv4 and IPv6 as strings. IPv4 addresses match a simple dotted-decimal pattern. Taking the first match is sufficient for DHCP single-adapter scenarios.

**Alternatives Considered**:
- Parse with `net.isIPv4()` in Node.js: Viable but adds complexity for a simple regex filter already done in PowerShell-land.
- Return all IPv4s: Unnecessary — Default Switch assigns one IPv4 per adapter via DHCP.

## R3: DHCP Delay and Retry Strategy

**Decision**: Poll `Get-VMNetworkAdapter` every 3 seconds for up to 60 seconds total when a running VM reports no IPv4.

**Rationale**: After VM boot, DHCP lease acquisition takes 2–15 seconds on the Hyper-V Default Switch. Guest Integration Services need additional time to report the IP back to the hypervisor. A 60-second timeout with 3-second polling (20 attempts) covers typical scenarios with margin.

**Alternatives Considered**:
- Single query with no retry: Too fragile — VMs just started by `up` may not have IPs yet.
- Exponential backoff: Unnecessary complexity for a 60s window with lightweight polls.
- Event-based waiting: Hyper-V doesn't expose a clean event for "IP assigned"; polling is standard.

## R4: Invoke-Command -VMName (PowerShell Direct)

**Decision**: Use `Invoke-Command -VMName '<name>' -ScriptBlock { ... }` to write `/etc/hosts` inside Linux VMs.

**Rationale**: PowerShell Direct communicates over the VMBus (no network required), works with Hyper-V Administrators membership, and supports Linux guests with PowerShell installed or via `Invoke-Command` with `-Credential` for Linux remoting. For Linux guests with Hyper-V Guest Integration Services, this is the recommended approach.

**Key Considerations**:
- Requires PowerShell to be installed in the Linux guest, OR use `Invoke-Command` with an SSH-based transport. Since the spec prohibits SSH, we depend on PowerShell being available in the guest.
- If PowerShell is not installed in the guest, `Invoke-Command -VMName` will fail — this is caught per-VM and reported as a warning.
- The `-ScriptBlock` receives the hosts block content via `-ArgumentList`.
- Credential handling: PowerShell Direct to Linux guests may require credentials. The implementation should support passing credentials or using default guest session if available.

**Alternatives Considered**:
- `Copy-VMFile` (host-to-guest): Can copy a file into the guest but cannot execute scripts to merge content. Would overwrite the entire file rather than replacing the managed block. Rejected.
- SSH: Rejected per spec constraint — no SSH.
- Ansible: Rejected per spec constraint — no Ansible.

**Risk**: `Invoke-Command -VMName` for Linux guests requires either:
1. PowerShell installed in the guest + Hyper-V Integration Services, or
2. Guest OS with `hv_utils` module and SSH subsystem configured for PS remoting.

This is documented as an assumption in the spec: "Hyper-V Guest Integration Services are enabled on the VMs."

## R5: /etc/hosts Managed Block Pattern

**Decision**: Use `# BEGIN RAGNATRAMP` / `# END RAGNATRAMP` as delimiters (uppercase). Replace entire block on each reconcile.

**Rationale**: This is a well-established pattern (used by Puppet, cloud-init, etc.) for managing sections of configuration files without disturbing user content. Regex-based replacement ensures idempotency.

**Regex for replacement**: `(?s)# BEGIN RAGNATRAMP.*?# END RAGNATRAMP\n?`

**Block format**:
```
# BEGIN RAGNATRAMP
# Managed by ragnatramp - do not edit this block
172.16.0.10 web
172.16.0.11 db
# END RAGNATRAMP
```

**Alternatives Considered**:
- JSON marker with version: Overengineered for `/etc/hosts`.
- Separate file in `/etc/hosts.d/`: Not universally supported across Linux distros.

## R6: State Migration Strategy

**Decision**: No migration needed. The new `network` field is optional (`network?: NetworkState`). Old state files without it parse correctly — TypeScript treats missing `network` as `undefined`.

**Rationale**: The `StateManager.load()` method reads JSON and casts to `StateFile`. Since JSON parsing doesn't validate against the TypeScript interface, missing fields simply become `undefined`. All code that reads `network` uses optional chaining (`vm.network?.ipv4`).

**No version bump**: The `version: 1` field in the state file does not need to change because this is an additive, backward-compatible change. The version field exists for future breaking migrations.

**Alternatives Considered**:
- Bump version to 2 + migration function: Unnecessary for an additive field.
- Separate network state file: Rejected per spec — state remains the single file.

## R7: Duplicate IP Detection

**Decision**: After discovering all VM IPs, check for duplicates. If two VMs report the same IPv4, warn and skip hosts sync for the conflicting VMs.

**Rationale**: DHCP conflicts are rare on the Default Switch but not impossible (e.g., stale leases after restore). Writing incorrect hosts entries would silently break inter-VM communication. Detecting and warning is safer.

**Algorithm**: Build a `Map<string, string[]>` of IPv4 → machineNames. If any IPv4 maps to more than one machine, flag those VMs as conflicting.
