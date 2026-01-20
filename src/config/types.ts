/**
 * Configuration Types for Ragnatramp
 *
 * These types represent the YAML configuration structure and resolved configurations
 * with defaults applied.
 */

// =============================================================================
// YAML Input Types (T011)
// =============================================================================

/**
 * Root configuration object parsed from ragnatramp.yaml
 */
export interface RagnatrampConfig {
  project: ProjectConfig;
  defaults?: DefaultsConfig;
  machines: MachineConfig[];
  settings?: SettingsConfig;
}

/**
 * Project identification
 */
export interface ProjectConfig {
  /** Project name, used in VM naming. 1-32 chars, alphanumeric + hyphen */
  name: string;
}

/**
 * Default values applied to all machines unless overridden
 */
export interface DefaultsConfig {
  /** Number of virtual CPUs. Default: 2 */
  cpu?: number;
  /** Memory in MB. Default: 2048 */
  memory?: number;
  /** Path to golden VHDX image */
  base_image?: string;
  /** Disk creation strategy: "differencing" (default) or "copy" */
  disk_strategy?: 'differencing' | 'copy';
}

/**
 * Individual machine definition
 */
export interface MachineConfig {
  /** Machine name, unique within project. 1-16 chars, alphanumeric + hyphen */
  name: string;
  /** Override default CPU count */
  cpu?: number;
  /** Override default memory (MB) */
  memory?: number;
  /** Override default base image path */
  base_image?: string;
}

/**
 * Optional global settings
 */
export interface SettingsConfig {
  /** Path for VM artifacts. Default: ~/.ragnatramp/vms/{project} */
  artifact_path?: string;
  /** Start VMs after creation. Default: true */
  auto_start?: boolean;
}

// =============================================================================
// Resolved Types (T012)
// =============================================================================

/**
 * Machine config with all defaults applied
 */
export interface ResolvedMachine {
  /** Machine name from config */
  name: string;
  /** Number of virtual CPUs (defaults applied) */
  cpu: number;
  /** Memory in MB (defaults applied) */
  memory: number;
  /** Absolute path to base/golden VHDX image */
  baseImage: string;
  /** Disk creation strategy */
  diskStrategy: 'differencing' | 'copy';
}

/**
 * Fully resolved configuration ready for execution
 */
export interface ResolvedConfig {
  /** Project information */
  project: {
    name: string;
  };
  /** Resolved machine configurations with all defaults applied */
  machines: ResolvedMachine[];
  /** Absolute path for VM artifacts (disks, etc.) */
  artifactPath: string;
  /** Whether to start VMs after creation */
  autoStart: boolean;
  /** Absolute path to the YAML config file */
  configPath: string;
  /** SHA256 hash of the YAML config content (first 8 chars) */
  configHash: string;
}
