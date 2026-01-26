# Quickstart: Ragna Tramp

Get a multi-VM development environment running in minutes.

## Prerequisites

1. **Windows 11 Pro** with Hyper-V enabled
2. **Hyper-V Administrators** group membership (check: `whoami /groups | findstr Hyper-V`)
3. **Node.js 20+** installed (via nvm recommended)
4. **Golden VHDX image** - a pre-built, bootable VM disk (Gen2/UEFI)

## Installation

```bash
# Install globally
npm install -g ragnatramp

# Or locally in your project
npm install ragnatramp
npx ragnatramp --version
```

## Create Your First Environment

### 1. Create a configuration file

Create `ragnatramp.yaml` in your project directory:

```yaml
project:
  name: myproject

defaults:
  cpu: 2
  memory: 2048
  base_image: "C:/HyperV/Golden/ubuntu-22.04.vhdx"

machines:
  - name: web
    memory: 4096
  - name: db
    cpu: 4
    memory: 8192
```

### 2. Validate the configuration

```bash
ragnatramp validate ragnatramp.yaml
```

Expected output:
```
✓ Configuration valid
  Project: myproject
  Machines: 2 (web, db)
  Base image: C:/HyperV/Golden/ubuntu-22.04.vhdx
```

### 3. Preview what will happen

```bash
ragnatramp plan ragnatramp.yaml
```

Expected output:
```
Plan: 2 VMs to create

  + myproject-web-a1b2c3d4
    CPU: 2, Memory: 4096 MB
    Disk: ~/.ragnatramp/vms/myproject/web.vhdx (differencing)

  + myproject-db-a1b2c3d4
    CPU: 4, Memory: 8192 MB
    Disk: ~/.ragnatramp/vms/myproject/db.vhdx (differencing)

Run `ragnatramp up ragnatramp.yaml` to apply.
```

### 4. Create and start the VMs

```bash
ragnatramp up ragnatramp.yaml
```

Expected output:
```
✓ Creating VM: myproject-web-a1b2c3d4
  ✓ VM created
  ✓ VM started

✓ Creating VM: myproject-db-a1b2c3d4
  ✓ VM created
  ✓ VM started

Done. 2 VMs running.
```

### 5. Check status

```bash
ragnatramp status ragnatramp.yaml
```

Expected output:
```
Project: myproject

  NAME                      STATE     CPU  MEMORY
  myproject-web-a1b2c3d4    Running   2    4096 MB
  myproject-db-a1b2c3d4     Running   4    8192 MB

2 VMs managed by this configuration.
```

## Common Operations

### Stop VMs

```bash
# Stop all managed VMs
ragnatramp halt ragnatramp.yaml --all

# Stop specific VM
ragnatramp halt ragnatramp.yaml web
```

### Destroy environment

```bash
# Remove all VMs and disks
ragnatramp destroy ragnatramp.yaml --all
```

### Create a checkpoint

```bash
# Save state before making changes
ragnatramp checkpoint ragnatramp.yaml --name baseline
```

### Restore from checkpoint

```bash
# Restore to saved state
ragnatramp restore ragnatramp.yaml --name baseline
```

## JSON Output

All commands support `--json` for automation:

```bash
ragnatramp status ragnatramp.yaml --json
```

```json
{
  "success": true,
  "command": "status",
  "vms": [
    {"name": "myproject-web-a1b2c3d4", "state": "Running", "cpu": 2, "memoryMB": 4096},
    {"name": "myproject-db-a1b2c3d4", "state": "Running", "cpu": 4, "memoryMB": 8192}
  ]
}
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | User/configuration error |
| 2 | Hyper-V/system error |

## Troubleshooting

### "Hyper-V not available"

Ensure Hyper-V is enabled:
```powershell
Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All
```

### "Permission denied"

Add yourself to Hyper-V Administrators:
```powershell
Add-LocalGroupMember -Group "Hyper-V Administrators" -Member $env:USERNAME
# Log out and back in for changes to take effect
```

### "Default Switch not found"

The Default Switch should exist by default. If missing, create it in Hyper-V Manager or:
```powershell
New-VMSwitch -Name "Default Switch" -SwitchType Internal
```

### "Base image not found"

Verify the path in your YAML configuration exists and is a valid Gen2 VHDX:
```powershell
Test-Path "C:/HyperV/Golden/ubuntu-22.04.vhdx"
```

## Next Steps

- Read the [Configuration Reference](./config-reference.md) for all YAML options
- Read the [Command Reference](./commands.md) for detailed command documentation
