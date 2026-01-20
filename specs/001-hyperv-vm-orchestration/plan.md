# Implementation Plan: Ragna Tramp MVP - Hyper-V VM Orchestration

**Branch**: `001-hyperv-vm-orchestration` | **Date**: 2026-01-19 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-hyperv-vm-orchestration/spec.md`

## Summary

Build a user-space CLI tool (`ragnatramp`) that orchestrates Hyper-V VMs on Windows 11 Pro via declarative YAML configuration. The tool spawns `powershell.exe` to execute Hyper-V cmdlets, parses JSON output, and maintains local state to ensure idempotent, safe operations. MVP supports 2-3 VMs with differencing disks linked to pre-built golden images.

---

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20+ (ES modules)
**Primary Dependencies**:
- `commander` - CLI framework with subcommands
- `js-yaml` - YAML parsing
- `ajv` - JSON Schema validation with detailed errors
- Node.js built-ins: `child_process`, `crypto`, `fs/promises`, `path`, `os`

**Storage**: Local JSON files (`.ragnatramp/state.json`)
**Testing**: Node.js built-in test runner (`node --test`) + `tsx` for TypeScript
**Target Platform**: Windows 11 Pro with Hyper-V enabled
**Project Type**: Single CLI application
**Performance Goals**:
- `validate` < 1 second
- `up` (idempotent, no changes) < 5 seconds
- `up` (create 2 VMs) < 60 seconds (excluding disk copy)

**Constraints**:
- User-space only (no UAC elevation)
- Must work with Hyper-V Administrators group membership
- No native compilation (pure Node.js)

**Scale/Scope**: 2-3 VMs per project, single local Hyper-V host

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Implementation |
|-----------|--------|----------------|
| I. User-Space Only | ✅ PASS | Spawn `powershell.exe` without elevation; no services/drivers |
| II. Safety First | ✅ PASS | Triple verification before destroy: state file + VM Notes + naming pattern |
| III. Idempotent Operations | ✅ PASS | Compare desired vs actual state; converge without side effects |
| IV. Deterministic Naming | ✅ PASS | `{project}-{machine}-{hash8}` with SHA256 of config path |
| V. Declarative YAML Only | ✅ PASS | Pure data YAML; no scripting support; strict JSON Schema |
| VI. Audit-Friendly Output | ✅ PASS | Human default + `--json`; structured logging; exit codes 0/1/2 |
| VII. Predictable Failures | ✅ PASS | Pre-flight checks; schema validation first; actionable errors |
| VIII. Explicit State Management | ✅ PASS | `.ragnatramp/state.json` tracks all created resources |

**Non-Goals Compliance**: No synced folders, port forwarding, custom switches, provisioning scripts, plugins, GUI, remote hosts. ✅

---

## Project Structure

### Documentation (this feature)

```text
specs/001-hyperv-vm-orchestration/
├── plan.md              # This file
├── research.md          # Technology decisions and rationale
├── data-model.md        # TypeScript interfaces and state schema
├── quickstart.md        # Getting started guide
└── contracts/
    └── config-schema.json   # JSON Schema for ragnatramp.yaml
```

### Source Code (repository root)

```text
src/
├── cli/
│   ├── index.ts         # CLI entry point, command registration
│   ├── commands/
│   │   ├── validate.ts  # validate command handler
│   │   ├── plan.ts      # plan command handler
│   │   ├── up.ts        # up command handler
│   │   ├── status.ts    # status command handler
│   │   ├── halt.ts      # halt command handler
│   │   ├── destroy.ts   # destroy command handler
│   │   ├── checkpoint.ts # checkpoint command handler
│   │   └── restore.ts   # restore command handler
│   └── output.ts        # Human/JSON output formatting
│
├── config/
│   ├── loader.ts        # YAML loading and path resolution
│   ├── validator.ts     # JSON Schema validation with ajv
│   ├── schema.ts        # Embedded JSON Schema (or load from file)
│   └── types.ts         # Config type definitions
│
├── state/
│   ├── manager.ts       # State file CRUD operations
│   ├── types.ts         # State interface definitions
│   └── migrations.ts    # State file version migrations (future)
│
├── hyperv/
│   ├── executor.ts      # PowerShell spawning and JSON parsing
│   ├── commands.ts      # Hyper-V cmdlet builders
│   ├── types.ts         # VM, Snapshot type definitions
│   └── queries.ts       # Get-VM, Get-VMSnapshot queries
│
├── core/
│   ├── planner.ts       # Drift detection, action planning
│   ├── reconciler.ts    # Execute planned actions (converge)
│   ├── naming.ts        # VM name generation (hash)
│   ├── preflight.ts     # Pre-execution validation checks
│   └── errors.ts        # Custom error classes with codes
│
└── lib/
    ├── hash.ts          # SHA256 utilities
    ├── paths.ts         # Path expansion (~/, env vars)
    └── logger.ts        # Structured logging

tests/
├── unit/
│   ├── config/          # Config parsing, validation tests
│   ├── state/           # State management tests
│   ├── core/            # Planner, naming tests
│   └── hyperv/          # Command builder tests (no execution)
│
├── integration/
│   └── mock-powershell/ # Tests with mocked PS executor
│
└── fixtures/
    ├── valid-configs/   # Valid YAML samples
    ├── invalid-configs/ # Invalid YAML samples for error testing
    └── mock-responses/  # Canned PowerShell JSON responses
```

**Structure Decision**: Single CLI project. All code in `src/` with layered architecture: `cli/` → `core/` → `hyperv/` + `config/` + `state/`. Tests mirror source structure.

---

## CLI Framework & Command Structure

### Framework: Commander.js

**Rationale**: Mature, TypeScript-friendly, supports subcommands, auto-generates help.

```typescript
// src/cli/index.ts
import { program } from 'commander';

program
  .name('ragnatramp')
  .description('Vagrant-like VM orchestration for Hyper-V')
  .version('0.1.0');

program
  .command('validate <file>')
  .description('Validate YAML configuration against schema')
  .option('--json', 'Output as JSON')
  .action(validateCommand);

program
  .command('plan <file>')
  .description('Show intended actions without executing')
  .option('--json', 'Output as JSON')
  .action(planCommand);

program
  .command('up <file>')
  .description('Create/start VMs to match configuration')
  .option('--json', 'Output as JSON')
  .action(upCommand);

// ... status, halt, destroy, checkpoint, restore
```

### Command Flow Pattern

```
User invokes command
  ↓
Load & validate YAML config (all commands)
  ↓
Load state file if exists
  ↓
[Command-specific logic]
  ↓
Format output (human or --json)
  ↓
Exit with code (0/1/2)
```

---

## YAML Parsing & Schema Validation

### Parsing: js-yaml

```typescript
// src/config/loader.ts
import yaml from 'js-yaml';
import { readFile } from 'fs/promises';

export async function loadConfig(filePath: string): Promise<unknown> {
  const content = await readFile(filePath, 'utf-8');
  return yaml.load(content);
}
```

### Validation: Ajv with Custom Errors

```typescript
// src/config/validator.ts
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { configSchema } from './schema.js';

const ajv = new Ajv({ allErrors: true, verbose: true });
addFormats(ajv);

const validate = ajv.compile(configSchema);

export function validateConfig(data: unknown): ValidationResult {
  const valid = validate(data);
  if (!valid) {
    return {
      valid: false,
      errors: validate.errors!.map(e => ({
        path: e.instancePath || '/',
        message: e.message!,
        params: e.params
      }))
    };
  }
  return { valid: true, config: data as RagnatrampConfig };
}
```

### Error Formatting

```
Configuration invalid:
  - /machines/0/name: must NOT have fewer than 1 characters
  - /defaults/cpu: must be integer
```

---

## State File Format & Lifecycle

### Location

`.ragnatramp/state.json` in same directory as YAML config file.

### Schema

```typescript
// src/state/types.ts
interface StateFile {
  version: 1;
  configHash: string;           // SHA256 of config file content
  configPath: string;           // Absolute path to YAML
  project: string;              // Project name from config
  createdAt: string;            // ISO timestamp
  updatedAt: string;            // ISO timestamp
  vms: Record<string, VMState>; // Keyed by machine name from config
}

interface VMState {
  id: string;                   // Hyper-V VM GUID
  name: string;                 // Full VM name ({project}-{machine}-{hash})
  machineName: string;          // Machine name from config
  diskPath: string;             // Path to differencing VHDX
  createdAt: string;
  checkpoints: CheckpointState[];
}

interface CheckpointState {
  id: string;                   // Checkpoint GUID
  name: string;                 // User-provided name
  createdAt: string;
}
```

### Lifecycle

1. **Create**: First `up` creates `.ragnatramp/` directory and `state.json`
2. **Read**: All commands load state to determine current managed resources
3. **Update**: After each VM create/destroy/checkpoint, state is atomically updated
4. **Atomic Write**: Write to `.state.json.tmp`, then rename to `state.json`
5. **Corruption Handling**: If JSON parse fails, warn user and offer recovery options

---

## Idempotency Strategy

### Plan Phase (Drift Detection)

```typescript
// src/core/planner.ts
interface Action {
  type: 'create' | 'start' | 'stop' | 'modify' | 'delete';
  vm: string;
  details: Record<string, unknown>;
}

export async function computePlan(
  config: RagnatrampConfig,
  state: StateFile | null,
  actualVMs: HyperVVM[]
): Promise<Action[]> {
  const actions: Action[] = [];

  for (const machine of config.machines) {
    const expectedName = generateVMName(config.project.name, machine.name, configPath);
    const stateEntry = state?.vms[machine.name];
    const actualVM = actualVMs.find(vm => vm.Name === expectedName);

    if (!stateEntry && !actualVM) {
      // VM doesn't exist - create it
      actions.push({ type: 'create', vm: machine.name, details: { ... } });
    } else if (stateEntry && !actualVM) {
      // State says exists but VM missing - recreate or warn
      actions.push({ type: 'create', vm: machine.name, details: { orphanedState: true } });
    } else if (actualVM && actualVM.State !== 'Running' && config.settings?.auto_start !== false) {
      // VM exists but not running - start it
      actions.push({ type: 'start', vm: machine.name, details: {} });
    }
    // Add modify detection for cpu/memory changes (future)
  }

  return actions;
}
```

### Up Phase (Convergence)

```typescript
// src/core/reconciler.ts
export async function executeActions(
  actions: Action[],
  executor: HyperVExecutor,
  state: StateManager
): Promise<void> {
  for (const action of actions) {
    switch (action.type) {
      case 'create':
        const vmId = await executor.createVM(action.details);
        await state.addVM(action.vm, vmId, action.details);
        if (action.details.autoStart) {
          await executor.startVM(vmId);
        }
        break;
      case 'start':
        await executor.startVM(action.details.vmId);
        break;
      // ... other actions
    }
  }
}
```

---

## Safety Strategy

### Triple Verification Before Destroy

1. **State File Check**: VM must be in `.ragnatramp/state.json`
2. **Hyper-V Notes Check**: VM Notes must contain ragnatramp marker + config path
3. **Name Pattern Check**: VM name must match `{project}-{machine}-{hash}` pattern

```typescript
// src/core/preflight.ts
export async function verifyOwnership(
  vmName: string,
  state: StateFile,
  actualVM: HyperVVM,
  configPath: string
): Promise<OwnershipResult> {
  // Check 1: In state file?
  const stateEntry = Object.values(state.vms).find(v => v.name === vmName);
  if (!stateEntry) {
    return { owned: false, reason: 'Not in state file' };
  }

  // Check 2: Notes contain marker?
  const expectedMarker = `ragnatramp:${configPath}`;
  if (!actualVM.Notes?.includes(expectedMarker)) {
    return { owned: false, reason: 'Missing ragnatramp marker in VM Notes' };
  }

  // Check 3: Name matches pattern?
  const expectedName = generateVMName(state.project, stateEntry.machineName, configPath);
  if (actualVM.Name !== expectedName) {
    return { owned: false, reason: 'Name does not match expected pattern' };
  }

  return { owned: true };
}
```

### Guardrails

- **Never delete without verification**: `destroy` aborts if any check fails
- **Warn on orphaned state**: If state references VM that doesn't exist, warn and clean state
- **Warn on unmanaged match**: If a VM matches naming pattern but isn't in state, warn (don't touch)

---

## PowerShell Invocation Strategy

### Executor

```typescript
// src/hyperv/executor.ts
import { spawn } from 'child_process';

export class HyperVExecutor {
  async execute<T>(script: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const ps = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        script
      ]);

      let stdout = '';
      let stderr = '';

      ps.stdout.on('data', (data) => { stdout += data; });
      ps.stderr.on('data', (data) => { stderr += data; });

      ps.on('close', (code) => {
        if (code !== 0) {
          reject(new HyperVError(code, stderr, script));
        }
        try {
          resolve(JSON.parse(stdout) as T);
        } catch {
          reject(new HyperVError(code, `Invalid JSON: ${stdout}`, script));
        }
      });
    });
  }
}
```

### Command Builders

```typescript
// src/hyperv/commands.ts
export function buildGetVMsCommand(): string {
  return `Get-VM | Select-Object Id, Name, State, Notes,
    @{N='MemoryMB';E={$_.MemoryStartup/1MB}},
    @{N='CPUCount';E={$_.ProcessorCount}} | ConvertTo-Json -Depth 3`;
}

export function buildCreateVMCommand(params: CreateVMParams): string {
  return `
    $vm = New-VM -Name '${params.name}' -Generation 2 -MemoryStartupBytes ${params.memoryMB}MB -NoVHD
    Set-VM -VM $vm -ProcessorCount ${params.cpu}
    $parentPath = '${params.baseImage}'
    $diffPath = '${params.diskPath}'
    New-VHD -Path $diffPath -ParentPath $parentPath -Differencing | Out-Null
    Add-VMHardDiskDrive -VM $vm -Path $diffPath
    Connect-VMNetworkAdapter -VM $vm -SwitchName 'Default Switch'
    Set-VM -VM $vm -Notes '${params.notes}'
    $vm | Select-Object Id, Name | ConvertTo-Json
  `.trim().replace(/\n\s+/g, '; ');
}
```

### Error Mapping

| PowerShell Exit Code | Ragnatramp Exit Code | Meaning |
|---------------------|---------------------|---------|
| 0 | 0 | Success |
| Non-zero + "Access denied" | 2 | Permissions issue |
| Non-zero + "not found" | 1 | User error (bad config) |
| Non-zero + other | 2 | System/Hyper-V error |

---

## Logging & Output

### Human-Readable (Default)

```
ragnatramp up myproject.yaml

✓ Loaded configuration: myproject.yaml
✓ Validated configuration
  Creating VM: myapp-web-a1b2c3d4
    CPU: 2, Memory: 4096 MB
    Disk: ~/.ragnatramp/vms/myapp/web.vhdx (differencing)
  ✓ VM created
  ✓ VM started
  Creating VM: myapp-db-a1b2c3d4
    CPU: 4, Memory: 8192 MB
    Disk: ~/.ragnatramp/vms/myapp/db.vhdx (differencing)
  ✓ VM created
  ✓ VM started

Done. 2 VMs running.
```

### JSON Mode (--json)

```json
{
  "success": true,
  "actions": [
    {"type": "create", "vm": "myapp-web-a1b2c3d4", "status": "completed"},
    {"type": "start", "vm": "myapp-web-a1b2c3d4", "status": "completed"},
    {"type": "create", "vm": "myapp-db-a1b2c3d4", "status": "completed"},
    {"type": "start", "vm": "myapp-db-a1b2c3d4", "status": "completed"}
  ],
  "summary": {"created": 2, "started": 2, "total": 2}
}
```

### Error Output

```
ragnatramp up myproject.yaml

✗ Error: Base image not found
  Path: C:/HyperV/Golden/ubuntu-22.04-base.vhdx

  Fix: Ensure the golden VHDX exists at the specified path.

Exit code: 1
```

---

## Testing Strategy

### Unit Tests (No Hyper-V Required)

```typescript
// tests/unit/config/validator.test.ts
import { test } from 'node:test';
import assert from 'node:assert';
import { validateConfig } from '../../../src/config/validator.js';

test('validates minimal valid config', () => {
  const config = {
    project: { name: 'test' },
    defaults: { base_image: 'C:/test.vhdx' },
    machines: [{ name: 'web' }]
  };
  const result = validateConfig(config);
  assert.strictEqual(result.valid, true);
});

test('rejects config without machines', () => {
  const config = { project: { name: 'test' } };
  const result = validateConfig(config);
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors?.some(e => e.path.includes('machines')));
});
```

### Integration Tests (Mocked PowerShell)

```typescript
// tests/integration/mock-powershell/up.test.ts
import { test, mock } from 'node:test';
import { HyperVExecutor } from '../../../src/hyperv/executor.js';

test('up creates VMs when none exist', async () => {
  const executor = new HyperVExecutor();

  // Mock Get-VM to return empty array
  mock.method(executor, 'execute', async (script: string) => {
    if (script.includes('Get-VM')) return [];
    if (script.includes('New-VM')) return { Id: 'guid-123', Name: 'test-web-abc12345' };
    return {};
  });

  // ... test up command with mocked executor
});
```

### Test Coverage Targets

- Config validation: 100% branch coverage
- State management: 100% branch coverage
- Naming/hashing: 100%
- Planner logic: 90%+
- Command builders: 100% (string building, no execution)

---

## Packaging

### package.json

```json
{
  "name": "ragnatramp",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "ragnatramp": "./dist/cli/index.js",
    "Ragnatramp": "./dist/cli/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli/index.ts",
    "test": "node --test --experimental-test-coverage tests/**/*.test.ts",
    "lint": "eslint src tests"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "js-yaml": "^4.1.0",
    "ajv": "^8.12.0",
    "ajv-formats": "^2.1.1"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/js-yaml": "^4.0.9",
    "typescript": "^5.4.0",
    "tsx": "^4.7.0",
    "eslint": "^9.0.0"
  }
}
```

### Installation

```bash
# From npm (future)
npm install -g ragnatramp

# Local development
npm install
npm run build
npm link  # Creates global symlink
```

### Binary Entry Point

```typescript
#!/usr/bin/env node
// src/cli/index.ts
import { program } from 'commander';
// ... register commands
program.parse();
```

---

## Complexity Tracking

No constitution violations. All design choices align with principles.

| Consideration | Decision | Rationale |
|--------------|----------|-----------|
| CLI framework | commander | Mature, well-documented, no native deps |
| Schema validation | ajv | Industry standard, excellent error messages |
| State format | JSON | Human-readable, easy to debug, no dependencies |
| PowerShell invocation | child_process.spawn | Node built-in, no native modules |

---

## Next Steps

1. Run `/speckit.tasks` to generate task list
2. Implement in priority order (P1 → P2 → P3 → P4)
3. Each phase delivers independently testable functionality
