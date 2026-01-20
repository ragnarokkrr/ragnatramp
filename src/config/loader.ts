/**
 * Configuration Loader
 *
 * Loads YAML configuration files from the filesystem.
 */

import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';

/**
 * Error thrown when configuration loading fails
 */
export class ConfigLoadError extends Error {
  constructor(
    message: string,
    public readonly filePath: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ConfigLoadError';
  }
}

/**
 * Load and parse a YAML configuration file.
 *
 * @param filePath - Path to the YAML configuration file
 * @returns Parsed YAML content as unknown (requires validation)
 * @throws ConfigLoadError if the file cannot be read or parsed
 */
export async function loadYamlFile(filePath: string): Promise<unknown> {
  let content: string;

  try {
    content = await readFile(filePath, 'utf-8');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      throw new ConfigLoadError(
        `Configuration file not found: ${filePath}`,
        filePath,
        err
      );
    }
    if (err.code === 'EACCES') {
      throw new ConfigLoadError(
        `Permission denied reading configuration file: ${filePath}`,
        filePath,
        err
      );
    }
    throw new ConfigLoadError(
      `Failed to read configuration file: ${filePath}`,
      filePath,
      err
    );
  }

  try {
    return yaml.load(content);
  } catch (error) {
    const err = error as yaml.YAMLException;
    throw new ConfigLoadError(
      `Invalid YAML syntax in ${filePath}: ${err.message}`,
      filePath,
      err
    );
  }
}
