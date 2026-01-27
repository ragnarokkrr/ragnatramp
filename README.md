# Ragna Tramp

**Vagrant-like VM orchestration for Hyper-V on Windows 11 Pro**

Ragna Tramp is a confined-environment, user-space CLI that emulates the core of Vagrant multi-machine orchestration for Hyper-V. Designed for enterprise environments where users have "Hyper-V Administrators" group membership but limited system access.

## Features

- **Multi-VM orchestration** from a single YAML configuration file
- **No admin elevation required** - runs entirely in user-space
- **Differencing disks** - fast VM creation using golden images
- **Safe by design** - triple verification before any destructive operation
- **Idempotent operations** - run commands multiple times safely
- **JSON output** - automation-friendly with `--json` flag

## Prerequisites

- **Windows 11 Pro** with Hyper-V enabled
- **Hyper-V Administrators** group membership
- **Node.js 20+** (nvm recommended)
- **Golden VHDX image** - a pre-built, bootable VM disk (see [Base Image Requirements](#base-image-requirements))

## Installation

```bash
# Install globally
npm install -g ragnatramp

# Or locally in your project
npm install ragnatramp
npx ragnatramp --version
```

## Quick Start

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

### 2. Validate and preview

```bash
# Check configuration is valid
ragnatramp validate ragnatramp.yaml

# Preview what will happen
ragnatramp plan ragnatramp.yaml
```

### 3. Create and start VMs

```bash
ragnatramp up ragnatramp.yaml
```

### 4. Check status

```bash
ragnatramp status ragnatramp.yaml
```

Output:
```
Project: myproject

  NAME                      STATE     CPU  MEMORY
  myproject-web-a1b2c3d4    Running   2    4096 MB
  myproject-db-a1b2c3d4     Running   4    8192 MB
```

## Commands

| Command | Description |
|---------|-------------|
| `validate <file>` | Validate YAML configuration against schema |
| `plan <file>` | Preview actions without making changes |
| `up <file>` | Create and start VMs from configuration |
| `status <file>` | Show current state of managed VMs |
| `halt <file> [machine]` | Stop VMs gracefully |
| `destroy <file> [machine]` | Remove VMs and their disks |
| `checkpoint <file> --name <n>` | Create named checkpoint for all VMs |
| `restore <file> --name <n>` | Restore all VMs to named checkpoint |

All commands support `--json` for machine-readable output.

## Configuration Schema

```yaml
project:
  name: string              # Required, 1-32 chars

defaults:
  cpu: integer              # Default: 2
  memory: integer           # Default: 2048 (MB)
  base_image: string        # Path to golden VHDX
  disk_strategy: string     # "differencing" (default) or "copy"

machines:                   # 1-3 machines
  - name: string            # Unique within project
    cpu: integer            # Override default
    memory: integer         # Override default
    base_image: string      # Override default

settings:
  artifact_path: string     # Default: ~/.ragnatramp/vms/{project}
  auto_start: boolean       # Default: true
```

## How It Works

1. **Configuration** - Define your VMs in a YAML file
2. **Validation** - Schema validation catches errors before execution
3. **Planning** - Compute diff between desired and actual state
4. **Execution** - Apply changes via PowerShell Hyper-V cmdlets
5. **State Tracking** - Persist created resources in `.ragnatramp/state.json`

### Safety Features

- **Triple verification** before destructive operations:
  - VM tracked in state file
  - VM Notes contain Ragna Tramp marker
  - VM name matches deterministic pattern
- **Atomic state writes** prevent corruption
- **Never touches unmanaged VMs**

### VM Naming

VMs are named using the pattern `{project}-{machine}-{hash8}` where the hash is derived from the config file path, ensuring deterministic and collision-resistant names.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | User/configuration error |
| 2 | Hyper-V/system error |

## Documentation

- [Quickstart Guide](./docs/quickstart.md) - Get started quickly
- [Configuration Reference](./docs/config-reference.md) - All YAML options
- [Command Reference](./docs/commands.md) - Detailed command documentation

## Development

```bash
# Clone the repository
git clone https://github.com/your-username/ragnatramp.git
cd ragnatramp

# Install dependencies
npm install

# Build
npm run build

# Run in development
npm run dev -- validate ragnatramp.yaml

# Run tests
npm test

# Lint
npm run lint
```

## Base Image Requirements

Ragna Tramp creates **Generation 1** Hyper-V VMs for maximum compatibility with various disk images. Your golden VHDX must be:

- **Bootable with BIOS** - Gen1 VMs use legacy BIOS boot, not UEFI
- **MBR or GPT partitioned** - Both work with Gen1 VMs
- **IDE-compatible boot** - Gen1 VMs boot from IDE controllers

Most Linux distributions and Windows images work out of the box. If you have a Gen2-only image (UEFI-only boot), you'll need to convert it or use a different base image.

### Creating a Golden Image

1. Create a new Gen1 VM in Hyper-V Manager
2. Install your OS and configure it as desired
3. Generalize the image (e.g., `sysprep` for Windows, `cloud-init` for Linux)
4. Copy the VHDX to your golden images location
5. Reference it in your `ragnatramp.yaml` as `base_image`

## Troubleshooting

### "Hyper-V not available"

Enable Hyper-V:
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

The Default Switch should exist by default with Hyper-V. Verify in Hyper-V Manager or Virtual Switch Manager.

### VM boots to black screen or "Boot device not found"

Your base image may not be compatible with Generation 1 VMs. Common causes:
- **UEFI-only image** - The image was created for Gen2 VMs (UEFI boot only)
- **GPT without legacy boot** - Some GPT-partitioned disks don't have a BIOS boot partition
- **Corrupted bootloader** - The MBR or bootloader is damaged

**Solution**: Create a new golden image using a Gen1 VM in Hyper-V Manager, or use a known Gen1-compatible image.

## License

MIT

## Contributing

Contributions are welcome! Please read the contributing guidelines before submitting a pull request.

---

*Ragna Tramp - Because sometimes you just need VMs without the hassle.*
