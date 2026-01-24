/**
 * Action Planner for Ragnatramp
 *
 * Computes the set of actions needed to converge from current state
 * to desired state defined in the configuration.
 */

import { join } from 'node:path';

import type { ResolvedConfig, ResolvedMachine } from '../config/types.js';
import type { StateFile, VMState } from '../state/types.js';
import type { HyperVVM } from '../hyperv/types.js';
import type {
  Action,
  CreateActionDetails,
  StartActionDetails,
  StopActionDetails,
  DestroyActionDetails,
} from './types.js';
import { generateVMName, generateVMNotes } from './naming.js';

/**
 * Options for plan computation
 */
export interface PlanOptions {
  /** Whether to plan start actions for stopped VMs (default: true) */
  autoStart?: boolean;
  /** Only plan actions for specific machine names */
  filterMachines?: string[];
}

/**
 * Result of plan computation
 */
export interface PlanResult {
  /** Actions to execute */
  actions: Action[];
  /** Summary statistics */
  summary: {
    create: number;
    start: number;
    stop: number;
    destroy: number;
    unchanged: number;
  };
}

/**
 * Compute the plan to converge current state to desired configuration.
 *
 * This function compares:
 * - Desired state (from config)
 * - Current persisted state (from state file)
 * - Actual state (from Hyper-V)
 *
 * And produces a list of actions to bring actual state in line with desired.
 *
 * @param config - Resolved configuration
 * @param state - Current state file (null if no state exists)
 * @param actualVMs - Current VMs from Hyper-V
 * @param options - Planning options
 * @returns Plan result with actions and summary
 */
export function computePlan(
  config: ResolvedConfig,
  state: StateFile | null,
  actualVMs: HyperVVM[],
  options: PlanOptions = {}
): PlanResult {
  const { autoStart = config.autoStart, filterMachines } = options;

  // Index actual VMs by name for quick lookup
  const actualVMsByName = new Map<string, HyperVVM>();
  for (const vm of actualVMs) {
    actualVMsByName.set(vm.Name, vm);
  }

  const actions: Action[] = [];
  const summary = {
    create: 0,
    start: 0,
    stop: 0,
    destroy: 0,
    unchanged: 0,
  };

  // Process each machine in the configuration
  for (const machine of config.machines) {
    // Skip if filtering and not in filter list
    if (filterMachines && !filterMachines.includes(machine.name)) {
      continue;
    }

    const vmName = generateVMName(
      config.project.name,
      machine.name,
      config.configPath
    );

    const stateEntry = state?.vms[machine.name] ?? null;
    const actualVM = actualVMsByName.get(vmName) ?? null;

    const action = computeMachineAction(
      config,
      machine,
      vmName,
      stateEntry,
      actualVM,
      autoStart
    );

    if (action) {
      actions.push(action);
      summary[action.type as keyof typeof summary]++;
    } else {
      summary.unchanged++;
    }
  }

  return { actions, summary };
}

/**
 * Compute the action needed for a single machine.
 *
 * @param config - Resolved configuration
 * @param machine - Machine configuration
 * @param vmName - Expected VM name
 * @param stateEntry - State entry for this machine (if exists)
 * @param actualVM - Actual VM from Hyper-V (if exists)
 * @param autoStart - Whether to auto-start VMs
 * @returns Action to take, or null if no action needed
 */
function computeMachineAction(
  config: ResolvedConfig,
  machine: ResolvedMachine,
  vmName: string,
  stateEntry: VMState | null,
  actualVM: HyperVVM | null,
  autoStart: boolean
): Action | null {
  // Case 1: VM doesn't exist anywhere - create it
  if (!stateEntry && !actualVM) {
    return createCreateAction(config, machine, vmName);
  }

  // Case 2: VM in state but not in Hyper-V - orphaned state, recreate
  if (stateEntry && !actualVM) {
    // The state references a VM that no longer exists
    // We'll create a new one (the state will be updated after creation)
    return createCreateAction(config, machine, vmName);
  }

  // Case 3: VM exists in Hyper-V but not in state - this is unexpected
  // We don't touch VMs we don't own (could be manually created or from another config)
  if (!stateEntry && actualVM) {
    // This shouldn't happen if naming is correct, but if it does, don't touch it
    return null;
  }

  // Case 4: VM exists in both state and Hyper-V - check if we need to start it
  if (stateEntry && actualVM) {
    // If auto-start is enabled and VM is not running, plan a start action
    if (autoStart && actualVM.State === 'Off') {
      return createStartAction(machine, vmName, actualVM.Id);
    }

    // VM is already in desired state
    return null;
  }

  return null;
}

/**
 * Create a create action for a machine.
 */
function createCreateAction(
  config: ResolvedConfig,
  machine: ResolvedMachine,
  vmName: string
): Action {
  const diskPath = join(config.artifactPath, `${machine.name}.vhdx`);
  const notes = generateVMNotes(config.configPath);

  const details: CreateActionDetails = {
    type: 'create',
    cpu: machine.cpu,
    memoryMB: machine.memory,
    baseImage: machine.baseImage,
    diskPath,
    differencing: machine.diskStrategy === 'differencing',
    notes,
  };

  return {
    type: 'create',
    machineName: machine.name,
    vmName,
    details,
  };
}

/**
 * Create a start action for a machine.
 */
function createStartAction(
  machine: ResolvedMachine,
  vmName: string,
  vmId: string
): Action {
  const details: StartActionDetails = {
    type: 'start',
    vmId,
  };

  return {
    type: 'start',
    machineName: machine.name,
    vmName,
    details,
  };
}

/**
 * Compute halt plan - plan to stop VMs.
 *
 * @param config - Resolved configuration
 * @param state - Current state file
 * @param actualVMs - Current VMs from Hyper-V
 * @param options - Planning options
 * @returns Plan result with stop actions
 */
export function computeHaltPlan(
  config: ResolvedConfig,
  state: StateFile | null,
  actualVMs: HyperVVM[],
  options: PlanOptions & { force?: boolean } = {}
): PlanResult {
  const { filterMachines, force = false } = options;

  // Index actual VMs by name for quick lookup
  const actualVMsByName = new Map<string, HyperVVM>();
  for (const vm of actualVMs) {
    actualVMsByName.set(vm.Name, vm);
  }

  const actions: Action[] = [];
  const summary = {
    create: 0,
    start: 0,
    stop: 0,
    destroy: 0,
    unchanged: 0,
  };

  // Process each machine in the configuration
  for (const machine of config.machines) {
    // Skip if filtering and not in filter list
    if (filterMachines && !filterMachines.includes(machine.name)) {
      continue;
    }

    const vmName = generateVMName(
      config.project.name,
      machine.name,
      config.configPath
    );

    const stateEntry = state?.vms[machine.name] ?? null;
    const actualVM = actualVMsByName.get(vmName) ?? null;

    // Only stop if VM exists and is running
    if (stateEntry && actualVM && actualVM.State === 'Running') {
      const details: StopActionDetails = {
        type: 'stop',
        vmId: actualVM.Id,
        force,
      };

      actions.push({
        type: 'stop',
        machineName: machine.name,
        vmName,
        details,
      });
      summary.stop++;
    } else {
      summary.unchanged++;
    }
  }

  return { actions, summary };
}

/**
 * Compute destroy plan - plan to remove VMs.
 *
 * @param config - Resolved configuration
 * @param state - Current state file
 * @param actualVMs - Current VMs from Hyper-V
 * @param options - Planning options
 * @returns Plan result with destroy actions
 */
export function computeDestroyPlan(
  config: ResolvedConfig,
  state: StateFile | null,
  actualVMs: HyperVVM[],
  options: PlanOptions = {}
): PlanResult {
  const { filterMachines } = options;

  // Index actual VMs by name for quick lookup
  const actualVMsByName = new Map<string, HyperVVM>();
  for (const vm of actualVMs) {
    actualVMsByName.set(vm.Name, vm);
  }

  const actions: Action[] = [];
  const summary = {
    create: 0,
    start: 0,
    stop: 0,
    destroy: 0,
    unchanged: 0,
  };

  // Process each machine in the state (not config, since we're destroying)
  // We need state to know what VMs we've created
  if (!state) {
    return { actions, summary };
  }

  for (const [machineName, vmState] of Object.entries(state.vms)) {
    // Skip if filtering and not in filter list
    if (filterMachines && !filterMachines.includes(machineName)) {
      continue;
    }

    const actualVM = actualVMsByName.get(vmState.name) ?? null;

    // Only destroy if VM exists
    if (actualVM) {
      const details: DestroyActionDetails = {
        type: 'destroy',
        vmId: actualVM.Id,
        diskPath: vmState.diskPath,
      };

      actions.push({
        type: 'destroy',
        machineName,
        vmName: vmState.name,
        details,
      });
      summary.destroy++;
    } else {
      // VM doesn't exist but is in state - will be cleaned up from state
      summary.unchanged++;
    }
  }

  return { actions, summary };
}

/**
 * Check if plan has any actions.
 */
export function hasActions(plan: PlanResult): boolean {
  return plan.actions.length > 0;
}

/**
 * Get a human-readable summary of the plan.
 */
export function formatPlanSummary(plan: PlanResult): string {
  const parts: string[] = [];

  if (plan.summary.create > 0) {
    parts.push(`${plan.summary.create} to create`);
  }
  if (plan.summary.start > 0) {
    parts.push(`${plan.summary.start} to start`);
  }
  if (plan.summary.stop > 0) {
    parts.push(`${plan.summary.stop} to stop`);
  }
  if (plan.summary.destroy > 0) {
    parts.push(`${plan.summary.destroy} to destroy`);
  }

  if (parts.length === 0) {
    return 'No changes needed';
  }

  return parts.join(', ');
}
