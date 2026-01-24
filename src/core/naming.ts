/**
 * VM Naming Utilities
 *
 * Generates deterministic, unique VM names using the project name,
 * machine name, and a hash of the config file path.
 */

import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

/**
 * VM name pattern for validation.
 * Format: {project}-{machine}-{hash8}
 */
export const VM_NAME_PATTERN = /^([a-z0-9][a-z0-9-]*[a-z0-9])-([a-z0-9][a-z0-9-]*[a-z0-9])-([a-f0-9]{8})$/i;

/**
 * Marker prefix used in VM Notes to identify ragnatramp-managed VMs.
 */
export const RAGNATRAMP_MARKER_PREFIX = 'ragnatramp:';

/**
 * Generate a deterministic VM name.
 *
 * The name format is: {project}-{machine}-{hash8}
 * where hash8 is the first 8 characters of SHA256(configPath).
 *
 * This ensures:
 * - Uniqueness across different config files (via hash)
 * - Predictable names for the same config/machine combination
 * - Human-readable identification of project and machine
 *
 * @param projectName - Project name from config
 * @param machineName - Machine name from config
 * @param configPath - Path to the config file (will be resolved to absolute)
 * @returns Deterministic VM name
 */
export function generateVMName(
  projectName: string,
  machineName: string,
  configPath: string
): string {
  const absolutePath = resolve(configPath);
  const hash = computePathHash(absolutePath);
  return `${projectName}-${machineName}-${hash}`;
}

/**
 * Compute an 8-character hash of a file path.
 *
 * Uses SHA256 and takes the first 8 hex characters.
 * The path is normalized to forward slashes for cross-platform consistency.
 *
 * @param path - File path to hash
 * @returns First 8 characters of SHA256 hash
 */
export function computePathHash(path: string): string {
  // Normalize path separators for consistent hashing across platforms
  const normalizedPath = path.replace(/\\/g, '/').toLowerCase();
  const hash = createHash('sha256').update(normalizedPath).digest('hex');
  return hash.slice(0, 8);
}

/**
 * Generate the marker string for VM Notes.
 *
 * This marker is stored in the VM's Notes field and used for
 * ownership verification during destroy operations.
 *
 * @param configPath - Absolute path to the config file
 * @returns Marker string for VM Notes
 */
export function generateNotesMarker(configPath: string): string {
  const absolutePath = resolve(configPath);
  return `${RAGNATRAMP_MARKER_PREFIX}${absolutePath}`;
}

/**
 * Generate the full VM Notes content.
 *
 * Includes version info, config path, and management marker.
 *
 * @param configPath - Absolute path to the config file
 * @returns Full Notes content string
 */
export function generateVMNotes(configPath: string): string {
  const absolutePath = resolve(configPath);
  const lines = [
    'ragnatramp:v0.1.0',
    `config:${absolutePath}`,
    'managed:true',
  ];
  return lines.join('\n');
}

/**
 * Parse a VM name to extract components.
 *
 * @param vmName - VM name to parse
 * @returns Parsed components or null if name doesn't match pattern
 */
export function parseVMName(vmName: string): {
  project: string;
  machine: string;
  hash: string;
} | null {
  const match = VM_NAME_PATTERN.exec(vmName);
  if (!match) {
    return null;
  }
  const [, project, machine, hash] = match;
  if (!project || !machine || !hash) {
    return null;
  }
  return { project, machine, hash };
}

/**
 * Check if a VM name matches the expected pattern for a project.
 *
 * @param vmName - VM name to check
 * @param projectName - Expected project name
 * @returns Whether the name matches the expected pattern
 */
export function matchesProjectPattern(
  vmName: string,
  projectName: string
): boolean {
  const parsed = parseVMName(vmName);
  if (!parsed) {
    return false;
  }
  return parsed.project.toLowerCase() === projectName.toLowerCase();
}

/**
 * Check if a VM name matches expected values.
 *
 * @param vmName - VM name to check
 * @param projectName - Expected project name
 * @param machineName - Expected machine name
 * @param configPath - Config path to compute expected hash
 * @returns Whether the name matches exactly
 */
export function matchesExpectedName(
  vmName: string,
  projectName: string,
  machineName: string,
  configPath: string
): boolean {
  const expectedName = generateVMName(projectName, machineName, configPath);
  return vmName === expectedName;
}

/**
 * Extract the config path marker from VM Notes.
 *
 * @param notes - VM Notes content
 * @returns Config path from marker, or null if not found
 */
export function extractConfigPathFromNotes(notes: string | null): string | null {
  if (!notes) {
    return null;
  }

  // Look for config: line
  const configMatch = /^config:(.+)$/m.exec(notes);
  if (configMatch?.[1]) {
    return configMatch[1];
  }

  // Fall back to legacy ragnatramp: marker format
  const markerMatch = new RegExp(`^${RAGNATRAMP_MARKER_PREFIX}(.+)$`, 'm').exec(notes);
  if (markerMatch?.[1]) {
    return markerMatch[1];
  }

  return null;
}

/**
 * Check if VM Notes contain the ragnatramp marker.
 *
 * @param notes - VM Notes content
 * @param configPath - Expected config path (optional, for exact match)
 * @returns Whether the Notes contain a valid ragnatramp marker
 */
export function hasRagnatrampMarker(
  notes: string | null,
  configPath?: string
): boolean {
  if (!notes) {
    return false;
  }

  // Check for managed:true marker
  if (!/managed:true/i.test(notes)) {
    return false;
  }

  // If config path specified, verify it matches
  if (configPath) {
    const extractedPath = extractConfigPathFromNotes(notes);
    if (!extractedPath) {
      return false;
    }
    // Normalize paths for comparison
    const normalizedExpected = resolve(configPath).toLowerCase();
    const normalizedExtracted = resolve(extractedPath).toLowerCase();
    return normalizedExpected === normalizedExtracted;
  }

  return true;
}
