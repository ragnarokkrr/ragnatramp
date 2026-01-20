# Data Model: Ragna Tramp MVP

**Feature**: 001-hyperv-vm-orchestration
**Date**: 2026-01-19

## Configuration Types

### RagnatrampConfig (YAML input)

```typescript
// src/config/types.ts

/**
 * Root configuration object parsed from ragnatramp.yaml
 */
export interface RagnatrampConfig {
  project: ProjectConfig;
  defaults?: DefaultsConfig;
  machines: MachineConfig[];
  settings?: SettingsConfig;
}

/**
 * Project identification
 */
export interface ProjectConfig {
  /** Project name, used in VM naming. 1-32 chars, alphanumeric + hyphen */
  name: string;
}

/**
 * Default values applied to all machines unless overridden
 */
export interface DefaultsConfig {
  /** Number of virtual CPUs. Default: 2 */
  cpu?: number;
  /** Memory in MB. Default: 2048 */
  memory?: number;
  /** Path to golden VHDX image */
  base_image?: string;
  /** Disk creation strategy: "differencing" (default) or "copy" */
  disk_strategy?: 'differencing' | 'copy';
}

/**
 * Individual machine definition
 */
export interface MachineConfig {
  /** Machine name, unique within project. 1-16 chars, alphanumeric + hyphen */
  name: string;
  /** Override default CPU count */
  cpu?: number;
  /** Override default memory (MB) */
  memory?: number;
  /** Override default base image path */
  base_image?: string;
}

/**
 * Optional global settings
 */
export interface SettingsConfig {
  /** Path for VM artifacts. Default: ~/.ragnatramp/vms/{project} */
  artifact_path?: string;
  /** Start VMs after creation. Default: true */
  auto_start?: boolean;
}
```

### Resolved Machine Configuration

```typescript
// src/config/types.ts

/**
 * Machine config with all defaults applied
 */
export interface ResolvedMachine {
  name: string;
  cpu: number;
  memory: number;
  baseImage: string;
  diskStrategy: 'differencing' | 'copy';
}

/**
 * Fully resolved configuration ready for execution
 */
export interface ResolvedConfig {
  project: {
    name: string;
  };
  machines: ResolvedMachine[];
  artifactPath: string;
  autoStart: boolean;
  configPath: string;  // Absolute path to YAML file
  configHash: string;  // SHA256 of YAML content
}
```

---

## State Types

### StateFile (persisted JSON)

```typescript
// src/state/types.ts

/**
 * Root state file structure
 */
export interface StateFile {
  /** Schema version for migrations */
  version: 1;
  /** SHA256 hash of config file content */
  configHash: string;
  /** Absolute path to YAML config file */
  configPath: string;
  /** Project name from config */
  project: string;
  /** ISO timestamp of first creation */
  createdAt: string;
  /** ISO timestamp of last modification */
  updatedAt: string;
  /** Managed VMs, keyed by machine name from config */
  vms: Record<string, VMState>;
}

/**
 * State of a managed VM
 */
export interface VMState {
  /** Hyper-V VM GUID */
  id: string;
  /** Full VM name: {project}-{machine}-{hash8} */
  name: string;
  /** Machine name from config (key reference) */
  machineName: string;
  /** Absolute path to differencing/copied VHDX */
  diskPath: string;
  /** ISO timestamp of VM creation */
  createdAt: string;
  /** Checkpoints created for this VM */
  checkpoints: CheckpointState[];
}

/**
 * State of a VM checkpoint
 */
export interface CheckpointState {
  /** Hyper-V checkpoint GUID */
  id: string;
  /** User-provided checkpoint name */
  name: string;
  /** ISO timestamp of checkpoint creation */
  createdAt: string;
}
```

---

## Hyper-V Types

### Query Results

```typescript
// src/hyperv/types.ts

/**
 * VM information returned from Get-VM
 */
export interface HyperVVM {
  /** VM GUID */
  Id: string;
  /** VM display name */
  Name: string;
  /** Current state: Running, Off, Saved, Paused, etc. */
  State: VMState;
  /** VM Notes field (contains ragnatramp marker) */
  Notes: string | null;
  /** Memory in MB */
  MemoryMB: number;
  /** Virtual CPU count */
  CPUCount: number;
}

export type VMState =
  | 'Running'
  | 'Off'
  | 'Saved'
  | 'Paused'
  | 'Starting'
  | 'Stopping'
  | 'Saving'
  | 'Resuming'
  | 'Reset'
  | 'Other';

/**
 * Checkpoint information returned from Get-VMSnapshot
 */
export interface HyperVCheckpoint {
  /** Checkpoint GUID */
  Id: string;
  /** Checkpoint name */
  Name: string;
  /** Parent VM GUID */
  VMId: string;
  /** Creation timestamp */
  CreationTime: string;
}
```

### Command Parameters

```typescript
// src/hyperv/types.ts

/**
 * Parameters for creating a new VM
 */
export interface CreateVMParams {
  /** Full VM name */
  name: string;
  /** Virtual CPU count */
  cpu: number;
  /** Memory in MB */
  memoryMB: number;
  /** Path to parent/golden VHDX */
  baseImage: string;
  /** Path for differencing/copied disk */
  diskPath: string;
  /** VM Notes content */
  notes: string;
  /** Whether to use differencing disk */
  differencing: boolean;
}

/**
 * Parameters for creating a checkpoint
 */
export interface CreateCheckpointParams {
  /** VM GUID or name */
  vmId: string;
  /** Checkpoint name */
  name: string;
}
```

---

## Core Types

### Action Planning

```typescript
// src/core/planner.ts

/**
 * Types of actions the planner can emit
 */
export type ActionType =
  | 'create'   // Create new VM
  | 'start'    // Start existing VM
  | 'stop'     // Stop running VM
  | 'destroy'  // Remove VM and disk
  | 'checkpoint' // Create checkpoint
  | 'restore'; // Restore from checkpoint

/**
 * Planned action to be executed
 */
export interface Action {
  type: ActionType;
  /** Machine name from config */
  machineName: string;
  /** Full VM name (for display) */
  vmName: string;
  /** Action-specific details */
  details: ActionDetails;
}

export type ActionDetails =
  | CreateActionDetails
  | StartActionDetails
  | StopActionDetails
  | DestroyActionDetails
  | CheckpointActionDetails
  | RestoreActionDetails;

export interface CreateActionDetails {
  cpu: number;
  memoryMB: number;
  baseImage: string;
  diskPath: string;
  differencing: boolean;
}

export interface StartActionDetails {
  vmId: string;
}

export interface StopActionDetails {
  vmId: string;
  force: boolean;
}

export interface DestroyActionDetails {
  vmId: string;
  diskPath: string;
}

export interface CheckpointActionDetails {
  vmId: string;
  checkpointName: string;
}

export interface RestoreActionDetails {
  vmId: string;
  checkpointId: string;
  checkpointName: string;
}
```

### Ownership Verification

```typescript
// src/core/preflight.ts

/**
 * Result of ownership verification
 */
export interface OwnershipResult {
  /** Whether the VM is confirmed owned by this ragnatramp instance */
  owned: boolean;
  /** Reason if not owned */
  reason?: string;
  /** Verification checks performed */
  checks: {
    inStateFile: boolean;
    hasMarkerInNotes: boolean;
    nameMatchesPattern: boolean;
  };
}
```

---

## Error Types

```typescript
// src/core/errors.ts

/**
 * Base error class for ragnatramp errors
 */
export class RagnatrampError extends Error {
  constructor(
    message: string,
    public code: ErrorCode,
    public suggestion?: string
  ) {
    super(message);
    this.name = 'RagnatrampError';
  }
}

export type ErrorCode =
  | 'CONFIG_NOT_FOUND'
  | 'CONFIG_INVALID_YAML'
  | 'CONFIG_VALIDATION_FAILED'
  | 'BASE_IMAGE_NOT_FOUND'
  | 'DEFAULT_SWITCH_NOT_FOUND'
  | 'HYPERV_NOT_AVAILABLE'
  | 'PERMISSION_DENIED'
  | 'VM_NOT_FOUND'
  | 'CHECKPOINT_NOT_FOUND'
  | 'STATE_CORRUPTED'
  | 'OWNERSHIP_VERIFICATION_FAILED'
  | 'HYPERV_ERROR';

/**
 * Hyper-V specific error
 */
export class HyperVError extends RagnatrampError {
  constructor(
    public exitCode: number,
    public stderr: string,
    public script: string
  ) {
    super(`Hyper-V operation failed: ${stderr}`, 'HYPERV_ERROR');
  }
}
```

---

## CLI Output Types

```typescript
// src/cli/output.ts

/**
 * Standard output format for --json mode
 */
export interface CommandResult {
  success: boolean;
  command: string;
  actions?: ActionResult[];
  error?: ErrorOutput;
  summary?: Record<string, number>;
}

export interface ActionResult {
  type: ActionType;
  vm: string;
  status: 'completed' | 'failed' | 'skipped';
  error?: string;
}

export interface ErrorOutput {
  code: ErrorCode;
  message: string;
  suggestion?: string;
  details?: Record<string, unknown>;
}
```

---

## State Transitions

### VM Lifecycle

```
[Not Exists]
    │
    ▼ create
[Off] ◄────────┐
    │          │
    ▼ start    │ stop
[Running] ─────┘
    │
    ▼ destroy
[Not Exists]
```

### State File Lifecycle

```
[No State File]
    │
    ▼ first `up`
[State File Exists]
    │
    ├── `up` (VM added) → update vms{}
    ├── `destroy` (VM removed) → remove from vms{}
    ├── `checkpoint` → add to vm.checkpoints[]
    └── `restore` → no state change
    │
    ▼ `destroy --all` (all VMs removed)
[State File Deleted]
```
