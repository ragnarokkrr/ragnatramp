<!--
Sync Impact Report
==================
Version change: (new) → 1.0.0
Added principles:
  - I. User-Space Only
  - II. Safety First
  - III. Idempotent Operations
  - IV. Deterministic Naming & Tagging
  - V. Declarative YAML Only
  - VI. Audit-Friendly Output
  - VII. Predictable Failures
  - VIII. Explicit State Management
Added sections:
  - Non-Goals (MVP)
  - Quality Bar
  - Governance
Templates status:
  - .specify/templates/plan-template.md ✅ (no changes needed - Constitution Check section already generic)
  - .specify/templates/spec-template.md ✅ (no changes needed - generic user story format)
  - .specify/templates/tasks-template.md ✅ (no changes needed - generic task format)
Follow-up TODOs: None
-->

# Ragna Tramp Constitution

## Core Principles

### I. User-Space Only (NON-NEGOTIABLE)

Ragna Tramp MUST run entirely in user space without requiring administrator elevation.

- MUST NOT install services, drivers, or kernel-mode components
- MUST NOT trigger UAC prompts or require "Run as Administrator"
- User MUST already be a member of the local "Hyper-V Administrators" group; Ragna Tramp MUST NOT request additional privileges
- All VM operations MUST use PowerShell cmdlets that succeed under Hyper-V Administrators membership

**Rationale**: Enterprise laptops have restricted access. Requiring elevation would make the tool unusable in the target environment.

### II. Safety First (NON-NEGOTIABLE)

Ragna Tramp MUST NEVER destroy, modify, or interfere with resources it did not create.

- MUST track all created VMs, disks, and checkpoints in local state
- MUST verify ownership via deterministic naming and tags before any destructive operation
- `destroy` command MUST refuse to remove VMs not in state file, even if names match
- MUST fail safe: if ownership cannot be verified, abort with clear error

**Rationale**: In shared or enterprise environments, accidentally destroying unmanaged VMs would be catastrophic.

### III. Idempotent Operations

All commands MUST be idempotent: running them multiple times produces the same end state.

- `up` MUST converge to the declared state; repeated runs MUST NOT create duplicates
- `destroy` MUST be safe to run repeatedly; destroying already-destroyed VMs is a no-op (exit 0)
- `halt` on already-stopped VMs MUST succeed silently
- Operations MUST compare desired state vs actual state before acting

**Rationale**: Users expect declarative tools to be safe to re-run. Idempotency prevents "it worked the first time" failures.

### IV. Deterministic Naming & Tagging

All managed resources MUST have predictable, collision-resistant names and identification tags.

- VM names MUST follow pattern: `{project}-{machine}-{hash}` where hash derives from config file path
- MUST apply Hyper-V notes/tags containing Ragna Tramp version and config file path
- Disk files MUST use consistent naming under the configured artifacts directory
- Naming scheme MUST allow multiple Ragna Tramp projects to coexist without collision

**Rationale**: Deterministic naming enables ownership verification and prevents collisions across projects.

### V. Declarative YAML Only (NON-NEGOTIABLE)

Configuration is pure declarative YAML with no embedded scripting.

- MUST NOT support embedded PowerShell, shell commands, or inline scripts in YAML
- MUST NOT support "provisioners" or post-boot script execution in MVP
- All configuration MUST be static key-value declarations validated against a strict JSON Schema
- YAML MUST be human-readable and auditable without executing it

**Rationale**: Scripting in config files creates security risks and unpredictable behavior. Declarative configs are auditable and reproducible.

### VI. Audit-Friendly Output

All operations MUST produce clear, structured, and auditable output.

- Human-readable output by default; `--json` flag for machine-parseable output
- MUST log: command, parameters, actions taken, results, and any errors
- Error messages MUST include the failing PowerShell cmdlet, parameters, and stderr
- `plan` command MUST show all intended actions without executing them
- MUST use consistent exit codes: 0 = success, 1 = user error, 2 = system/Hyper-V error

**Rationale**: Enterprise environments require audit trails. Clear output enables debugging and compliance.

### VII. Predictable Failures

Errors MUST be actionable and informative.

- MUST validate YAML against schema before any Hyper-V operations
- MUST pre-flight check: verify base VHDX exists, Default Switch exists, sufficient disk space
- MUST fail fast with specific error messages, not generic "operation failed"
- MUST NOT leave partial state on failure; implement rollback or atomic operations where feasible
- Error messages MUST suggest corrective action when possible

**Rationale**: Users should never guess why something failed. Predictable failures reduce support burden.

### VIII. Explicit State Management

All state MUST be stored in `.ragnatramp/` directory, never in registry or hidden system locations.

- State file (`.ragnatramp/state.json`) MUST track: VMs created, disk paths, checkpoints, config hash
- State file MUST be human-readable JSON
- MUST detect drift: if YAML changes, `plan` shows what will change and `up` converges
- MUST handle state file corruption gracefully (warn, offer recovery options)
- MUST NOT rely on Hyper-V as source of truth; state file is authoritative for ownership

**Rationale**: Explicit state enables debugging, backup, and prevents "magic" behavior. Registry-based state is fragile and opaque.

## Non-Goals (MVP)

The following are explicitly OUT OF SCOPE for MVP to prevent scope creep:

- **Synced folders**: No shared folder mounting between host and guest
- **Port forwarding DSL**: No declarative port mapping in YAML (users can configure manually in guest)
- **Custom switches**: MUST use "Default Switch" only; no virtual switch creation/modification
- **Provisioning scripts**: No shell/PowerShell execution on guests; no Ansible/Chef/Puppet integration
- **Plugin system**: No extensibility API or third-party plugins
- **Multi-platform**: Windows 11 Pro with Hyper-V only; no VMware/VirtualBox/WSL2
- **More than 3 VMs**: MVP targets 2–3 machine orchestration
- **GUI**: CLI only; no graphical interface
- **Remote Hyper-V**: Local Hyper-V management only; no remote host support
- **Nested virtualization**: Not required for MVP

**Rationale**: MVP must ship. Each non-goal can be revisited post-MVP based on user feedback.

## Quality Bar

### Testing Requirements

- Unit tests MUST cover: YAML parsing, schema validation, state file operations, naming generation
- Integration tests MAY mock PowerShell/Hyper-V calls initially
- All tests MUST pass before merge to main branch

### CI-Ready Structure

- Repository MUST support: `npm run lint`, `npm run test`, `npm run build`
- ESLint for TypeScript code quality
- Build MUST produce distributable CLI binary/package

### Documentation Requirements

- `README.md`: Project overview and quickstart
- `docs/config-reference.md`: Complete YAML schema documentation
- `docs/commands.md`: All CLI commands with examples and exit codes

### Dependency Policy

- Minimal runtime dependencies; prefer Node.js built-ins
- TypeScript for type safety
- YAML parsing: established library (e.g., js-yaml) with schema validation (e.g., ajv)
- MUST NOT require native compilation or platform-specific binaries beyond Node.js

## Governance

- This constitution supersedes ad-hoc decisions; amendments require documented rationale
- All code changes MUST verify compliance with Safety First and User-Space Only principles
- Complexity additions MUST be justified against Non-Goals; default answer is "not in MVP"
- Version changes follow semantic versioning: MAJOR (breaking), MINOR (features), PATCH (fixes)

**Version**: 1.0.0 | **Ratified**: 2026-01-19 | **Last Amended**: 2026-01-19
