# Configuration Reference

This document describes all configuration options available in `ragnatramp.yaml`.

## File Format

Ragna Tramp configuration files use YAML format. The file must have `.yaml` or `.yml` extension.

## Schema Overview

```yaml
project:          # Required - Project identification
  name: string

defaults:         # Optional - Default values for machines
  cpu: integer
  memory: integer
  base_image: string
  disk_strategy: string

machines:         # Required - List of VMs to create
  - name: string
    cpu: integer
    memory: integer
    base_image: string

settings:         # Optional - Global settings
  artifact_path: string
  auto_start: boolean
```

## Sections

### project (Required)

Project identification used in VM naming and state management.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Project name used in VM naming. Must start with a letter, contain only alphanumeric characters and hyphens. |

**Constraints:**
- Length: 1-32 characters
- Pattern: `^[a-zA-Z][a-zA-Z0-9-]{0,31}$`
- Must be unique within your Hyper-V environment

**Example:**
```yaml
project:
  name: myproject
```

### defaults (Optional)

Default values applied to all machines unless overridden at the machine level.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `cpu` | integer | 2 | Number of virtual CPUs |
| `memory` | integer | 2048 | Memory in megabytes |
| `base_image` | string | - | Path to the golden VHDX image |
| `disk_strategy` | string | "differencing" | How to create VM disks |

**cpu Constraints:**
- Minimum: 1
- Maximum: 64

**memory Constraints:**
- Minimum: 512 MB
- Maximum: 1048576 MB (1 TB)

**disk_strategy Values:**
- `differencing` - Creates a differencing disk using the base image as parent (fast, space-efficient)
- `copy` - Creates a full copy of the base image (slower, isolated)

**Example:**
```yaml
defaults:
  cpu: 2
  memory: 2048
  base_image: "C:/HyperV/Golden/ubuntu-22.04.vhdx"
  disk_strategy: differencing
```

### machines (Required)

Array of machine definitions. Each machine becomes a Hyper-V VM.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Machine name, unique within project |
| `cpu` | integer | No | Override default CPU count |
| `memory` | integer | No | Override default memory (MB) |
| `base_image` | string | Conditional | Override default base image path |

**name Constraints:**
- Length: 1-16 characters
- Pattern: `^[a-zA-Z][a-zA-Z0-9-]{0,15}$`
- Must be unique within the machines array

**Array Constraints:**
- Minimum items: 1
- Maximum items: 3 (MVP limitation)

**base_image Requirement:**
- If `defaults.base_image` is not specified, each machine MUST specify `base_image`
- If `defaults.base_image` is specified, machine-level `base_image` is optional

**Example:**
```yaml
machines:
  - name: web
    memory: 4096          # Override default memory

  - name: db
    cpu: 4                # Override default CPU
    memory: 8192
    base_image: "C:/HyperV/Golden/postgres-15.vhdx"  # Different base image

  - name: cache
                          # Uses all defaults
```

### settings (Optional)

Global settings that affect how Ragna Tramp operates.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `artifact_path` | string | `~/.ragnatramp/vms/{project}` | Directory for VM artifacts |
| `auto_start` | boolean | true | Start VMs after creation |

**artifact_path:**
- Supports `~` for home directory
- Supports environment variables: `%USERPROFILE%`, `$HOME`
- Relative paths resolved from config file location

**auto_start:**
- `true` - VMs start automatically after `up` creates them
- `false` - VMs are created but left in "Off" state

**Example:**
```yaml
settings:
  artifact_path: "D:/VMs/myproject"
  auto_start: false
```

## Path Expansion

Paths in configuration support several expansion methods:

| Pattern | Expansion |
|---------|-----------|
| `~` | User's home directory |
| `%VARNAME%` | Windows environment variable |
| `$VARNAME` | Unix-style environment variable |
| `./relative` | Resolved from config file directory |

**Examples:**
```yaml
defaults:
  base_image: "~/HyperV/Golden/ubuntu.vhdx"        # Expands ~ to home
  base_image: "%USERPROFILE%/HyperV/ubuntu.vhdx"  # Expands env var
  base_image: "./images/ubuntu.vhdx"               # Relative to config
```

## VM Naming

VMs are named using the pattern: `{project}-{machine}-{hash8}`

- `project` - From `project.name`
- `machine` - From `machines[].name`
- `hash8` - First 8 characters of SHA256 hash of config file path

This ensures:
- Deterministic names (same config always produces same names)
- Collision resistance (different config files produce different names)
- Identifiable origin (project and machine name visible)

**Example:**
```
myproject-web-a1b2c3d4
myproject-db-a1b2c3d4
```

## State File

Ragna Tramp tracks managed VMs in `.ragnatramp/state.json` relative to the config file.

```
project/
├── ragnatramp.yaml
└── .ragnatramp/
    └── state.json
```

The state file contains:
- VM IDs and names
- Disk paths
- Checkpoints
- Config hash for drift detection

## Complete Example

```yaml
# ragnatramp.yaml - Full configuration example

project:
  name: devstack

defaults:
  cpu: 2
  memory: 2048
  base_image: "C:/HyperV/Golden/ubuntu-22.04-base.vhdx"
  disk_strategy: differencing

machines:
  - name: web
    memory: 4096
    # Uses default CPU (2) and base_image

  - name: api
    cpu: 4
    memory: 4096
    # Uses default base_image

  - name: db
    cpu: 4
    memory: 8192
    base_image: "C:/HyperV/Golden/postgres-15.vhdx"
    # Different base image for database

settings:
  artifact_path: "D:/VMs/devstack"
  auto_start: true
```

## Validation Errors

Common validation error messages and fixes:

| Error | Cause | Fix |
|-------|-------|-----|
| `project.name: must match pattern` | Invalid characters in name | Use only letters, numbers, hyphens |
| `machines: must have at least 1 item` | Empty machines array | Add at least one machine |
| `machines: must have at most 3 items` | Too many machines | Reduce to 3 or fewer machines |
| `base_image must be specified` | No base_image anywhere | Add to defaults or all machines |
| `cpu: must be >= 1` | CPU count too low | Use at least 1 CPU |
| `memory: must be >= 512` | Memory too low | Use at least 512 MB |

## See Also

- [Quickstart Guide](./quickstart.md) - Get started quickly
- [Command Reference](./commands.md) - All CLI commands
