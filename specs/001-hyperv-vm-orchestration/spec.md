# Feature Specification: Ragna Tramp MVP - Hyper-V VM Orchestration

**Feature Branch**: `001-hyperv-vm-orchestration`
**Created**: 2026-01-19
**Status**: Draft
**Input**: User description: "Confined-environment, user-space CLI that emulates the core of Vagrant multi-machine orchestration for Hyper-V on Windows 11 Pro"

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create and Start Multi-VM Environment (Priority: P1)

As a developer on an enterprise laptop, I want to spin up a multi-VM environment from a single YAML configuration file so that I can quickly create reproducible development/test environments without manual Hyper-V Manager interaction.

**Why this priority**: This is the core value proposition. Without the ability to create VMs from configuration, no other features matter.

**Independent Test**: Run `ragnatramp up ragnatramp.yaml` with a valid 2-VM configuration and verify both VMs are created, configured, and running in Hyper-V.

**Acceptance Scenarios**:

1. **Given** a valid `ragnatramp.yaml` defining 2 VMs with a golden VHDX path, **When** I run `ragnatramp up ragnatramp.yaml`, **Then** both VMs are created in Hyper-V with correct names, CPU, memory, disk attached, connected to Default Switch, and started.

2. **Given** VMs already exist and are running from a previous `up`, **When** I run `ragnatramp up ragnatramp.yaml` again, **Then** no duplicate VMs are created and existing VMs remain running (idempotent).

3. **Given** a valid YAML with 3 VMs, **When** I run `ragnatramp up ragnatramp.yaml`, **Then** all 3 VMs are created and started successfully.

4. **Given** the golden VHDX path in YAML does not exist, **When** I run `ragnatramp up ragnatramp.yaml`, **Then** the command fails with exit code 1 and a clear error message identifying the missing file.

---

### User Story 2 - Validate Configuration Before Execution (Priority: P2)

As a developer, I want to validate my YAML configuration against the schema before making any changes to Hyper-V so that I can catch errors early without side effects.

**Why this priority**: Validation is a safety gate that prevents partial failures. Essential for safe operation but requires P1 infrastructure.

**Independent Test**: Run `ragnatramp validate ragnatramp.yaml` with various valid and invalid configurations and verify correct pass/fail results.

**Acceptance Scenarios**:

1. **Given** a syntactically correct YAML that conforms to the schema, **When** I run `ragnatramp validate ragnatramp.yaml`, **Then** it exits with code 0 and prints "Configuration valid".

2. **Given** a YAML with missing required field (e.g., no `machines`), **When** I run `ragnatramp validate ragnatramp.yaml`, **Then** it exits with code 1 and identifies the missing field.

3. **Given** a YAML with invalid value (e.g., `cpu: "lots"`), **When** I run `ragnatramp validate ragnatramp.yaml`, **Then** it exits with code 1 and identifies the invalid value with expected type.

4. **Given** a non-existent file path, **When** I run `ragnatramp validate nonexistent.yaml`, **Then** it exits with code 1 and reports "File not found".

---

### User Story 3 - Preview Changes Before Execution (Priority: P2)

As a developer, I want to see what actions will be taken before they execute so that I can verify the plan and avoid surprises.

**Why this priority**: Plan command is critical for safe operation in enterprise environments where mistakes are costly.

**Independent Test**: Run `ragnatramp plan ragnatramp.yaml` and verify it shows intended actions without modifying Hyper-V.

**Acceptance Scenarios**:

1. **Given** no VMs exist and a valid YAML, **When** I run `ragnatramp plan ragnatramp.yaml`, **Then** it shows "Will create VM: [name]" for each machine, with CPU/memory/disk details.

2. **Given** VMs exist matching the YAML, **When** I run `ragnatramp plan ragnatramp.yaml`, **Then** it shows "No changes required" or lists only the differences.

3. **Given** YAML was modified to change VM memory, **When** I run `ragnatramp plan ragnatramp.yaml`, **Then** it shows "Will modify VM [name]: memory 2048MB → 4096MB".

4. **Given** any state, **When** I run `ragnatramp plan ragnatramp.yaml`, **Then** no Hyper-V resources are created, modified, or deleted.

---

### User Story 4 - Check Environment Status (Priority: P2)

As a developer, I want to see the current state of all managed VMs so that I can understand what's running and its health.

**Why this priority**: Status visibility is essential for debugging and understanding current state.

**Independent Test**: Run `ragnatramp status ragnatramp.yaml` and verify it correctly reports VM states.

**Acceptance Scenarios**:

1. **Given** 2 managed VMs (one running, one stopped), **When** I run `ragnatramp status ragnatramp.yaml`, **Then** it lists both VMs with their names, states (Running/Off), and resource allocation.

2. **Given** no managed VMs exist, **When** I run `ragnatramp status ragnatramp.yaml`, **Then** it shows "No managed VMs found for this configuration".

3. **Given** `--json` flag, **When** I run `ragnatramp status ragnatramp.yaml --json`, **Then** output is valid JSON with VM details.

---

### User Story 5 - Stop VMs Safely (Priority: P3)

As a developer, I want to stop my VMs gracefully so that I can free resources without destroying the environment.

**Why this priority**: Halt is needed for resource management but is less critical than create/destroy.

**Independent Test**: Run `ragnatramp halt ragnatramp.yaml` and verify VMs are stopped gracefully.

**Acceptance Scenarios**:

1. **Given** 2 running managed VMs, **When** I run `ragnatramp halt ragnatramp.yaml`, **Then** both VMs are stopped (graceful shutdown attempted, then forced after timeout).

2. **Given** one specific VM name in YAML, **When** I run `ragnatramp halt ragnatramp.yaml web`, **Then** only the VM named "web" is stopped.

3. **Given** `--all` flag, **When** I run `ragnatramp halt ragnatramp.yaml --all`, **Then** all managed VMs are stopped.

4. **Given** VMs are already stopped, **When** I run `ragnatramp halt ragnatramp.yaml`, **Then** it exits with code 0 (idempotent).

---

### User Story 6 - Destroy Environment Safely (Priority: P3)

As a developer, I want to destroy my VM environment completely so that I can clean up resources when done.

**Why this priority**: Cleanup is essential but requires extra safety measures.

**Independent Test**: Run `ragnatramp destroy ragnatramp.yaml` and verify only managed VMs are removed.

**Acceptance Scenarios**:

1. **Given** 2 managed VMs, **When** I run `ragnatramp destroy ragnatramp.yaml`, **Then** both VMs are stopped (if running) and removed from Hyper-V, and their disk files are deleted.

2. **Given** an unmanaged VM exists with a similar name, **When** I run `ragnatramp destroy ragnatramp.yaml`, **Then** the unmanaged VM is NOT touched and a warning is shown.

3. **Given** state file tracks VM "web" but it was manually deleted, **When** I run `ragnatramp destroy ragnatramp.yaml`, **Then** the command succeeds and state is cleaned up (idempotent).

4. **Given** `--all` flag with multiple VMs, **When** I run `ragnatramp destroy ragnatramp.yaml --all`, **Then** all managed VMs are destroyed.

---

### User Story 7 - Create and Restore Checkpoints (Priority: P4)

As a developer, I want to create named checkpoints of my VMs so that I can save state and restore to known-good configurations.

**Why this priority**: Checkpoints add significant value but are not essential for basic orchestration.

**Independent Test**: Create a checkpoint, make changes, restore, and verify state is restored.

**Acceptance Scenarios**:

1. **Given** 2 running managed VMs, **When** I run `ragnatramp checkpoint ragnatramp.yaml --name baseline`, **Then** a checkpoint named "baseline" is created for each VM.

2. **Given** checkpoints exist named "baseline", **When** I run `ragnatramp restore ragnatramp.yaml --name baseline`, **Then** each VM is restored to the "baseline" checkpoint (VMs are stopped first if running).

3. **Given** no checkpoint named "foo" exists, **When** I run `ragnatramp restore ragnatramp.yaml --name foo`, **Then** it fails with exit code 1 and error "Checkpoint 'foo' not found".

---

### Edge Cases

- What happens when Hyper-V service is not running? → Clear error: "Hyper-V service not available. Ensure vmms service is running."
- What happens when user is not in Hyper-V Administrators group? → Clear error with group membership instructions.
- What happens when Default Switch doesn't exist? → Clear error: "Default Switch not found. Ensure Hyper-V Default Switch exists."
- What happens when disk space is insufficient for VHDX copy? → Pre-flight check fails with required vs available space.
- What happens when state file is corrupted? → Warning shown, offer to rebuild state from Hyper-V or abort.
- What happens when YAML references a machine not in state? → Plan shows "Will create" for new machine.
- What happens when state references a VM deleted manually? → Warn and clean up state entry.

---

## Requirements *(mandatory)*

### Functional Requirements

#### CLI & Installation

- **FR-001**: System MUST be installable via `npm install` for current user (no global/admin install required).
- **FR-002**: System MUST provide executable `ragnatramp` (and alias `Ragnatramp`) after installation.
- **FR-003**: CLI MUST follow pattern: `ragnatramp <command> <file> [options]`.
- **FR-004**: CLI MUST support `--json` flag on all commands for machine-readable output.
- **FR-005**: CLI MUST support `--help` flag showing usage for each command.

#### Commands

- **FR-010**: `validate <file>` MUST validate YAML against schema without any Hyper-V operations.
- **FR-011**: `plan <file>` MUST show all intended actions (create/modify/start/stop/delete) without executing.
- **FR-012**: `up <file>` MUST converge environment to match YAML (create missing VMs, start stopped VMs).
- **FR-013**: `status <file>` MUST show all managed VMs with current state (Running/Off/etc).
- **FR-014**: `halt <file> [machine] [--all]` MUST stop specified or all managed VMs gracefully.
- **FR-015**: `destroy <file> [machine] [--all]` MUST remove specified or all managed VMs and their disks.
- **FR-016**: `checkpoint <file> --name <n>` MUST create named checkpoint for all managed VMs.
- **FR-017**: `restore <file> --name <n>` MUST restore all managed VMs to named checkpoint.

#### Configuration (YAML)

- **FR-020**: System MUST read configuration from YAML file (typically `ragnatramp.yaml`).
- **FR-021**: YAML MUST support defining 2-3 machines in MVP.
- **FR-022**: YAML MUST specify project name used in VM naming.
- **FR-023**: YAML MUST specify base image path (golden VHDX location).
- **FR-024**: YAML MUST allow per-machine overrides for: cpu (count), memory (MB), disk (size if expanding).
- **FR-025**: YAML MUST NOT support any embedded scripts or shell commands.
- **FR-026**: Configuration MUST be validated against JSON Schema before any operations.

#### VM Management

- **FR-030**: System MUST create VMs as Generation 2 (UEFI) by default.
- **FR-031**: System MUST use differencing disks linked to golden VHDX (preserves base image, fast creation).
- **FR-032**: System MUST connect all VMs to Hyper-V "Default Switch" only.
- **FR-033**: System MUST apply deterministic VM names: `{project}-{machine}-{hash8}` where hash is derived from config file absolute path.
- **FR-034**: System MUST tag VMs with Hyper-V Notes containing: ragnatramp version, config file path, managed marker.
- **FR-035**: System MUST store VM artifacts (differencing VHDXs, config) under user-writable path (default: `~/.ragnatramp/vms/{project}/`).

#### State Management

- **FR-040**: System MUST track created resources in `.ragnatramp/state.json` relative to YAML file location.
- **FR-041**: State file MUST record: VM IDs, VM names, disk paths, checkpoints, config hash.
- **FR-042**: System MUST verify VM ownership via state file + Hyper-V Notes before any destructive operation.
- **FR-043**: System MUST refuse to delete VMs not tracked in state file (safety).
- **FR-044**: System MUST detect drift between YAML and actual state, showing differences in `plan`.

#### Output & Errors

- **FR-050**: Human-readable output MUST be default; `--json` enables structured output.
- **FR-051**: Error messages MUST include: which operation failed, which Hyper-V cmdlet (if applicable), and suggested fix.
- **FR-052**: Exit codes MUST be: 0 = success, 1 = user/config error, 2 = Hyper-V/system error.
- **FR-053**: All destructive operations MUST be logged with timestamp, action, and result.

### Key Entities

- **Project**: A named collection of machines defined in one YAML file. Has name, artifact path, machines list.
- **Machine**: A VM definition within a project. Has name, cpu, memory, disk config, derived full VM name.
- **State**: Persistent record of what Ragna Tramp has created. Tracks VMs, disks, checkpoints, config hash.
- **Checkpoint**: A named snapshot of all VMs in a project at a point in time.

---

## Non-Goals (MVP Exclusions)

The following are explicitly **OUT OF SCOPE** for MVP:

| Exclusion               | Rationale                                                      |
|-------------------------|----------------------------------------------------------------|
| Synced/shared folders   | Requires SMB setup, guest integration; adds complexity         |
| Port forwarding DSL     | NAT configuration varies; users can configure manually in guest|
| Custom virtual switches | Must use Default Switch only per enterprise constraints        |
| Provisioning scripts    | No shell/PowerShell execution; security risk in enterprise     |
| Plugin/extension system | MVP must ship; extensibility is post-MVP                       |
| Multi-hypervisor support| Hyper-V only; no VMware/VirtualBox/WSL2                        |
| More than 3 VMs         | MVP scope limit; 2-3 machines sufficient for dev environments  |
| GUI/TUI                 | CLI only; graphical interface is post-MVP                      |
| Remote Hyper-V hosts    | Local management only                                          |
| Nested virtualization   | Not required for typical dev scenarios                         |
| ISO/DVD attachment      | Base image assumed bootable; ISO attach excluded from MVP      |
| Secure Boot config      | Default Gen2 settings; no custom secure boot configuration     |

---

## Configuration Schema

### Schema Outline

```yaml
# ragnatramp.yaml schema
project:                    # required
  name: string              # required, 1-32 chars, alphanumeric + hyphen

defaults:                   # optional, applies to all machines
  cpu: integer              # optional, default: 2
  memory: integer           # optional, MB, default: 2048
  base_image: string        # required if not per-machine, path to golden VHDX
  disk_strategy: string     # optional, "differencing" (default) or "copy"

machines:                   # required, array of 1-3 items
  - name: string            # required, unique within project, 1-16 chars
    cpu: integer            # optional, overrides default
    memory: integer         # optional, overrides default
    base_image: string      # optional, overrides default

settings:                   # optional
  artifact_path: string     # optional, default: ~/.ragnatramp/vms/{project}
  auto_start: boolean       # optional, default: true (start VMs after create)
```

### Example: 2 VMs

```yaml
project:
  name: myapp

defaults:
  cpu: 2
  memory: 2048
  base_image: "C:/HyperV/Golden/ubuntu-22.04-base.vhdx"

machines:
  - name: web
    memory: 4096
  - name: db
    cpu: 4
    memory: 8192
```

**Resulting VMs**:
- `myapp-web-a1b2c3d4` (2 CPU, 4096 MB)
- `myapp-db-a1b2c3d4` (4 CPU, 8192 MB)

### Example: 3 VMs

```yaml
project:
  name: microservices

defaults:
  cpu: 2
  memory: 2048
  base_image: "D:/Images/debian-12-minimal.vhdx"
  disk_strategy: differencing

machines:
  - name: api
    cpu: 4
    memory: 4096
  - name: worker
    memory: 4096
  - name: cache
    memory: 1024

settings:
  artifact_path: "D:/VMs/microservices"
  auto_start: true
```

**Resulting VMs**:
- `microservices-api-f5e6d7c8` (4 CPU, 4096 MB)
- `microservices-worker-f5e6d7c8` (2 CPU, 4096 MB)
- `microservices-cache-f5e6d7c8` (2 CPU, 1024 MB)

---

## Design Decisions

### Differencing Disk as Default

**Decision**: Use differencing disks (not full copies) by default.

**Rationale**:
1. **Speed**: Creating a differencing disk is nearly instant vs copying 20+ GB VHDXs.
2. **Storage**: Multiple VMs share one base image; only changes consume additional space.
3. **Safety**: Golden image is read-only; cannot be corrupted by VM operations.
4. **Enterprise AV**: Differencing disks are standard Hyper-V practice; AV tools handle them well.

**Trade-off**: If golden image is moved/deleted, differencing disks become invalid. User must manage base image lifecycle.

### VM Naming Convention

**Decision**: `{project}-{machine}-{hash8}` where hash8 is first 8 chars of SHA256 of config file absolute path.

**Rationale**:
1. **Deterministic**: Same config always produces same names.
2. **Collision-resistant**: Hash prevents conflicts between projects with same machine names.
3. **Readable**: Project and machine names visible for human identification.
4. **Traceable**: Hash allows reverse-lookup to config file.

### State File Location

**Decision**: `.ragnatramp/state.json` in same directory as YAML config file.

**Rationale**:
1. **Locality**: State travels with project (can be version-controlled or excluded).
2. **Multi-project**: Each project has independent state; no global registry.
3. **Debuggable**: JSON is human-readable; users can inspect/backup state.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: User can create a 2-VM environment from YAML in under 60 seconds (excluding VHDX copy time if using copy strategy).
- **SC-002**: Running `up` twice on unchanged config completes in under 5 seconds with no side effects (idempotent).
- **SC-003**: `validate` command completes in under 1 second for valid configurations.
- **SC-004**: `destroy` never removes VMs not tracked in state file (0 unmanaged deletions).
- **SC-005**: All error messages include actionable guidance (user knows what to fix).
- **SC-006**: 100% of MVP commands work without administrator elevation (user-space only).
- **SC-007**: User can manage 3 VMs simultaneously with no performance degradation in CLI responsiveness.

---

## Clarifications

### Session 2026-01-19

- Q: Default VM artifact path for differencing disks? → A: `~/.ragnatramp/vms/{project}` (user profile, portable across machines)

**Confirmed Design Decisions** (from spec defaults, no changes needed):
- Golden image strategy: Differencing disk (default) - fast, space-efficient, preserves base
- VM Generation: Gen2 only (UEFI) - modern standard, secure boot enabled by default
- ISO/DVD attach: Excluded from MVP - base image assumed bootable
- `up` auto-start: `auto_start: true` by default, configurable via `settings.auto_start`
- Managed VM identification: Triple verification (state file + Hyper-V Notes + deterministic naming)
- YAML file: Any `.yaml` file path, required fields: `project.name`, `machines[]`, `defaults.base_image` or per-machine `base_image`

---

## Assumptions

1. User has Windows 11 Pro with Hyper-V feature enabled.
2. User is member of local "Hyper-V Administrators" group.
3. Hyper-V "Default Switch" exists (created by default with Hyper-V).
4. Golden VHDX images are pre-built and accessible at specified paths.
5. Node.js (v18+) is installed via nvm for the current user.
6. Sufficient disk space exists at artifact path for differencing disks.
7. Enterprise AV/security software does not block PowerShell cmdlet execution.
