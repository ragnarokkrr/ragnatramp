/**
 * Plan Command Handler
 *
 * Shows intended actions without executing them.
 * This is a read-only preview of what `ragnatramp up` would do.
 *
 * This is User Story 3: Preview Changes.
 */

import { resolve } from 'node:path';

import { loadYamlFile, ConfigLoadError } from '../../config/loader.js';
import { validateConfig } from '../../config/validator.js';
import { resolveConfig } from '../../config/resolver.js';
import { HyperVExecutor } from '../../hyperv/executor.js';
import { getVMs } from '../../hyperv/queries.js';
import { StateManager } from '../../state/manager.js';
import { computePlan } from '../../core/planner.js';
import { ConfigError, isRagnatrampError, getExitCode } from '../../core/errors.js';
import { createOutput, OutputFormatter } from '../output.js';

/**
 * Options for the plan command
 */
export interface PlanCommandOptions {
  json?: boolean;
  verbose?: boolean;
}

/**
 * Execute the plan command.
 *
 * This command:
 * 1. Loads and validates the YAML configuration
 * 2. Loads existing state (if any)
 * 3. Queries current VMs from Hyper-V (read-only)
 * 4. Computes the plan (what actions would be needed)
 * 5. Displays the plan without executing anything
 *
 * IMPORTANT: This command makes NO modifications to Hyper-V or state.
 * It only performs read-only queries.
 *
 * @param file - Path to the configuration file
 * @param options - Command options
 */
export async function planCommand(
  file: string,
  options: PlanCommandOptions
): Promise<void> {
  const output = createOutput('plan', options);

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

    // Step 2: Load existing state (read-only)
    const stateManager = new StateManager(configPath);
    let state = null;

    if (await stateManager.exists()) {
      state = await stateManager.load();
    }

    // Step 3: Query current VMs from Hyper-V (read-only)
    // Note: We only call getVMs which is a read-only query
    const executor = new HyperVExecutor({ verbose: options.verbose });
    let actualVMs: import('../../hyperv/types.js').HyperVVM[] = [];

    try {
      actualVMs = await getVMs(executor);
    } catch {
      // If Hyper-V is not available, we can still show what would be created
      // just without knowing the current state
      output.warning('Could not query Hyper-V. Showing plan based on state only.');
    }

    // Step 4: Compute plan (no modifications)
    const plan = computePlan(config, state, actualVMs);

    // Step 5: Display the plan
    output.newline();
    output.planSummary(plan.actions);

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
