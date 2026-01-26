/**
 * Status Command Handler
 *
 * Shows the status of managed VMs.
 * This is a read-only query that displays VM states from Hyper-V.
 *
 * This is User Story 4: Check Status.
 */

import { resolve } from 'node:path';

import { loadYamlFile, ConfigLoadError } from '../../config/loader.js';
import { validateConfig } from '../../config/validator.js';
import { resolveConfig } from '../../config/resolver.js';
import { HyperVExecutor } from '../../hyperv/executor.js';
import { getVMById } from '../../hyperv/queries.js';
import { StateManager } from '../../state/manager.js';
import { ConfigError, isRagnatrampError, getExitCode, PreflightError } from '../../core/errors.js';
import { createOutput, OutputFormatter } from '../output.js';
import type { HyperVVM } from '../../hyperv/types.js';
import type { VMState } from '../../state/types.js';

/**
 * Options for the status command
 */
export interface StatusCommandOptions {
  json?: boolean;
}

/**
 * VM status information for display
 */
interface VMStatusInfo {
  /** Machine name from config */
  machineName: string;
  /** Full VM name */
  vmName: string;
  /** Current state (Running, Off, Missing, etc.) */
  state: string;
  /** CPU count */
  cpu: number;
  /** Memory in MB */
  memoryMB: number;
  /** Whether the VM is missing from Hyper-V */
  missing: boolean;
}

/**
 * Execute the status command.
 *
 * This command:
 * 1. Loads and validates the YAML configuration
 * 2. Loads existing state
 * 3. Queries each VM from Hyper-V by ID
 * 4. Displays status table showing NAME, STATE, CPU, MEMORY
 *
 * IMPORTANT: This command makes NO modifications to Hyper-V or state.
 * It only performs read-only queries.
 *
 * @param file - Path to the configuration file
 * @param options - Command options
 */
export async function statusCommand(
  file: string,
  options: StatusCommandOptions
): Promise<void> {
  const output = createOutput('status', options);

  try {
    // Step 1: Load and validate configuration
    const configPath = resolve(file);
    output.info(`Loading configuration: ${file}`);

    const rawConfig = await loadYamlFile(configPath);
    const validationResult = validateConfig(rawConfig);

    if (!validationResult.valid) {
      output.validationError(validationResult.errors);
      output.flush();
      process.exit(1);
    }

    const config = await resolveConfig(validationResult.config, configPath);

    // Step 2: Load existing state
    const stateManager = new StateManager(configPath);

    if (!(await stateManager.exists())) {
      output.info(`No VMs have been created yet for project '${config.project.name}'.`);
      output.info(`Run \`ragnatramp up ${file}\` to create VMs.`);
      output.flush();
      process.exit(0);
    }

    const state = await stateManager.load();

    // Check if there are any VMs in state
    const vmEntries = Object.entries(state.vms);
    if (vmEntries.length === 0) {
      output.info(`No VMs managed for project '${config.project.name}'.`);
      output.info(`Run \`ragnatramp up ${file}\` to create VMs.`);
      output.flush();
      process.exit(0);
    }

    // Step 3: Query each VM from Hyper-V
    const executor = new HyperVExecutor();
    const vmStatuses: VMStatusInfo[] = [];
    let hyperVAvailable = true;

    for (const [machineName, vmState] of vmEntries) {
      const statusInfo = await getVMStatus(
        executor,
        machineName,
        vmState,
        () => { hyperVAvailable = false; }
      );
      vmStatuses.push(statusInfo);
    }

    // Step 4: Display status
    output.newline();
    displayStatusTable(output, config.project.name, vmStatuses, hyperVAvailable);

    output.flush();
    process.exit(0);

  } catch (error) {
    handleError(output, error);
  }
}

/**
 * Get status information for a single VM.
 *
 * @param executor - Hyper-V executor
 * @param machineName - Machine name from config
 * @param vmState - VM state from state file
 * @param onHyperVUnavailable - Callback when Hyper-V is unavailable
 * @returns VM status information
 */
async function getVMStatus(
  executor: HyperVExecutor,
  machineName: string,
  vmState: VMState,
  onHyperVUnavailable: () => void
): Promise<VMStatusInfo> {
  try {
    const vm = await getVMById(executor, vmState.id);

    if (vm === null) {
      // VM is in state but not found in Hyper-V
      return {
        machineName,
        vmName: vmState.name,
        state: 'Missing',
        cpu: 0,
        memoryMB: 0,
        missing: true,
      };
    }

    return {
      machineName,
      vmName: vm.Name,
      state: vm.State,
      cpu: vm.CPUCount,
      memoryMB: vm.MemoryMB,
      missing: false,
    };
  } catch (error) {
    // If Hyper-V is unavailable, mark all VMs as unknown state
    const isHyperVUnavailable =
      (error instanceof PreflightError && error.code === 'HYPERV_NOT_AVAILABLE') ||
      (error instanceof Error && error.message.toLowerCase().includes('hyper-v'));

    if (isHyperVUnavailable) {
      onHyperVUnavailable();
      return {
        machineName,
        vmName: vmState.name,
        state: 'Unknown',
        cpu: 0,
        memoryMB: 0,
        missing: false,
      };
    }

    // For other errors, treat as missing
    return {
      machineName,
      vmName: vmState.name,
      state: 'Missing',
      cpu: 0,
      memoryMB: 0,
      missing: true,
    };
  }
}

/**
 * Display the status table.
 *
 * @param output - Output formatter
 * @param projectName - Project name
 * @param vmStatuses - Array of VM status info
 * @param hyperVAvailable - Whether Hyper-V was available
 */
function displayStatusTable(
  output: OutputFormatter,
  projectName: string,
  vmStatuses: VMStatusInfo[],
  hyperVAvailable: boolean
): void {
  if (!hyperVAvailable) {
    output.warning('Could not query Hyper-V. Showing status from state only.');
    output.newline();
  }

  if (output.isJson()) {
    // JSON mode - use the setData method
    output.setData('project', projectName);
    output.setData('vms', vmStatuses.map((vm) => ({
      name: vm.vmName,
      machineName: vm.machineName,
      state: vm.state,
      cpu: vm.cpu,
      memoryMB: vm.memoryMB,
      missing: vm.missing,
    })));

    const running = vmStatuses.filter((vm) => vm.state === 'Running').length;
    const off = vmStatuses.filter((vm) => vm.state === 'Off').length;
    const missing = vmStatuses.filter((vm) => vm.missing).length;

    output.setData('summary', {
      total: vmStatuses.length,
      running,
      off,
      missing,
    });
  } else {
    // Human-readable mode
    output.info(`Project: ${projectName}`);
    output.newline();

    const headers = ['NAME', 'STATE', 'CPU', 'MEMORY'];
    const rows = vmStatuses.map((vm) => [
      vm.machineName,
      formatState(vm.state, vm.missing),
      vm.missing ? '-' : String(vm.cpu),
      vm.missing ? '-' : `${vm.memoryMB} MB`,
    ]);

    output.indent();
    output.table(headers, rows);
    output.dedent();

    output.newline();

    // Summary
    const running = vmStatuses.filter((vm) => vm.state === 'Running').length;
    const missing = vmStatuses.filter((vm) => vm.missing).length;
    const total = vmStatuses.length;

    if (missing > 0) {
      output.warning(`${missing} VM${missing === 1 ? '' : 's'} missing from Hyper-V.`);
      output.info(`Run \`ragnatramp up <file>\` to recreate missing VMs.`);
    } else {
      output.info(`${total} VM${total === 1 ? '' : 's'} managed, ${running} running.`);
    }
  }
}

/**
 * Format state for display.
 *
 * @param state - VM state
 * @param missing - Whether VM is missing
 * @returns Formatted state string
 */
function formatState(state: string, missing: boolean): string {
  if (missing) {
    return 'Missing';
  }
  return state;
}

/**
 * Handle errors and exit appropriately.
 */
function handleError(output: OutputFormatter, error: unknown): never {
  if (error instanceof ConfigLoadError) {
    output.error(error.message, new ConfigError(
      error.message,
      'CONFIG_NOT_FOUND',
      'Ensure the configuration file exists and is readable.'
    ));
  } else if (isRagnatrampError(error)) {
    output.error(error.message, error);
  } else if (error instanceof Error) {
    output.error(error.message);
  } else {
    output.error(String(error));
  }

  output.flush();
  process.exit(getExitCode(error));
}
