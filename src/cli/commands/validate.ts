/**
 * Validate Command Handler
 *
 * Validates a YAML configuration file against the schema without
 * requiring Hyper-V access. Provides detailed error messages for
 * invalid configurations.
 *
 * This is User Story 2: Validate Configuration.
 */

import { resolve } from 'node:path';
import { access, constants } from 'node:fs/promises';

import { loadYamlFile, ConfigLoadError } from '../../config/loader.js';
import { validateConfig } from '../../config/validator.js';
import { resolveConfig } from '../../config/resolver.js';
import { ConfigError, isRagnatrampError, getExitCode } from '../../core/errors.js';
import { createOutput, OutputFormatter } from '../output.js';

/**
 * Options for the validate command
 */
export interface ValidateCommandOptions {
  json?: boolean;
}

/**
 * Execute the validate command.
 *
 * This command:
 * 1. Loads the YAML configuration file
 * 2. Validates it against the JSON schema
 * 3. Reports validation errors or success
 * 4. Optionally warns about missing base images (non-blocking)
 *
 * @param file - Path to the configuration file
 * @param options - Command options
 */
export async function validateCommand(
  file: string,
  options: ValidateCommandOptions
): Promise<void> {
  const output = createOutput('validate', options);

  try {
    const configPath = resolve(file);
    output.info(`Validating configuration: ${file}`);

    // Step 1: Load YAML file
    let rawConfig: unknown;
    try {
      rawConfig = await loadYamlFile(configPath);
    } catch (error) {
      if (error instanceof ConfigLoadError) {
        output.error(error.message, new ConfigError(
          error.message,
          'CONFIG_NOT_FOUND',
          'Ensure the configuration file exists and is readable.'
        ));
        output.flush();
        process.exit(1);
      }
      throw error;
    }

    // Step 2: Validate against schema
    const validationResult = validateConfig(rawConfig);

    if (!validationResult.valid) {
      output.validationError(validationResult.errors);
      output.flush();
      process.exit(1);
    }

    // Step 3: Resolve config to get expanded paths
    const config = await resolveConfig(validationResult.config, configPath);

    // Step 4: Check base image existence (non-blocking warning)
    const warnings = await checkBaseImages(config, output);

    // Step 5: Report success
    const machineNames = config.machines.map((m) => m.name);
    const baseImage = config.machines[0]?.baseImage ?? 'N/A';

    output.validationSuccess(
      config.project.name,
      config.machines.length,
      machineNames,
      baseImage
    );

    // Show warnings if any
    if (warnings.length > 0) {
      output.newline();
      for (const warning of warnings) {
        output.warning(warning);
      }
    }

    output.flush();
    process.exit(0);

  } catch (error) {
    handleError(output, error);
  }
}

/**
 * Check if base images exist and return warnings for missing ones.
 *
 * This is a non-blocking check - validation still passes, but the user
 * is warned about potentially missing base images.
 */
async function checkBaseImages(
  config: import('../../config/types.js').ResolvedConfig,
  _output: OutputFormatter
): Promise<string[]> {
  const warnings: string[] = [];
  const checkedPaths = new Set<string>();

  for (const machine of config.machines) {
    const baseImage = machine.baseImage;

    // Skip if already checked
    if (checkedPaths.has(baseImage)) {
      continue;
    }
    checkedPaths.add(baseImage);

    // Check if file exists
    try {
      await access(baseImage, constants.R_OK);
    } catch {
      warnings.push(`Base image not found: ${baseImage}`);
    }
  }

  return warnings;
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
