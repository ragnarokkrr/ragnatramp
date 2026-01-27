/**
 * Hyper-V Types
 *
 * Type definitions for Hyper-V VM operations and PowerShell responses.
 */

/**
 * VM state values returned by Hyper-V
 */
export type HyperVVMState =
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
 * VM information returned from Get-VM
 */
export interface HyperVVM {
  /** VM GUID */
  Id: string;
  /** VM display name */
  Name: string;
  /** Current state: Running, Off, Saved, Paused, etc. */
  State: HyperVVMState;
  /** VM Notes field (contains ragnatramp marker) */
  Notes: string | null;
  /** Memory in MB */
  MemoryMB: number;
  /** Virtual CPU count */
  CPUCount: number;
}

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
  /** Parent VM name */
  VMName: string;
  /** Creation timestamp (ISO string from PowerShell) */
  CreationTime: string;
}

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
  /** Whether to auto-start VM after creation (default: true) */
  autoStart?: boolean;
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

/**
 * Result from VM creation
 */
export interface CreateVMResult {
  /** VM GUID */
  Id: string;
  /** VM name */
  Name: string;
}

/**
 * Result from checkpoint creation
 */
export interface CreateCheckpointResult {
  /** Checkpoint GUID */
  Id: string;
  /** Checkpoint name */
  Name: string;
  /** Parent VM GUID */
  VMId: string;
}
