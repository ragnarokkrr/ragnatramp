/**
 * Checkpoint Command Handler
 *
 * Creates a named checkpoint for all managed VMs.
 * Checkpoints capture the VM state at a point in time for later restore.
 *
 * This is User Story 7: Checkpoints.
 */

import { resolve } from 'node:path';

import { loadYamlFile, ConfigLoadError } from '../../config/loader.js';
import { validateConfig } from '../../config/validator.js';
import { resolveConfig } from '../../config/resolver.js';
import { HyperVExecutor } from '../../hyperv/executor.js';
import { getVMs } from '../../hyperv/queries.js';
import { StateManager } from '../../state/manager.js';
import { ConfigError, isRagnatrampError, getExitCode } from '../../core/errors.js';
import { createOutput, OutputFormatter } from '../output.js';
import { buildCheckpointVMScript } from '../../hyperv/commands.js';
import type { HyperVVM } from '../../hyperv/types.js';
import type { CheckpointState } from '../../state/types.js';

/**
 * Options for the checkpoint command
 */
export interface CheckpointCommandOptions {
  name: string;
  json?: boolean;
}

/**
 * Result from creating a checkpoint
 */
interface CheckpointResult {
  Id: string;
  Name: string;
  VMId: string;
}

/**
 * Execute the checkpoint command.
 *
 * This command:
 * 1. Loads and validates the YAML configuration
 * 2. Loads existing state
 * 3. Queries current VMs from Hyper-V
 * 4. Creates checkpoints for all managed VMs
 * 5. Updates state file with checkpoint information
 *
 * @param file - Path to the configuration file
 * @param options - Command options including required --name
 */
export async function checkpointCommand(
  file: string,
  options: CheckpointCommandOptions
): Promise<void> {
  const output = createOutput('checkpoint', options);

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
      output.info('Run `ragnatramp up` first to create VMs.');
      output.flush();
      process.exit(0);
    }

    await stateManager.load();

    // Step 3: Check if any VMs exist
    if (!stateManager.hasVMs()) {
      output.info('No VMs are currently managed.');
      output.info('Run `ragnatramp up` first to create VMs.');
      output.flush();
      process.exit(0);
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

    // Step 5: Check for existing checkpoints with same name
    const stateVMs = stateManager.getVMs();
    for (const machineName of Object.keys(stateVMs)) {
      const existingCheckpoint = stateManager.getCheckpoint(machineName, options.name);
      if (existingCheckpoint) {
        output.error(
          `Checkpoint '${options.name}' already exists for machine '${machineName}'.`,
          new ConfigError(
            `Duplicate checkpoint name`,
            'CONFIG_VALIDATION_FAILED',
            `Use a different checkpoint name or delete the existing checkpoint.`
          )
        );
        output.flush();
        process.exit(1);
      }
    }

    // Step 6: Create checkpoints for all managed VMs
    output.newline();
    output.info(`Creating checkpoint '${options.name}' for ${Object.keys(stateVMs).length} VM(s)...`);

    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    for (const [machineName, vmState] of Object.entries(stateVMs)) {
      const actualVM = actualVMsByName.get(vmState.name);

      if (!actualVM) {
        output.warning(`${machineName}: VM not found in Hyper-V, skipping`);
        skipped++;
        continue;
      }

      output.info(`  Creating checkpoint for ${vmState.name}...`);

      try {
        const script = buildCheckpointVMScript({
          vmId: vmState.id,
          name: options.name,
        });
        const result = await executor.execute<CheckpointResult>(script);

        // Add checkpoint to state
        const checkpoint: CheckpointState = {
          id: result.Id,
          name: result.Name,
          createdAt: new Date().toISOString(),
        };
        stateManager.addCheckpoint(machineName, checkpoint);

        output.success(`${machineName}: checkpoint created`);
        succeeded++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        output.error(`${machineName}: failed to create checkpoint - ${errorMessage}`);
        failed++;
      }
    }

    // Step 7: Save state
    await stateManager.save();

    // Step 8: Report results
    output.newline();
    if (failed === 0 && skipped === 0) {
      output.success(`Checkpoint '${options.name}' created for ${succeeded} VM(s).`);
    } else if (failed > 0) {
      output.error(`Failed to create checkpoint for ${failed} VM(s).`);
      output.summary({ checkpointed: succeeded });
      output.flush();
      process.exit(1);
    } else {
      output.info(`Checkpoint '${options.name}' created for ${succeeded} VM(s), ${skipped} skipped.`);
    }

    output.summary({ checkpointed: succeeded });
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
