/**
 * Up Command Handler
 *
 * Creates and starts VMs according to the YAML configuration.
 * This is the core MVP command (User Story 1).
 */

import { resolve } from 'node:path';

import { loadYamlFile, ConfigLoadError } from '../../config/loader.js';
import { validateConfig, formatValidationErrors } from '../../config/validator.js';
import { resolveConfig } from '../../config/resolver.js';
import { HyperVExecutor } from '../../hyperv/executor.js';
import { getVMs } from '../../hyperv/queries.js';
import { StateManager } from '../../state/manager.js';
import { computePlan, hasActions } from '../../core/planner.js';
import { executeActions } from '../../core/reconciler.js';
import { runPreflightChecks, assertPreflightPassed } from '../../core/preflight.js';
import { generateVMName } from '../../core/naming.js';
import { RagnatrampError, ConfigError, isRagnatrampError, getExitCode } from '../../core/errors.js';
import { OutputFormatter, createOutput } from '../output.js';
import type { Action } from '../../core/types.js';

/**
 * Options for the up command
 */
export interface UpCommandOptions {
  json?: boolean;
  verbose?: boolean;
}

/**
 * Execute the up command.
 *
 * This command:
 * 1. Loads and validates the YAML configuration
 * 2. Runs preflight checks (Hyper-V, Default Switch, base images)
 * 3. Loads or creates state file
 * 4. Queries current VMs from Hyper-V
 * 5. Computes the plan (what actions are needed)
 * 6. Executes actions (create/start VMs)
 * 7. Updates state after each action
 *
 * @param file - Path to the configuration file
 * @param options - Command options
 */
export async function upCommand(
  file: string,
  options: UpCommandOptions
): Promise<void> {
  const output = createOutput('up', options);

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

    // Step 2: Create executor and run preflight checks
    const executor = new HyperVExecutor({ verbose: options.verbose });

    output.info('Running preflight checks...');
    const preflightResults = await runPreflightChecks(executor, config);

    if (!preflightResults.allPassed) {
      assertPreflightPassed(preflightResults); // This throws with details
    }
    output.success('Preflight checks passed');

    // Step 3: Load or create state
    const stateManager = new StateManager(configPath);
    let state = null;

    if (await stateManager.exists()) {
      state = await stateManager.load();
    } else {
      state = await stateManager.create(config.project.name);
    }

    // Step 4: Query current VMs from Hyper-V
    const actualVMs = await getVMs(executor);

    // Step 5: Compute plan
    const plan = computePlan(config, state, actualVMs);

    if (!hasActions(plan)) {
      output.info('All VMs are already in sync. No changes needed.');
      output.done(countRunningVMs(actualVMs, config));
      output.flush();
      process.exit(0);
    }

    // Step 6: Execute actions with progress reporting
    output.newline();

    const result = await executeActions(
      plan.actions,
      executor,
      stateManager,
      {
        onProgress: (action, status, error) => {
          handleActionProgress(output, action, status, error);
        },
      }
    );

    // Step 7: Report results
    if (result.success) {
      // Re-query to get accurate running count
      const finalVMs = await getVMs(executor);
      const runningCount = countRunningVMs(finalVMs, config);
      output.done(runningCount);
    } else {
      output.setSuccess(false);
      output.newline();
      output.error(`Some actions failed. ${result.summary.succeeded} succeeded, ${result.summary.failed} failed.`);
    }

    output.flush();
    process.exit(result.success ? 0 : 1);

  } catch (error) {
    handleError(output, error);
  }
}

/**
 * Handle action progress callbacks.
 */
function handleActionProgress(
  output: OutputFormatter,
  action: Action,
  status: 'starting' | 'completed' | 'failed',
  error?: string
): void {
  switch (status) {
    case 'starting':
      output.actionStart(action);
      break;
    case 'completed':
      output.actionComplete(action);
      output.newline();
      break;
    case 'failed':
      output.actionFailed(action, error ?? 'Unknown error');
      output.newline();
      break;
  }
}

/**
 * Count VMs that are running and belong to this config.
 */
function countRunningVMs(
  actualVMs: import('../../hyperv/types.js').HyperVVM[],
  config: import('../../config/types.js').ResolvedConfig
): number {
  const vmNames = new Set(
    config.machines.map((m) => generateVMName(config.project.name, m.name, config.configPath))
  );

  return actualVMs.filter(
    (vm) => vmNames.has(vm.Name) && vm.State === 'Running'
  ).length;
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
