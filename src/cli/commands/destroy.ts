/**
 * Destroy Command Handler
 *
 * Removes managed VMs safely with triple ownership verification.
 * SAFETY: Only destroys VMs that pass all three ownership checks:
 * 1. VM is in state file
 * 2. VM Notes contain ragnatramp marker with matching config path
 * 3. VM name matches expected pattern
 *
 * This is User Story 6: Destroy Environment.
 */

import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';

import { loadYamlFile, ConfigLoadError } from '../../config/loader.js';
import { validateConfig } from '../../config/validator.js';
import { resolveConfig } from '../../config/resolver.js';
import { HyperVExecutor } from '../../hyperv/executor.js';
import { getVMs } from '../../hyperv/queries.js';
import { StateManager } from '../../state/manager.js';
import { computeDestroyPlan, hasActions } from '../../core/planner.js';
import { verifyOwnershipByMachineName } from '../../core/preflight.js';
import { ConfigError, isRagnatrampError, getExitCode, OwnershipError } from '../../core/errors.js';
import { createOutput, OutputFormatter } from '../output.js';
import {
  buildRemoveVMScript,
  buildGracefulStopVMScript,
  buildDeleteFileScript,
} from '../../hyperv/commands.js';
import type { HyperVVM } from '../../hyperv/types.js';
import type { Action, DestroyActionDetails } from '../../core/types.js';

/**
 * Options for the destroy command
 */
export interface DestroyCommandOptions {
  all?: boolean;
  json?: boolean;
}

/**
 * Execute the destroy command.
 *
 * This command:
 * 1. Loads and validates the YAML configuration
 * 2. Loads existing state
 * 3. Queries current VMs from Hyper-V
 * 4. Verifies ownership for each VM (TRIPLE CHECK)
 * 5. Executes destroy actions (stop, remove VM, delete disk)
 * 6. Updates/deletes state file
 *
 * SAFETY: If any ownership verification fails, the VM is NOT destroyed.
 *
 * @param file - Path to the configuration file
 * @param machine - Optional specific machine name to destroy
 * @param options - Command options
 */
export async function destroyCommand(
  file: string,
  machine: string | undefined,
  options: DestroyCommandOptions
): Promise<void> {
  const output = createOutput('destroy', options);

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
    output.success('Configuration validated');

    // Step 2: Load existing state
    const stateManager = new StateManager(configPath);

    if (!(await stateManager.exists())) {
      output.info(`No VMs have been created yet for project '${config.project.name}'.`);
      output.info('Nothing to destroy.');
      output.flush();
      process.exit(0);
    }

    await stateManager.load();

    // Step 3: Validate machine name if specified
    if (machine) {
      const vmState = stateManager.getVM(machine);
      if (!vmState) {
        output.error(
          `Machine '${machine}' not found in state.`,
          new ConfigError(
            `Machine '${machine}' not found`,
            'CONFIG_VALIDATION_FAILED',
            `Check 'ragnatramp status ${file}' for managed machines.`
          )
        );
        output.flush();
        process.exit(1);
      }
    }

    // Validate --all is not used with specific machine
    if (options.all && machine) {
      output.error('Cannot use --all with a specific machine name.');
      output.flush();
      process.exit(1);
    }

    // If no machine specified and not --all, require --all for safety
    if (!machine && !options.all) {
      output.error(
        'Specify a machine name or use --all to destroy all VMs.',
        new ConfigError(
          'No machine specified',
          'CONFIG_VALIDATION_FAILED',
          'Use: ragnatramp destroy <file> <machine> or ragnatramp destroy <file> --all'
        )
      );
      output.flush();
      process.exit(1);
    }

    // Step 4: Query current VMs from Hyper-V
    const executor = new HyperVExecutor();
    let actualVMs: HyperVVM[] = [];

    try {
      actualVMs = await getVMs(executor);
    } catch (error) {
      output.error('Could not query Hyper-V.');
      if (isRagnatrampError(error)) {
        output.error(error.message, error);
      }
      output.flush();
      process.exit(getExitCode(error));
    }

    // Index VMs by name for quick lookup
    const actualVMsByName = new Map<string, HyperVVM>();
    for (const vm of actualVMs) {
      actualVMsByName.set(vm.Name, vm);
    }

    // Step 5: Compute destroy plan
    const filterMachines = machine ? [machine] : undefined;
    const plan = computeDestroyPlan(config, stateManager.getState(), actualVMs, {
      filterMachines,
    });

    // Step 6: Check if there's anything to do
    if (!hasActions(plan)) {
      // Check if there are VMs in state but not in Hyper-V
      const stateVMs = stateManager.getVMs();
      const missingVMs = Object.keys(stateVMs).filter((name) => {
        const vmState = stateVMs[name];
        return vmState && !actualVMsByName.has(vmState.name);
      });

      if (missingVMs.length > 0) {
        output.info('VMs not found in Hyper-V (already deleted):');
        for (const name of missingVMs) {
          output.info(`  - ${name}`);
        }
        output.info('Cleaning up state file...');

        // Remove missing VMs from state
        for (const name of missingVMs) {
          stateManager.removeVM(name);
        }
        await stateManager.save();

        output.success('State cleaned up.');
      } else {
        output.info('No VMs to destroy.');
      }
      output.flush();
      process.exit(0);
    }

    // Step 7: Verify ownership for each VM (CRITICAL SAFETY CHECK)
    output.newline();
    output.info('Verifying ownership...');

    const verifiedActions: Action[] = [];
    const rejectedActions: Array<{ action: Action; reason: string }> = [];

    for (const action of plan.actions) {
      const ownershipResult = verifyOwnershipByMachineName(
        action.machineName,
        stateManager.getState(),
        actualVMsByName,
        configPath,
        config.project.name
      );

      if (ownershipResult.owned) {
        verifiedActions.push(action);
        output.success(`${action.machineName}: ownership verified`);
      } else {
        rejectedActions.push({
          action,
          reason: ownershipResult.reason ?? 'Unknown ownership failure',
        });
        output.warning(`${action.machineName}: ${ownershipResult.reason}`);
      }
    }

    // Step 8: Report rejected VMs
    if (rejectedActions.length > 0) {
      output.newline();
      output.warning(`SAFETY: ${rejectedActions.length} VM(s) will NOT be destroyed due to ownership verification failure.`);

      if (verifiedActions.length === 0) {
        output.error('No VMs passed ownership verification. No actions will be taken.');
        output.flush();
        process.exit(1);
      }
    }

    // Step 9: Execute destroy actions
    if (verifiedActions.length > 0) {
      output.newline();
      output.info(`Destroying ${verifiedActions.length} VM${verifiedActions.length === 1 ? '' : 's'}...`);

      let succeeded = 0;
      let failed = 0;

      for (const action of verifiedActions) {
        output.actionStart(action);

        try {
          await executeDestroyAction(action, executor, stateManager);
          output.actionComplete(action);
          succeeded++;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          output.actionFailed(action, errorMessage);
          failed++;
        }
      }

      // Step 10: Clean up state file if all VMs destroyed
      const remainingVMs = Object.keys(stateManager.getVMs());
      if (remainingVMs.length === 0) {
        // Delete the state file entirely
        try {
          await rm(stateManager.getStatePath(), { force: true });
          await rm(stateManager.getStateDir(), { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }

      // Step 11: Report results
      if (failed === 0) {
        output.summary({ destroyed: succeeded });
      } else {
        output.error(`Failed to destroy ${failed} VM(s).`);
        output.summary({ destroyed: succeeded });
        output.flush();
        process.exit(1);
      }
    }

    output.flush();
    process.exit(0);

  } catch (error) {
    handleError(output, error);
  }
}

/**
 * Execute a destroy action for a single VM.
 *
 * Steps:
 * 1. Stop the VM (graceful with force fallback)
 * 2. Remove the VM from Hyper-V
 * 3. Delete the differencing disk
 * 4. Remove VM from state
 *
 * @param action - Destroy action to execute
 * @param executor - HyperV executor
 * @param stateManager - State manager
 */
async function executeDestroyAction(
  action: Action,
  executor: HyperVExecutor,
  stateManager: StateManager
): Promise<void> {
  const details = action.details as DestroyActionDetails;

  // Step 1: Stop the VM (graceful with 30s timeout, then force)
  try {
    const stopScript = buildGracefulStopVMScript(details.vmId, 30);
    await executor.executeVoid(stopScript);
  } catch {
    // Ignore stop errors - VM might already be off
  }

  // Step 2: Remove the VM from Hyper-V
  const removeScript = buildRemoveVMScript(details.vmId);
  await executor.executeVoid(removeScript);

  // Step 3: Delete the differencing disk
  try {
    const deleteScript = buildDeleteFileScript(details.diskPath);
    await executor.executeVoid(deleteScript);
  } catch {
    // Disk deletion failure is not fatal - it might not exist
    // or be locked by another process
  }

  // Step 4: Remove VM from state and save
  stateManager.removeVM(action.machineName);
  await stateManager.save();
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
  } else if (error instanceof OwnershipError) {
    output.error(error.message, error);
    output.warning('SAFETY: VM was NOT destroyed.');
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
