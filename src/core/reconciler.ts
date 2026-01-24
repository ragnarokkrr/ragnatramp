/**
 * Action Reconciler for Ragnatramp
 *
 * Executes planned actions to converge actual state to desired state.
 * Updates persisted state after each successful action.
 */

import { unlink } from 'node:fs/promises';

import type { HyperVExecutor } from '../hyperv/executor.js';
import type { StateManager } from '../state/manager.js';
import type { VMState, CheckpointState } from '../state/types.js';
import type { CreateVMResult, CreateCheckpointResult } from '../hyperv/types.js';
import type {
  Action,
  CreateActionDetails,
  StartActionDetails,
  StopActionDetails,
  DestroyActionDetails,
  CheckpointActionDetails,
  RestoreActionDetails,
} from './types.js';
import {
  buildCreateVMScript,
  buildStartVMScript,
  buildGracefulStopVMScript,
  buildRemoveVMScript,
  buildCheckpointVMScript,
  buildRestoreVMSnapshotScript,
  buildDeleteFileScript,
} from '../hyperv/commands.js';

/**
 * Result of a single action execution
 */
export interface ActionResult {
  /** The action that was executed */
  action: Action;
  /** Whether the action succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Result of executing all actions
 */
export interface ReconcileResult {
  /** Whether all actions succeeded */
  success: boolean;
  /** Results of each action */
  results: ActionResult[];
  /** Summary statistics */
  summary: {
    succeeded: number;
    failed: number;
  };
}

/**
 * Callback for reporting action progress
 */
export type ActionProgressCallback = (
  action: Action,
  status: 'starting' | 'completed' | 'failed',
  error?: string
) => void;

/**
 * Options for reconciliation
 */
export interface ReconcileOptions {
  /** Callback for progress reporting */
  onProgress?: ActionProgressCallback;
  /** Whether to stop on first failure (default: true) */
  stopOnFailure?: boolean;
  /** Timeout for graceful shutdown in seconds (default: 30) */
  shutdownTimeout?: number;
}

/**
 * Execute planned actions to converge to desired state.
 *
 * Actions are executed sequentially in order. State is updated
 * after each successful action.
 *
 * @param actions - Actions to execute
 * @param executor - HyperVExecutor instance
 * @param stateManager - StateManager instance
 * @param options - Reconciliation options
 * @returns Reconciliation result
 */
export async function executeActions(
  actions: Action[],
  executor: HyperVExecutor,
  stateManager: StateManager,
  options: ReconcileOptions = {}
): Promise<ReconcileResult> {
  const { onProgress, stopOnFailure = true } = options;

  const results: ActionResult[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const action of actions) {
    onProgress?.(action, 'starting');

    try {
      await executeAction(action, executor, stateManager, options);
      results.push({ action, success: true });
      succeeded++;
      onProgress?.(action, 'completed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.push({ action, success: false, error: errorMessage });
      failed++;
      onProgress?.(action, 'failed', errorMessage);

      if (stopOnFailure) {
        break;
      }
    }
  }

  return {
    success: failed === 0,
    results,
    summary: { succeeded, failed },
  };
}

/**
 * Execute a single action.
 *
 * @param action - Action to execute
 * @param executor - HyperVExecutor instance
 * @param stateManager - StateManager instance
 * @param options - Reconciliation options
 */
async function executeAction(
  action: Action,
  executor: HyperVExecutor,
  stateManager: StateManager,
  options: ReconcileOptions
): Promise<void> {
  switch (action.type) {
    case 'create':
      await executeCreateAction(action, executor, stateManager);
      break;
    case 'start':
      await executeStartAction(action, executor);
      break;
    case 'stop':
      await executeStopAction(action, executor, options);
      break;
    case 'destroy':
      await executeDestroyAction(action, executor, stateManager);
      break;
    case 'checkpoint':
      await executeCheckpointAction(action, executor, stateManager);
      break;
    case 'restore':
      await executeRestoreAction(action, executor);
      break;
  }
}

/**
 * Execute a create VM action.
 */
async function executeCreateAction(
  action: Action,
  executor: HyperVExecutor,
  stateManager: StateManager
): Promise<void> {
  const details = action.details as CreateActionDetails;

  const script = buildCreateVMScript({
    name: action.vmName,
    cpu: details.cpu,
    memoryMB: details.memoryMB,
    baseImage: details.baseImage,
    diskPath: details.diskPath,
    notes: details.notes,
    differencing: details.differencing,
  });

  const result = await executor.execute<CreateVMResult>(script);

  // Update state with new VM
  const vmState: VMState = {
    id: result.Id,
    name: result.Name,
    machineName: action.machineName,
    diskPath: details.diskPath,
    createdAt: new Date().toISOString(),
    checkpoints: [],
  };

  stateManager.addVM(action.machineName, vmState);
  await stateManager.save();
}

/**
 * Execute a start VM action.
 */
async function executeStartAction(
  action: Action,
  executor: HyperVExecutor
): Promise<void> {
  const details = action.details as StartActionDetails;
  const script = buildStartVMScript(details.vmId);
  await executor.executeVoid(script);
}

/**
 * Execute a stop VM action.
 */
async function executeStopAction(
  action: Action,
  executor: HyperVExecutor,
  options: ReconcileOptions
): Promise<void> {
  const details = action.details as StopActionDetails;
  const { shutdownTimeout = 30 } = options;

  // Use graceful shutdown with fallback
  const script = buildGracefulStopVMScript(details.vmId, shutdownTimeout);
  await executor.executeVoid(script);
}

/**
 * Execute a destroy VM action.
 *
 * Removes the VM and deletes the differencing disk.
 */
async function executeDestroyAction(
  action: Action,
  executor: HyperVExecutor,
  stateManager: StateManager
): Promise<void> {
  const details = action.details as DestroyActionDetails;

  // Remove VM (stops it first if running)
  const removeScript = buildRemoveVMScript(details.vmId);
  await executor.executeVoid(removeScript);

  // Delete the differencing disk
  try {
    const deleteScript = buildDeleteFileScript(details.diskPath);
    await executor.executeVoid(deleteScript);
  } catch {
    // Disk deletion failure is not fatal - it might not exist
    // or be locked by another process. Log and continue.
  }

  // Remove from state
  stateManager.removeVM(action.machineName);
  await stateManager.save();
}

/**
 * Execute a checkpoint action.
 */
async function executeCheckpointAction(
  action: Action,
  executor: HyperVExecutor,
  stateManager: StateManager
): Promise<void> {
  const details = action.details as CheckpointActionDetails;

  const script = buildCheckpointVMScript({
    vmId: details.vmId,
    name: details.checkpointName,
  });

  const result = await executor.execute<CreateCheckpointResult>(script);

  // Update state with new checkpoint
  const checkpointState: CheckpointState = {
    id: result.Id,
    name: result.Name,
    createdAt: new Date().toISOString(),
  };

  stateManager.addCheckpoint(action.machineName, checkpointState);
  await stateManager.save();
}

/**
 * Execute a restore action.
 */
async function executeRestoreAction(
  action: Action,
  executor: HyperVExecutor
): Promise<void> {
  const details = action.details as RestoreActionDetails;
  const script = buildRestoreVMSnapshotScript(details.vmId, details.checkpointId);
  await executor.executeVoid(script);
}

/**
 * Execute a single action in dry-run mode (no actual execution).
 *
 * Useful for previewing what would happen.
 *
 * @param action - Action to preview
 * @returns Description of what would happen
 */
export function describeAction(action: Action): string {
  switch (action.type) {
    case 'create': {
      const details = action.details as CreateActionDetails;
      return `Create VM: ${action.vmName}\n  CPU: ${details.cpu}, Memory: ${details.memoryMB} MB\n  Disk: ${details.diskPath} (${details.differencing ? 'differencing' : 'copy'})`;
    }
    case 'start': {
      return `Start VM: ${action.vmName}`;
    }
    case 'stop': {
      const details = action.details as StopActionDetails;
      return `Stop VM: ${action.vmName}${details.force ? ' (force)' : ''}`;
    }
    case 'destroy': {
      const details = action.details as DestroyActionDetails;
      return `Destroy VM: ${action.vmName}\n  Delete disk: ${details.diskPath}`;
    }
    case 'checkpoint': {
      const details = action.details as CheckpointActionDetails;
      return `Checkpoint VM: ${action.vmName}\n  Name: ${details.checkpointName}`;
    }
    case 'restore': {
      const details = action.details as RestoreActionDetails;
      return `Restore VM: ${action.vmName}\n  Checkpoint: ${details.checkpointName}`;
    }
  }
}

/**
 * Get the action symbol for display.
 */
export function getActionSymbol(action: Action): string {
  switch (action.type) {
    case 'create':
      return '+';
    case 'start':
      return '▶';
    case 'stop':
      return '⏹';
    case 'destroy':
      return '-';
    case 'checkpoint':
      return '📸';
    case 'restore':
      return '↩';
  }
}
