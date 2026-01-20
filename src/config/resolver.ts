/**
 * Configuration Resolver
 *
 * Applies defaults, merges per-machine overrides, and expands paths
 * to produce a fully resolved configuration ready for execution.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type {
  RagnatrampConfig,
  ResolvedConfig,
  ResolvedMachine,
} from './types.js';

/**
 * Default values when not specified in config
 */
const DEFAULTS = {
  cpu: 2,
  memory: 2048,
  diskStrategy: 'differencing' as const,
  autoStart: true,
};

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
  expanded = expanded.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, varName: string) => {
    return process.env[varName] ?? '';
  });

  // Make relative paths absolute relative to config file directory
  if (!isAbsolute(expanded)) {
    expanded = resolve(basePath, expanded);
  }

  return expanded;
}

/**
 * Compute a short hash of a file's content.
 *
 * @param filePath - Path to the file to hash
 * @returns First 8 characters of SHA256 hash
 */
export async function computeConfigHash(filePath: string): Promise<string> {
  const content = await readFile(filePath, 'utf-8');
  const hash = createHash('sha256').update(content).digest('hex');
  return hash.slice(0, 8);
}

/**
 * Get the default artifact path for a project.
 *
 * @param projectName - Name of the project
 * @returns Default path: ~/.ragnatramp/vms/{projectName}
 */
function getDefaultArtifactPath(projectName: string): string {
  return join(homedir(), '.ragnatramp', 'vms', projectName);
}

/**
 * Resolve a machine configuration by applying defaults.
 *
 * @param machine - Raw machine config from YAML
 * @param config - Full config for accessing defaults
 * @param basePath - Base directory for path resolution
 * @returns Resolved machine with all values set
 */
function resolveMachine(
  machine: RagnatrampConfig['machines'][number],
  config: RagnatrampConfig,
  basePath: string
): ResolvedMachine {
  const defaults = config.defaults;

  // Get base image from machine or defaults (validation ensures at least one exists)
  const baseImageRaw = machine.base_image ?? defaults?.base_image;
  if (!baseImageRaw) {
    throw new Error(
      `No base_image specified for machine "${machine.name}" and no default base_image defined`
    );
  }

  return {
    name: machine.name,
    cpu: machine.cpu ?? defaults?.cpu ?? DEFAULTS.cpu,
    memory: machine.memory ?? defaults?.memory ?? DEFAULTS.memory,
    baseImage: expandPath(baseImageRaw, basePath),
    diskStrategy: defaults?.disk_strategy ?? DEFAULTS.diskStrategy,
  };
}

/**
 * Resolve a complete configuration with all defaults applied and paths expanded.
 *
 * @param config - Validated configuration from YAML
 * @param configPath - Absolute path to the configuration file
 * @returns Fully resolved configuration ready for execution
 */
export async function resolveConfig(
  config: RagnatrampConfig,
  configPath: string
): Promise<ResolvedConfig> {
  const absoluteConfigPath = resolve(configPath);
  const basePath = dirname(absoluteConfigPath);

  // Compute config hash
  const configHash = await computeConfigHash(absoluteConfigPath);

  // Resolve artifact path
  const artifactPathRaw =
    config.settings?.artifact_path ??
    getDefaultArtifactPath(config.project.name);
  const artifactPath = expandPath(artifactPathRaw, basePath);

  // Resolve each machine
  const machines = config.machines.map((machine) =>
    resolveMachine(machine, config, basePath)
  );

  return {
    project: {
      name: config.project.name,
    },
    machines,
    artifactPath,
    autoStart: config.settings?.auto_start ?? DEFAULTS.autoStart,
    configPath: absoluteConfigPath,
    configHash,
  };
}
