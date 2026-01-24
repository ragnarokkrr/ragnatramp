/**
 * Core Types for Ragnatramp
 *
 * Types for action planning, reconciliation, and ownership verification.
 */

/**
 * Types of actions the planner can emit
 */
export type ActionType =
  | 'create'     // Create new VM
  | 'start'      // Start existing VM
  | 'stop'       // Stop running VM
  | 'destroy'    // Remove VM and disk
  | 'checkpoint' // Create checkpoint
  | 'restore';   // Restore from checkpoint

/**
 * Planned action to be executed
 */
export interface Action {
  /** Type of action to perform */
  type: ActionType;
  /** Machine name from config */
  machineName: string;
  /** Full VM name ({project}-{machine}-{hash8}) */
  vmName: string;
  /** Action-specific details */
  details: ActionDetails;
}

/**
 * Union type for all action details
 */
export type ActionDetails =
  | CreateActionDetails
  | StartActionDetails
  | StopActionDetails
  | DestroyActionDetails
  | CheckpointActionDetails
  | RestoreActionDetails;

/**
 * Details for create VM action
 */
export interface CreateActionDetails {
  type: 'create';
  /** Number of virtual CPUs */
  cpu: number;
  /** Memory in MB */
  memoryMB: number;
  /** Path to parent/golden VHDX */
  baseImage: string;
  /** Path for differencing/copied disk */
  diskPath: string;
  /** Whether to use differencing disk */
  differencing: boolean;
  /** VM Notes content */
  notes: string;
}

/**
 * Details for start VM action
 */
export interface StartActionDetails {
  type: 'start';
  /** VM GUID */
  vmId: string;
}

/**
 * Details for stop VM action
 */
export interface StopActionDetails {
  type: 'stop';
  /** VM GUID */
  vmId: string;
  /** Whether to force stop */
  force: boolean;
}

/**
 * Details for destroy VM action
 */
export interface DestroyActionDetails {
  type: 'destroy';
  /** VM GUID */
  vmId: string;
  /** Path to differencing disk to delete */
  diskPath: string;
}

/**
 * Details for checkpoint action
 */
export interface CheckpointActionDetails {
  type: 'checkpoint';
  /** VM GUID */
  vmId: string;
  /** Checkpoint name */
  checkpointName: string;
}

/**
 * Details for restore action
 */
export interface RestoreActionDetails {
  type: 'restore';
  /** VM GUID */
  vmId: string;
  /** Checkpoint GUID */
  checkpointId: string;
  /** Checkpoint name */
  checkpointName: string;
}

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

/**
 * Result of a preflight check
 */
export interface PreflightResult {
  /** Whether the check passed */
  passed: boolean;
  /** Error message if failed */
  message?: string;
  /** Suggested fix if failed */
  suggestion?: string;
}

/**
 * Aggregate result of all preflight checks
 */
export interface PreflightCheckResults {
  /** Whether all checks passed */
  allPassed: boolean;
  /** Individual check results */
  hyperVAvailable: PreflightResult;
  defaultSwitchExists: PreflightResult;
  baseImagesExist: PreflightResult & { missing?: string[] };
}
