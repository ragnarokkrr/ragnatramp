/**
 * Restore Command Handler
 *
 * Restores managed VMs from a named checkpoint.
 * VMs are stopped before restore and can optionally be restarted.
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
import { ConfigError, CheckpointError, isRagnatrampError, getExitCode } from '../../core/errors.js';
import { createOutput, OutputFormatter } from '../output.js';
import { buildRestoreVMSnapshotScript, buildStartVMScript } from '../../hyperv/commands.js';
import type { HyperVVM } from '../../hyperv/types.js';

/**
 * Options for the restore command
 */
export interface RestoreCommandOptions {
  name: string;
  json?: boolean;
}

/**
 * Execute the restore command.
 *
 * This command:
 * 1. Loads and validates the YAML configuration
 * 2. Loads existing state
 * 3. Validates checkpoint exists for all VMs
 * 4. Queries current VMs from Hyper-V
 * 5. Restores each VM to the named checkpoint
 *
 * @param file - Path to the configuration file
 * @param options - Command options including required --name
 */
export async function restoreCommand(
  file: string,
  options: RestoreCommandOptions
): Promise<void> {
  const output = createOutput('restore', options);

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

    // Step 4: Validate checkpoint exists for all VMs
    const stateVMs = stateManager.getVMs();
    const vmsWithCheckpoint: Array<{ machineName: string; checkpointId: string }> = [];
    const vmsMissingCheckpoint: string[] = [];

    for (const machineName of Object.keys(stateVMs)) {
      const checkpoint = stateManager.getCheckpoint(machineName, options.name);
      if (checkpoint) {
        vmsWithCheckpoint.push({ machineName, checkpointId: checkpoint.id });
      } else {
        vmsMissingCheckpoint.push(machineName);
      }
    }

    if (vmsMissingCheckpoint.length > 0) {
      output.error(
        `Checkpoint '${options.name}' not found for machine(s): ${vmsMissingCheckpoint.join(', ')}`,
        new CheckpointError(
          `Checkpoint not found`,
          `Run 'ragnatramp checkpoint ${file} --name ${options.name}' to create it first.`,
          options.name,
          vmsMissingCheckpoint[0]
        )
      );
      output.flush();
      process.exit(1);
    }

    // Step 5: Query current VMs from Hyper-V
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

    // Step 6: Restore each VM
    output.newline();
    output.info(`Restoring ${vmsWithCheckpoint.length} VM(s) to checkpoint '${options.name}'...`);
    output.warning('Note: VMs will be stopped during restore.');

    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    for (const { machineName, checkpointId } of vmsWithCheckpoint) {
      const vmState = stateVMs[machineName];
      if (!vmState) {
        skipped++;
        continue;
      }

      const actualVM = actualVMsByName.get(vmState.name);

      if (!actualVM) {
        output.warning(`${machineName}: VM not found in Hyper-V, skipping`);
        skipped++;
        continue;
      }

      output.info(`  Restoring ${vmState.name}...`);

      try {
        const script = buildRestoreVMSnapshotScript(vmState.id, checkpointId);
        await executor.executeVoid(script);

        output.success(`${machineName}: restored to checkpoint '${options.name}'`);
        succeeded++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        output.error(`${machineName}: failed to restore - ${errorMessage}`);
        failed++;
      }
    }

    // Step 7: Report results
    output.newline();
    if (failed === 0 && skipped === 0) {
      output.success(`Restored ${succeeded} VM(s) to checkpoint '${options.name}'.`);
      output.info('VMs are now in "Off" state. Run `ragnatramp up` to start them.');
    } else if (failed > 0) {
      output.error(`Failed to restore ${failed} VM(s).`);
      output.summary({ restored: succeeded });
      output.flush();
      process.exit(1);
    } else {
      output.info(`Restored ${succeeded} VM(s), ${skipped} skipped.`);
    }

    output.summary({ restored: succeeded });
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
