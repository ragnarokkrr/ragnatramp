/**
 * Halt Command Handler
 *
 * Stops managed VMs gracefully with force fallback after timeout.
 * This is a graceful shutdown command that respects VM state.
 *
 * This is User Story 5: Stop VMs.
 */

import { resolve } from 'node:path';

import { loadYamlFile, ConfigLoadError } from '../../config/loader.js';
import { validateConfig } from '../../config/validator.js';
import { resolveConfig } from '../../config/resolver.js';
import { HyperVExecutor } from '../../hyperv/executor.js';
import { getVMs } from '../../hyperv/queries.js';
import { StateManager } from '../../state/manager.js';
import { computeHaltPlan, hasActions } from '../../core/planner.js';
import { executeActions } from '../../core/reconciler.js';
import { ConfigError, isRagnatrampError, getExitCode } from '../../core/errors.js';
import { createOutput, OutputFormatter } from '../output.js';
import type { HyperVVM } from '../../hyperv/types.js';
import type { Action } from '../../core/types.js';

/**
 * Options for the halt command
 */
export interface HaltCommandOptions {
  all?: boolean;
  json?: boolean;
  verbose?: boolean;
}

/**
 * Execute the halt command.
 *
 * This command:
 * 1. Loads and validates the YAML configuration
 * 2. Loads existing state
 * 3. Queries current VMs from Hyper-V
 * 4. Computes halt plan (stop actions for running VMs)
 * 5. Executes stop actions with graceful shutdown and force fallback
 *
 * Idempotency: If a VM is already stopped, no action is taken.
 *
 * @param file - Path to the configuration file
 * @param machine - Optional specific machine name to halt
 * @param options - Command options
 */
export async function haltCommand(
  file: string,
  machine: string | undefined,
  options: HaltCommandOptions
): Promise<void> {
  const output = createOutput('halt', options);

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
      output.info(`Run \`ragnatramp up ${file}\` to create VMs.`);
      output.flush();
      process.exit(0);
    }

    await stateManager.load();

    // Step 3: Validate machine name if specified
    if (machine) {
      const machineNames = config.machines.map((m) => m.name);
      if (!machineNames.includes(machine)) {
        output.error(
          `Machine '${machine}' not found in configuration.`,
          new ConfigError(
            `Machine '${machine}' not found`,
            'CONFIG_VALIDATION_FAILED',
            `Available machines: ${machineNames.join(', ')}`
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
        'Specify a machine name or use --all to halt all VMs.',
        new ConfigError(
          'No machine specified',
          'CONFIG_VALIDATION_FAILED',
          'Use: ragnatramp halt <file> <machine> or ragnatramp halt <file> --all'
        )
      );
      output.flush();
      process.exit(1);
    }

    // Step 4: Query current VMs from Hyper-V
    const executor = new HyperVExecutor({ verbose: options.verbose });
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

    // Step 5: Compute halt plan
    const filterMachines = machine ? [machine] : undefined;
    const plan = computeHaltPlan(config, stateManager.getState(), actualVMs, {
      filterMachines,
    });

    // Step 6: Check if there's anything to do
    if (!hasActions(plan)) {
      output.info('No running VMs to stop.');
      output.flush();
      process.exit(0);
    }

    // Step 7: Execute halt actions
    output.newline();
    output.info(`Stopping ${plan.actions.length} VM${plan.actions.length === 1 ? '' : 's'}...`);

    const result = await executeActions(plan.actions, executor, stateManager, {
      onProgress: (action, status, error) => {
        if (status === 'starting') {
          output.actionStart(action);
        } else if (status === 'completed') {
          output.actionComplete(action);
        } else if (status === 'failed' && error) {
          output.actionFailed(action, error);
        }
      },
      shutdownTimeout: 30, // 30 seconds graceful shutdown timeout
    });

    // Step 8: Report results
    if (result.success) {
      output.summary({ stopped: result.summary.succeeded });
    } else {
      output.error(`Failed to stop ${result.summary.failed} VM(s).`);
      output.summary({ stopped: result.summary.succeeded });
      output.flush();
      process.exit(1);
    }

    output.flush();
    process.exit(0);

  } catch (error) {
    handleError(output, error);
  }
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
