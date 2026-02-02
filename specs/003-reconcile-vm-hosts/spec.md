# Feature Specification: Reconcile VM IPs + Sync /etc/hosts

**Feature Branch**: `003-reconcile-vm-hosts`
**Created**: 2026-01-30
**Status**: Draft
**Input**: User description: "Add a CLI command `ragnatramp reconcile` that discovers current VM network attributes (IPv4 at minimum) and persists them as new YAML fields in the existing project state file. Sync `/etc/hosts` inside all running VMs using the reconciled IPs/hostnames. Guarantee `reconcile` runs automatically after `preflight` in the normal workflow (e.g. `up`, `apply`, or equivalent), so state + hosts are correct before any provisioning steps."

## Clarifications

### Session 2026-01-30

- Q: Which network fields should the state file store per VM? → A: ~~Minimal (revised)~~ Full — `network.ipv4` (string | null), `network.ipv6` (optional string list), `network.mac` (string | null), `network.adapterName` (string | null, optional), `network.discoveredAt` (ISO timestamp | null), `network.source` ("hyperv" | "guest-file" | "guest-cmd"), `network.previousIpv4` (string | null, optional — stored on change)
- Q: Should IP discovery include a guest-side fallback mechanism? → A: No. Single-pass only via `Get-VMNetworkAdapter` → `IPAddresses` → first IPv4. Retry with timeout for DHCP delay. No guest fallback.
- Q: What transport mechanism writes `/etc/hosts` inside guest VMs? → A: `Invoke-Command -VMName` (PowerShell Direct over VMBus). A script block inside the guest reads current `/etc/hosts`, replaces the managed block, and writes back. No SSH, no `Copy-VMFile`.
- Q: What is the failure policy for reconcile? → A: Two-tier. IP discovery is fail-fast: if ANY running VM has no IPv4 after timeout, reconcile fails entirely and hosts sync is skipped. Hosts sync is per-VM non-fatal: if a `/etc/hosts` write fails on one VM, warn and continue with remaining VMs.
- Q: What casing for `/etc/hosts` managed block markers? → A: Uppercase: `# BEGIN RAGNATRAMP` / `# END RAGNATRAMP`.
- Q: (Revised) Which network fields should the state file store per VM? → A: Full schema — `ipv4`, `ipv6` (optional list), `mac`, `adapterName` (optional), `discoveredAt`, `source` ("hyperv" | "guest-file" | "guest-cmd"), `previousIpv4` (optional, stored on change). Supersedes prior minimal answer.
- Q: Should `ragnatramp status` display network fields? → A: Yes. Status MUST show `ipv4` (or `ipv6` if no IPv4), `adapterName`, and `source` per VM.
- Q: Should reconcile support a dry-run mode? → A: Yes. `ragnatramp reconcile --dry-run` prints discovered IPs, state diffs (old → new), and the rendered `/etc/hosts` managed block, without writing state or touching guests.

### Session 2026-02-02

- Q: ~~(Revised)~~ Should IP discovery include a guest-side fallback mechanism? → A: Yes (supersedes prior "No" answer). Use tiered discovery: try KVP (`Get-VMNetworkAdapter → IPAddresses`) first; if empty, fall back to ARP-based discovery (`Get-VMNetworkAdapter → MacAddress` cross-referenced with `Get-NetNeighbor` on the Default Switch interface). Both are host-only, no guest execution. Per R8 findings: KVP requires `hv_kvp_daemon` in guest; ARP requires no guest dependencies.
- Q: ~~(Revised)~~ What transport mechanism writes `/etc/hosts` inside guest VMs? → A: SSH (supersedes prior "PowerShell Direct" answer). Per R8 findings: `Invoke-Command -VMName` (PowerShell Direct) requires `pwsh` installed in the Linux guest, which is not standard. SSH is universally available. The SSH prohibition from the original spec is lifted.
- Q: How should SSH credentials be configured for guest execution? → A: Per-machine in YAML with a project-level default. Fields: `ssh.user` (string), `ssh.private_key` (file path). Machine-level `ssh` block overrides the project-level default. Mirrors Vagrant's `config.ssh` pattern for explicit, auditable control.
- Q: How should privilege escalation work for writing `/etc/hosts` via SSH? → A: SSH connects as the configured user and uses `sudo` (e.g., `sudo tee /etc/hosts`). Assumes passwordless sudo for the configured SSH user. No direct root login required.
- Q: How should golden image requirements be documented and enforced? → A: Document minimum guest prerequisites in the spec as a dedicated section. Additionally, `reconcile` checks KVP integration service status (`Get-VMIntegrationService`) and SSH reachability at runtime, emitting actionable warnings (not fatal errors) when prerequisites are missing or degraded.
- Q: How should the SSH transport be implemented in Node.js? → A: Spawn the system `ssh` binary via `child_process.execFile('ssh', [...])` with key-based auth. No new npm dependencies. Consistent with the existing pattern of shelling out to `powershell.exe` for Hyper-V cmdlets.
- Q: Should `--dry-run` show prerequisite diagnostics (KVP status, SSH reachability)? → A: Yes. Dry-run displays KVP integration service warnings and performs SSH TCP port checks (no auth, no commands sent). This lets users validate their golden image before committing a real reconcile.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Discover and Persist VM IP Addresses (Priority: P1)

As a user who has brought up a multi-machine environment, I want to run `ragnatramp reconcile <file>` so that each running VM's current IPv4 address is discovered from the Hyper-V hypervisor and persisted into the project state file. This gives me a single source of truth for VM network identity without needing to log into each VM individually or inspect the Hyper-V Manager UI.

**Why this priority**: Without IP discovery and persistence, no downstream features (hosts sync, provisioning, SSH) can reference VMs by address. This is the foundational data-gathering step that all other stories depend on.

**Independent Test**: Can be fully tested by running `ragnatramp reconcile ragnatramp.yaml` against a multi-VM environment and then inspecting the state file to confirm each running VM has an `ipv4` field populated with a valid address.

**Acceptance Scenarios**:

1. **Given** two running VMs (`web` and `db`) managed by ragnatramp, **When** the user runs `ragnatramp reconcile ragnatramp.yaml`, **Then** the state file is updated with each VM's current IPv4 address and the CLI reports the discovered addresses.
2. **Given** a VM (`web`) that is running and a VM (`db`) that is powered off, **When** the user runs `ragnatramp reconcile ragnatramp.yaml`, **Then** the running VM's IP is discovered and persisted; the powered-off VM is reported as unreachable and its IP field is cleared (set to null or omitted).
3. **Given** a running VM whose DHCP lease has not yet been assigned (no IP available), **When** the user runs `ragnatramp reconcile ragnatramp.yaml`, **Then** the system retries IP discovery with polling until timeout (60s default), and if no IP is found, reconcile fails with a non-zero exit code identifying the VM, and hosts sync is skipped entirely.
4. **Given** a VM with multiple network adapters, **When** the user runs `ragnatramp reconcile ragnatramp.yaml`, **Then** the system records the IPv4 address from the first adapter connected to the Default Switch.

---

### User Story 2 - Sync /etc/hosts Across Running VMs (Priority: P2)

As a user running a multi-machine environment, I want all running Linux VMs to have an up-to-date `/etc/hosts` file containing the hostnames and IPs of every peer VM in the project, so that VMs can reach each other by name (e.g., `ping db` from the `web` VM) without manual configuration or external DNS.

**Why this priority**: Hostname resolution between VMs is essential for most multi-machine workflows (database connections, service discovery, etc.), but it depends on Story 1 (IP discovery) being complete first.

**Independent Test**: Can be tested by running `ragnatramp reconcile ragnatramp.yaml` on a multi-VM setup, then SSH-ing into each VM and verifying that `/etc/hosts` contains entries for all peer VMs with correct IPs and hostnames.

**Acceptance Scenarios**:

1. **Given** two running VMs (`web` at 172.16.0.10, `db` at 172.16.0.11), **When** reconcile completes hosts sync, **Then** the `web` VM's `/etc/hosts` contains an entry `172.16.0.11 db` and the `db` VM's `/etc/hosts` contains an entry `172.16.0.10 web`.
2. **Given** the `/etc/hosts` file already contains ragnatramp-managed entries from a previous run, **When** reconcile runs again with updated IPs, **Then** the managed entries are replaced (not duplicated) and non-ragnatramp entries are left untouched.
3. **Given** three VMs where one (`cache`) is powered off, **When** reconcile syncs hosts, **Then** only the two running VMs receive hosts updates; the powered-off VM is skipped and a warning is displayed; running VMs do NOT receive a stale entry for the powered-off VM.
4. **Given** the hosts sync encounters a write failure inside a VM (e.g., permission denied), **When** reconcile attempts the sync, **Then** the failure is reported per-VM with an actionable error message, and reconcile continues processing remaining VMs.

---

### User Story 3 - Automatic Reconcile in the Up Workflow (Priority: P3)

As a user, I want `ragnatramp up` to automatically run the reconcile step after preflight checks and VM creation/start, so that by the time the `up` command completes, all running VMs have current IPs in state and correct `/etc/hosts` entries without me needing to run a separate command.

**Why this priority**: Automation of the reconcile step in the standard workflow removes a manual step and ensures the environment is fully configured after a single command. However, it depends on Stories 1 and 2 being solid first.

**Independent Test**: Can be tested by running `ragnatramp up ragnatramp.yaml` from scratch, then inspecting the state file for IPs and SSH-ing into VMs to verify `/etc/hosts` content, all without ever running `reconcile` manually.

**Acceptance Scenarios**:

1. **Given** a fresh configuration with two machines, **When** the user runs `ragnatramp up ragnatramp.yaml`, **Then** VMs are created, started, IPs are discovered, state is updated with IPs, and `/etc/hosts` is synced inside each VM, all in one command.
2. **Given** an already-running environment where `up` determines no VM changes are needed, **When** the user runs `ragnatramp up ragnatramp.yaml`, **Then** the reconcile step still runs to refresh IPs and hosts entries (IPs may have changed due to DHCP renewal).
3. **Given** the reconcile step fails (e.g., a VM has no IP after timeout), **When** the user runs `ragnatramp up ragnatramp.yaml`, **Then** the `up` command completes with a warning (non-fatal) and reports which VMs could not be reconciled, rather than failing the entire operation.

---

### User Story 4 - Dry-Run Preview of Reconcile (Priority: P4)

As a user, I want to run `ragnatramp reconcile <file> --dry-run` to preview what reconcile would do — see discovered IPs, state diffs (old vs new values), and the rendered `/etc/hosts` managed block — without writing any changes to the state file or touching guest VMs. This lets me verify the reconcile outcome before committing it.

**Why this priority**: Dry-run is a safety and debugging feature. It depends on the core reconcile logic (Stories 1–2) being implemented first, but it reuses the same discovery and rendering code paths in read-only mode.

**Independent Test**: Can be tested by running `ragnatramp reconcile ragnatramp.yaml --dry-run` and verifying that the state file is unchanged (compare checksum before/after) and no guest SSH commands were executed (verify via `--verbose` that only TCP port checks occurred, no SSH sessions were opened).

**Acceptance Scenarios**:

1. **Given** two running VMs with IPs already in state, **When** the user runs `ragnatramp reconcile ragnatramp.yaml --dry-run`, **Then** the CLI prints each VM's discovered IP, shows "no change" or "changed: old → new" per VM, prints the rendered hosts block, and exits with code 0 without modifying the state file.
2. **Given** a VM whose IP has changed since the last reconcile, **When** the user runs `ragnatramp reconcile ragnatramp.yaml --dry-run`, **Then** the CLI prints the diff showing `ipv4: 172.16.0.10 → 172.16.0.15` for that VM, and the state file remains unchanged.
3. **Given** `--dry-run` combined with `--json`, **When** the user runs `ragnatramp reconcile ragnatramp.yaml --dry-run --json`, **Then** the output is a JSON object containing discovery results, diffs, and the rendered hosts block, with no side effects.
4. **Given** `--dry-run` mode, **When** the reconcile discovers a running VM with no IP, **Then** the fail-fast behavior still applies to reporting (exit non-zero) but no state is written.

---

### Edge Cases

- What happens when a VM has an IPv6 address but no IPv4 address? The system stores the IPv6 addresses in the `network.ipv6` field and reports a warning that no IPv4 was found. The `/etc/hosts` sync uses IPv4 only; no IPv6 entries are written to hosts files. The `status` command displays the IPv6 address when no IPv4 is available.
- What happens when two VMs are assigned the same IP by DHCP (conflict)? The system detects the duplicate, warns the user, and skips hosts sync for the conflicting VMs to avoid incorrect entries.
- What happens when the state file contains a VM that no longer exists in Hyper-V? The reconcile step clears the IP field for that VM and warns the user about the orphaned state entry.
- How does the system handle a VM that is running but the Hyper-V cmdlet returns no network adapter data? The system treats this as "no IP available" and reports a warning.
- What happens when `/etc/hosts` inside a VM is read-only or on a read-only filesystem? The write failure is caught per-VM, reported with an actionable message, and does not block other VMs.
- What happens when the user runs `reconcile` with no VMs created yet? The system reports that no VMs are managed and exits cleanly with a zero exit code.
- How does the system manage the boundary between ragnatramp-managed entries and user-managed entries in `/etc/hosts`? Managed entries are enclosed by uppercase marker comments (`# BEGIN RAGNATRAMP` / `# END RAGNATRAMP`) so they can be identified and replaced without affecting other entries.
- What happens when KVP reports "No Contact" but the VM has a working IP? The system falls back to ARP-based discovery, logs a warning recommending `linux-cloud-tools` installation, and records `source: "arp"` in state. This is a degraded but functional path.
- What happens when a VM's IP is discoverable but SSH is unreachable? The IP is still persisted in state (IP discovery succeeds), but hosts sync is skipped for that VM with a warning. Other VMs proceed normally per FR-009b.
- What happens when stale ARP entries exist from previously deleted VMs? No impact — ARP lookup is always keyed by the MAC address of a known, managed VM. Stale MACs from deleted VMs are never queried.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a `ragnatramp reconcile <file>` CLI command that discovers IPv4 addresses for all managed VMs and persists them in the project state file.
- **FR-002**: System MUST query IPv4 addresses using a tiered host-only algorithm: (1) Primary: `Get-VMNetworkAdapter` → `IPAddresses` property → select the first IPv4 from the adapter on the Default Switch (requires guest `hv_kvp_daemon`); (2) Fallback: if `IPAddresses` is empty, cross-reference the adapter's `MacAddress` against the host ARP table via `Get-NetNeighbor -InterfaceAlias 'vEthernet (Default Switch)'` to resolve IPv4. No guest-side execution for IP discovery. If no IP is available after both tiers, retry with polling until timeout (FR-005). The `network.source` field records `"hyperv"` for KVP-based or `"arp"` for ARP-based discovery.
- **FR-003**: System MUST extend the existing state file schema with a `network` object per VM containing: `ipv4` (string | null), `ipv6` (optional string list), `mac` (string | null), `adapterName` (string | null, optional), `discoveredAt` (ISO timestamp | null), `source` ("hyperv" | "arp" | "guest-file" | "guest-cmd"), and `previousIpv4` (string | null, optional — set to the prior `ipv4` value when the address changes). No separate state files.
- **FR-004**: System MUST set the `network` fields to null for VMs that are not running (powered off, saved, etc.). For running VMs that have no IPv4 after the retry timeout, reconcile fails entirely per FR-009a; no partial state update occurs.
- **FR-005**: System MUST retry IP discovery for VMs that are running but report no IP, to handle DHCP lease delays. A reasonable default timeout applies (assumed: 60 seconds with periodic polling).
- **FR-006**: System MUST write `/etc/hosts` entries inside each running Linux VM via SSH using the discovered IP address. SSH is executed by spawning the system `ssh` binary (`child_process.execFile('ssh', [...])`) with key-based authentication — no additional npm dependencies. The remote command connects as the configured SSH user and uses `sudo` to read current `/etc/hosts`, replace the ragnatramp-managed block (between marker comments), and write the file back. Assumes passwordless sudo for the configured user. SSH credentials are configured per-machine in `ragnatramp.yaml` with project-level defaults (`ssh.user`, `ssh.private_key`); machine-level settings override the project default. No PowerShell Direct or `Copy-VMFile`.
- **FR-007**: System MUST use marker comments (`# BEGIN RAGNATRAMP` / `# END RAGNATRAMP`) in `/etc/hosts` to delineate managed entries, ensuring idempotent updates and preserving user-managed entries.
- **FR-008**: System MUST include entries for all running peer VMs in each VM's `/etc/hosts` (each VM gets entries for every OTHER running VM in the project).
- **FR-009**: System MUST enforce a two-tier failure policy: (a) IP discovery is fail-fast — if ANY running VM has no IPv4 after the retry timeout, reconcile fails with a non-zero exit code and hosts sync is skipped entirely; (b) hosts sync is per-VM non-fatal — if a `/etc/hosts` write fails on one VM, the system warns and continues with remaining VMs.
- **FR-010**: System MUST integrate the reconcile step into the `up` command workflow, executing automatically after VMs are created/started and before the command reports completion.
- **FR-011**: Reconcile failures during `up` MUST be non-fatal to the `up` command itself; `up` completes with warnings and reports which VMs could not be reconciled. The reconcile step internally still enforces its own fail-fast IP policy (FR-009a), but `up` treats a reconcile failure as a warning, not a fatal error.
- **FR-012**: System MUST support the `--verbose` flag on the `reconcile` command, consistent with all other commands.
- **FR-013**: System MUST support the `--json` flag on the `reconcile` command for machine-readable output, consistent with all other commands.
- **FR-014**: System MUST use the hostname from the machine `name` field in the configuration YAML as the hostname written to `/etc/hosts` entries.
- **FR-015**: System MUST NOT manage the Windows host machine's hosts file.
- **FR-016**: System MUST NOT implement static IP assignment; only DHCP-assigned addresses are discovered and recorded.
- **FR-017**: The `ragnatramp status` command MUST display network fields for each VM: `ipv4` (or `ipv6` if no IPv4 is available), `adapterName`, and `source`. These fields are shown in both human-readable and `--json` output modes.
- **FR-018**: System MUST support a `--dry-run` flag on the `reconcile` command. When set, the system performs IP discovery and computes state diffs and the hosts block, then prints: (a) prerequisite diagnostics — KVP integration service status per VM and SSH TCP port reachability (port check only, no authentication or commands), (b) discovered IPs per VM with discovery tier used (`hyperv` or `arp`), (c) state diffs showing old → new values for changed fields, (d) the rendered `/etc/hosts` managed block. The system MUST NOT write to the state file or execute any guest SSH commands in dry-run mode. Exit code follows normal semantics (0 success, non-zero if fail-fast triggered).
- **FR-019**: During reconcile, the system MUST perform runtime prerequisite diagnostics and emit actionable warnings: (a) check `Get-VMIntegrationService -Name 'Key-Value Pair Exchange'` — if status is "No Contact", warn that KVP daemon is missing and IP discovery is using ARP fallback (include fix: `apt install linux-cloud-tools-$(uname -r)`); (b) before hosts sync, verify SSH reachability to each VM's discovered IP on port 22 — if unreachable, warn with the VM name and IP, and skip that VM's hosts sync (per FR-009b). These diagnostics are warnings, not fatal errors.

### Key Entities

- **VM Network State**: Per-VM network attributes discovered from the hypervisor. Stored as a `network` object within the existing VMState record containing: `ipv4` (string | null — the discovered IPv4 address), `ipv6` (optional string list — any IPv6 addresses reported by the adapter), `mac` (string | null — the MAC address of the adapter on the Default Switch), `adapterName` (string | null, optional — the Hyper-V network adapter name), `discoveredAt` (ISO timestamp | null — when the discovery was performed), `source` ("hyperv" | "arp" | "guest-file" | "guest-cmd" — provenance of the discovery; "hyperv" = KVP-based via `IPAddresses`, "arp" = ARP table cross-reference via `Get-NetNeighbor`), and `previousIpv4` (string | null, optional — the prior IPv4 value, stored when the address changes). All fields are null/omitted when the VM is off or unreachable.
- **Hosts Entry**: A mapping of hostname to IPv4 address representing a single line in a VM's `/etc/hosts` file. The set of entries is derived from the reconciled state of all running peer VMs.
- **Managed Hosts Block**: The section of `/etc/hosts` delimited by `# BEGIN RAGNATRAMP` and `# END RAGNATRAMP` marker comments, containing all ragnatramp-managed entries. This block is replaced atomically on each reconcile.

### Golden Image Requirements

Minimum guest prerequisites for full ragnatramp reconcile functionality. These apply to any Linux VM image used with ragnatramp.

**Required** (reconcile will not function without these):
- **SSH server** (`sshd`) running and accepting key-based authentication on port 22.
- **Passwordless sudo** configured for the SSH user (e.g., `<user> ALL=(ALL) NOPASSWD: ALL` in sudoers).
- **Standard `/etc/hosts`** file at the expected path, writable by root.

**Recommended** (improves performance and diagnostic quality):
- **`hv_kvp_daemon`** running (Ubuntu: `linux-cloud-tools-$(uname -r)` package). Enables fast KVP-based IP discovery via `Get-VMNetworkAdapter → IPAddresses`. Without it, IP discovery falls back to ARP (functional but emits a diagnostic warning).
- **Hyper-V Guest Integration Services** kernel modules loaded (`hv_utils`, `hv_vmbus`, `hv_netvsc`). Standard on most modern Linux kernels.

**Not required**:
- PowerShell (`pwsh`) — not needed; hosts sync uses SSH, not PowerShell Direct.
- `Guest Service Interface` integration service — not used.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After running `reconcile`, every running VM's IPv4 address is accurately recorded in the state file, verifiable by inspecting the state and comparing to the actual Hyper-V-reported address.
- **SC-002**: After running `reconcile`, every running VM can resolve every other running VM's hostname to the correct IP address via `/etc/hosts`, verifiable by running `ping <hostname>` from within each VM.
- **SC-003**: Running `reconcile` multiple times produces identical results (idempotent); `/etc/hosts` entries are not duplicated and state values match current reality.
- **SC-004**: Non-ragnatramp entries in `/etc/hosts` are never modified, verifiable by adding custom entries before reconcile and confirming they remain after.
- **SC-005**: `ragnatramp up` completes with VMs having correct IPs in state and correct `/etc/hosts` entries without the user needing to run any additional commands.
- **SC-006**: When a VM has no discoverable IP, the user receives a clear warning message within 90 seconds of the reconcile step starting.
- **SC-007**: Running `reconcile --dry-run` produces identical discovery and diff output as a real reconcile, but leaves the state file and guest VMs completely untouched, verifiable by comparing file checksums before and after.

### Assumptions

- VMs are running Linux guests with a standard `/etc/hosts` file at the expected path.
- VMs have an SSH server (`sshd`) running and reachable on the discovered IP address. This is the sole guest-side prerequisite for hosts sync.
- Hyper-V Guest Integration Services are enabled on the VMs. The KVP Data Exchange service (`hv_kvp_daemon`) is recommended for optimal IP discovery but not required — ARP-based fallback covers guests without it.
- The Default Switch provides DHCP-assigned IPv4 addresses to guests.
- The machine `name` from the YAML config is used as the hostname in hosts entries (e.g., machine `web` becomes hostname `web`).
- The user has "Hyper-V Administrators" group membership, sufficient for `Get-VM` network queries and `Get-NetNeighbor` ARP lookups.
- SSH credentials (user and private key path) are configured in `ragnatramp.yaml`. The user is responsible for ensuring key-based SSH access is set up on each VM.
- The retry timeout for DHCP IP availability defaults to 60 seconds; this is a reasonable default and does not need user configuration in MVP.
