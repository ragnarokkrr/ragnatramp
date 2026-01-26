# Command Reference

Complete reference for all Ragna Tramp CLI commands.

## Global Options

All commands support these options:

| Option | Description |
|--------|-------------|
| `--json` | Output results as JSON for automation |
| `--version` | Show version number |
| `--help` | Show help for command |

## Commands

### validate

Validate a YAML configuration file against the schema.

```bash
ragnatramp validate <file> [options]
```

**Arguments:**
- `<file>` - Path to the configuration file (required)

**Options:**
- `--json` - Output as JSON

**Behavior:**
- Parses YAML syntax
- Validates against JSON Schema
- Checks required fields and types
- Reports all errors (not just first)
- Does NOT check if base_image file exists
- Does NOT require Hyper-V

**Exit Codes:**
- 0 - Configuration is valid
- 1 - Configuration is invalid (syntax or schema errors)

**Example:**
```bash
$ ragnatramp validate ragnatramp.yaml
✓ Configuration valid
  Project: myproject
  Machines: 2 (web, db)
  Base image: C:/HyperV/Golden/ubuntu-22.04.vhdx

$ ragnatramp validate invalid.yaml
✗ Configuration invalid

  - machines[0].cpu: must be integer
  - project.name: must match pattern ^[a-zA-Z][a-zA-Z0-9-]{0,31}$
```

**JSON Output:**
```json
{
  "success": true,
  "command": "validate",
  "summary": { "machines": 2 }
}
```

---

### plan

Preview what actions would be taken without making changes.

```bash
ragnatramp plan <file> [options]
```

**Arguments:**
- `<file>` - Path to the configuration file (required)

**Options:**
- `--json` - Output as JSON

**Behavior:**
- Loads and validates configuration
- Reads existing state file (if any)
- Queries current VMs from Hyper-V
- Computes required actions
- Displays actions without executing
- Makes NO changes to Hyper-V

**Exit Codes:**
- 0 - Success (even if changes needed)
- 1 - Configuration error
- 2 - Hyper-V error

**Example:**
```bash
$ ragnatramp plan ragnatramp.yaml
Plan: 2 VMs to create

  + myproject-web-a1b2c3d4
    CPU: 2, Memory: 4096 MB
    Disk: ~/.ragnatramp/vms/myproject/web.vhdx (differencing)

  + myproject-db-a1b2c3d4
    CPU: 4, Memory: 8192 MB
    Disk: ~/.ragnatramp/vms/myproject/db.vhdx (differencing)

Run `ragnatramp up ragnatramp.yaml` to apply.

$ ragnatramp plan ragnatramp.yaml
No changes needed. All VMs are in sync.
```

---

### up

Create and start VMs to match the configuration.

```bash
ragnatramp up <file> [options]
```

**Arguments:**
- `<file>` - Path to the configuration file (required)

**Options:**
- `--json` - Output as JSON

**Behavior:**
- Loads and validates configuration
- Runs preflight checks (Hyper-V, Default Switch, base image)
- Computes required actions
- Creates missing VMs with differencing disks
- Starts stopped VMs (if `auto_start: true`)
- Updates state file
- Idempotent - safe to run multiple times

**Exit Codes:**
- 0 - Success
- 1 - Configuration or user error
- 2 - Hyper-V or system error

**Example:**
```bash
$ ragnatramp up ragnatramp.yaml
✓ Configuration validated
✓ Preflight checks passed

✓ Creating VM: myproject-web-a1b2c3d4
  CPU: 2, Memory: 4096 MB
  Disk: C:/Users/user/.ragnatramp/vms/myproject/web.vhdx (differencing)
  ✓ VM created
  ✓ VM started

✓ Creating VM: myproject-db-a1b2c3d4
  CPU: 4, Memory: 8192 MB
  Disk: C:/Users/user/.ragnatramp/vms/myproject/db.vhdx (differencing)
  ✓ VM created
  ✓ VM started

Done. 2 VMs running.
```

---

### status

Show the current state of managed VMs.

```bash
ragnatramp status <file> [options]
```

**Arguments:**
- `<file>` - Path to the configuration file (required)

**Options:**
- `--json` - Output as JSON

**Behavior:**
- Reads state file
- Queries current VM states from Hyper-V
- Shows table with VM details
- Shows "Missing" for VMs in state but not in Hyper-V

**Exit Codes:**
- 0 - Success
- 1 - No state file exists
- 2 - Hyper-V error

**Example:**
```bash
$ ragnatramp status ragnatramp.yaml
Project: myproject

  NAME                      STATE     CPU  MEMORY
  myproject-web-a1b2c3d4    Running   2    4096 MB
  myproject-db-a1b2c3d4     Off       4    8192 MB

2 VMs managed by this configuration.
```

**JSON Output:**
```json
{
  "success": true,
  "command": "status",
  "vms": [
    {"name": "myproject-web-a1b2c3d4", "state": "Running", "cpu": 2, "memoryMB": 4096},
    {"name": "myproject-db-a1b2c3d4", "state": "Off", "cpu": 4, "memoryMB": 8192}
  ]
}
```

---

### halt

Stop managed VMs gracefully.

```bash
ragnatramp halt <file> [machine] [options]
```

**Arguments:**
- `<file>` - Path to the configuration file (required)
- `[machine]` - Specific machine name to stop (optional)

**Options:**
- `--all` - Stop all managed VMs
- `--json` - Output as JSON

**Behavior:**
- Requires either `[machine]` or `--all`
- Attempts graceful shutdown first
- Forces shutdown after 30 second timeout
- Skips already-stopped VMs (idempotent)

**Exit Codes:**
- 0 - Success
- 1 - Machine not found or configuration error
- 2 - Hyper-V error

**Example:**
```bash
# Stop specific machine
$ ragnatramp halt ragnatramp.yaml web
⏹ Stopping VM: myproject-web-a1b2c3d4
  ✓ VM stopped

Done. 1 stopped.

# Stop all machines
$ ragnatramp halt ragnatramp.yaml --all
⏹ Stopping VM: myproject-web-a1b2c3d4
  ✓ VM stopped
⏹ Stopping VM: myproject-db-a1b2c3d4
  ✓ VM stopped

Done. 2 stopped.
```

---

### destroy

Remove managed VMs and their disks.

```bash
ragnatramp destroy <file> [machine] [options]
```

**Arguments:**
- `<file>` - Path to the configuration file (required)
- `[machine]` - Specific machine name to destroy (optional)

**Options:**
- `--all` - Destroy all managed VMs
- `--json` - Output as JSON

**Behavior:**
- Requires either `[machine]` or `--all`
- Verifies ownership before deletion (triple check):
  1. VM is in state file
  2. VM Notes contain Ragna Tramp marker
  3. VM name matches expected pattern
- Stops VM if running
- Removes VM from Hyper-V
- Deletes differencing disk
- Updates/removes state file
- NEVER deletes unmanaged VMs

**Exit Codes:**
- 0 - Success
- 1 - Machine not found, ownership verification failed, or configuration error
- 2 - Hyper-V error

**Example:**
```bash
# Destroy specific machine
$ ragnatramp destroy ragnatramp.yaml web
Verifying ownership...
✓ web: ownership verified

- Destroying VM: myproject-web-a1b2c3d4
  ✓ VM destroyed

Done. 1 destroyed.

# Destroy all machines
$ ragnatramp destroy ragnatramp.yaml --all
Verifying ownership...
✓ web: ownership verified
✓ db: ownership verified

- Destroying VM: myproject-web-a1b2c3d4
  ✓ VM destroyed
- Destroying VM: myproject-db-a1b2c3d4
  ✓ VM destroyed

Done. 2 destroyed.
```

---

### checkpoint

Create a named checkpoint for all managed VMs.

```bash
ragnatramp checkpoint <file> --name <name> [options]
```

**Arguments:**
- `<file>` - Path to the configuration file (required)

**Options:**
- `--name <name>` - Checkpoint name (required)
- `--json` - Output as JSON

**Behavior:**
- Creates a Hyper-V snapshot for each managed VM
- Uses the same name for all VMs' checkpoints
- Tracks checkpoints in state file
- Fails if checkpoint name already exists

**Exit Codes:**
- 0 - Success
- 1 - Checkpoint already exists or configuration error
- 2 - Hyper-V error

**Example:**
```bash
$ ragnatramp checkpoint ragnatramp.yaml --name before-upgrade
Creating checkpoint 'before-upgrade' for 2 VM(s)...
  Creating checkpoint for myproject-web-a1b2c3d4...
✓ web: checkpoint created
  Creating checkpoint for myproject-db-a1b2c3d4...
✓ db: checkpoint created

✓ Checkpoint 'before-upgrade' created for 2 VM(s).
```

---

### restore

Restore all managed VMs to a named checkpoint.

```bash
ragnatramp restore <file> --name <name> [options]
```

**Arguments:**
- `<file>` - Path to the configuration file (required)

**Options:**
- `--name <name>` - Checkpoint name to restore (required)
- `--json` - Output as JSON

**Behavior:**
- Validates checkpoint exists for ALL VMs
- Stops running VMs before restore
- Restores each VM to the named snapshot
- VMs remain off after restore (run `up` to start)

**Exit Codes:**
- 0 - Success
- 1 - Checkpoint not found or configuration error
- 2 - Hyper-V error

**Example:**
```bash
$ ragnatramp restore ragnatramp.yaml --name before-upgrade
Restoring 2 VM(s) to checkpoint 'before-upgrade'...
⚠ Note: VMs will be stopped during restore.
  Restoring myproject-web-a1b2c3d4...
✓ web: restored to checkpoint 'before-upgrade'
  Restoring myproject-db-a1b2c3d4...
✓ db: restored to checkpoint 'before-upgrade'

✓ Restored 2 VM(s) to checkpoint 'before-upgrade'.
VMs are now in "Off" state. Run `ragnatramp up` to start them.
```

---

## Exit Codes Summary

| Code | Meaning | Examples |
|------|---------|----------|
| 0 | Success | Command completed successfully |
| 1 | User/configuration error | Invalid YAML, missing machine name, checkpoint not found |
| 2 | System/Hyper-V error | Hyper-V unavailable, permission denied, VM operation failed |

## JSON Output Format

All commands with `--json` return a consistent format:

```json
{
  "success": boolean,
  "command": string,
  "actions": [
    {
      "type": "create|start|stop|destroy|checkpoint|restore",
      "vm": "vm-name",
      "status": "completed|failed|skipped",
      "error": "error message if failed"
    }
  ],
  "vms": [
    {
      "name": "vm-name",
      "state": "Running|Off|Missing",
      "cpu": number,
      "memoryMB": number
    }
  ],
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "suggestion": "How to fix"
  },
  "summary": {
    "created": number,
    "started": number,
    "stopped": number,
    "destroyed": number,
    "checkpointed": number,
    "restored": number
  }
}
```

## See Also

- [Quickstart Guide](./quickstart.md) - Get started quickly
- [Configuration Reference](./config-reference.md) - All YAML options
