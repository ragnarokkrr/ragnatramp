/**
 * Path Utilities
 *
 * Provides path expansion and resolution for configuration and state files.
 */

import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/**
 * Expand a path, resolving ~ to home directory and making relative paths absolute.
 *
 * @param inputPath - Path that may contain ~ or be relative
 * @param basePath - Base directory for resolving relative paths
 * @returns Absolute path with ~ expanded
 */
export function expandPath(inputPath: string, basePath: string): string {
  let expanded = inputPath;

  // Expand ~ to home directory
  if (expanded.startsWith('~')) {
    expanded = join(homedir(), expanded.slice(1));
  }

  // Expand environment variables (Windows-style %VAR% and Unix-style $VAR)
  expanded = expanded.replace(/%([^%]+)%/g, (_, varName: string) => {
    return process.env[varName] ?? '';
  });
  expanded = expanded.replace(
    /\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (_, varName: string) => {
      return process.env[varName] ?? '';
    }
  );

  // Make relative paths absolute relative to config file directory
  if (!isAbsolute(expanded)) {
    expanded = resolve(basePath, expanded);
  }

  return expanded;
}

/**
 * Get the state file path for a given config file.
 *
 * @param configPath - Path to the configuration file
 * @returns Absolute path to .ragnatramp/state.json in the config file's directory
 */
export function getStatePath(configPath: string): string {
  const absoluteConfigPath = resolve(configPath);
  const configDir = dirname(absoluteConfigPath);
  return join(configDir, '.ragnatramp', 'state.json');
}

/**
 * Get the state directory path for a given config file.
 *
 * @param configPath - Path to the configuration file
 * @returns Absolute path to .ragnatramp directory
 */
export function getStateDir(configPath: string): string {
  const absoluteConfigPath = resolve(configPath);
  const configDir = dirname(absoluteConfigPath);
  return join(configDir, '.ragnatramp');
}

/**
 * Get the default artifact path for a project.
 *
 * @param projectName - Name of the project
 * @returns Default path: ~/.ragnatramp/vms/{projectName}
 */
export function getDefaultArtifactPath(projectName: string): string {
  return join(homedir(), '.ragnatramp', 'vms', projectName);
}
