/**
 * State Types for Ragnatramp
 *
 * These types represent the persisted state file structure for tracking
 * managed VMs, disks, and checkpoints.
 */

/**
 * Root state file structure persisted as .ragnatramp/state.json
 */
export interface StateFile {
  /** Schema version for migrations */
  version: 1;
  /** SHA256 hash of config file content (first 8 chars) */
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
