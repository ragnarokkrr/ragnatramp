/**
 * Preflight Checks for Ragnatramp
 *
 * Validates system requirements before executing operations:
 * - Hyper-V availability
 * - Default Switch existence
 * - Base image existence
 * - VM ownership verification
 */

import { resolve } from 'node:path';

import type { HyperVExecutor } from '../hyperv/executor.js';
import type { HyperVVM } from '../hyperv/types.js';
import type { StateFile, VMState } from '../state/types.js';
import type { ResolvedConfig } from '../config/types.js';
import type { OwnershipResult, PreflightResult, PreflightCheckResults } from './types.js';
import { PreflightError } from './errors.js';
import {
  checkHyperVAvailable,
  checkDefaultSwitch,
  checkFileExists,
} from '../hyperv/queries.js';
import {
  generateVMName,
  hasRagnatrampMarker,
  matchesExpectedName,
} from './naming.js';

/**
 * Run all preflight checks before an operation.
 *
 * @param executor - HyperVExecutor instance
 * @param config - Resolved configuration
 * @returns Aggregate preflight check results
 */
export async function runPreflightChecks(
  executor: HyperVExecutor,
  config: ResolvedConfig
): Promise<PreflightCheckResults> {
  // Run checks in parallel where possible
  const [hyperVResult, switchResult, imageResults] = await Promise.all([
    checkHyperVAvailability(executor),
    checkDefaultSwitchExists(executor),
    checkBaseImagesExist(executor, config),
  ]);

  const allPassed =
    hyperVResult.passed &&
    switchResult.passed &&
    imageResults.passed;

  return {
    allPassed,
    hyperVAvailable: hyperVResult,
    defaultSwitchExists: switchResult,
    baseImagesExist: imageResults,
  };
}

/**
 * Check if Hyper-V is available and running.
 *
 * @param executor - HyperVExecutor instance
 * @returns Preflight result
 */
export async function checkHyperVAvailability(
  executor: HyperVExecutor
): Promise<PreflightResult> {
  try {
    const result = await checkHyperVAvailable(executor);
    if (result.available) {
      return { passed: true };
    }
    return {
      passed: false,
      message: result.message ?? 'Hyper-V is not available',
      suggestion: 'Ensure Hyper-V is enabled: Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All',
    };
  } catch (error) {
    return {
      passed: false,
      message: error instanceof Error ? error.message : 'Failed to check Hyper-V availability',
      suggestion: 'Ensure you are a member of the "Hyper-V Administrators" group and Hyper-V is installed.',
    };
  }
}

/**
 * Check if the Default Switch exists.
 *
 * @param executor - HyperVExecutor instance
 * @returns Preflight result
 */
export async function checkDefaultSwitchExists(
  executor: HyperVExecutor
): Promise<PreflightResult> {
  try {
    const result = await checkDefaultSwitch(executor);
    if (result.exists) {
      return { passed: true };
    }
    return {
      passed: false,
      message: 'Default Switch not found',
      suggestion: 'Create the Default Switch in Hyper-V Manager or run: New-VMSwitch -Name "Default Switch" -SwitchType Internal',
    };
  } catch (error) {
    return {
      passed: false,
      message: error instanceof Error ? error.message : 'Failed to check Default Switch',
      suggestion: 'Ensure Hyper-V is running and you have permission to query virtual switches.',
    };
  }
}

/**
 * Check if all required base images exist.
 *
 * @param executor - HyperVExecutor instance
 * @param config - Resolved configuration
 * @returns Preflight result with list of missing images
 */
export async function checkBaseImagesExist(
  executor: HyperVExecutor,
  config: ResolvedConfig
): Promise<PreflightResult & { missing?: string[] }> {
  // Collect unique base image paths
  const baseImages = new Set<string>();
  for (const machine of config.machines) {
    baseImages.add(machine.baseImage);
  }

  const missing: string[] = [];

  // Check each base image
  for (const imagePath of baseImages) {
    try {
      const result = await checkFileExists(executor, imagePath);
      if (!result.exists) {
        missing.push(imagePath);
      }
    } catch {
      // If check fails, assume missing
      missing.push(imagePath);
    }
  }

  if (missing.length === 0) {
    return { passed: true };
  }

  return {
    passed: false,
    message: `Base image(s) not found: ${missing.join(', ')}`,
    suggestion: 'Ensure the golden VHDX image exists at the specified path. Use Test-Path to verify.',
    missing,
  };
}

/**
 * Verify ownership of a VM before destructive operations.
 *
 * Implements triple verification:
 * 1. VM must be in state file
 * 2. VM Notes must contain ragnatramp marker with matching config path
 * 3. VM name must match expected pattern
 *
 * @param vmName - Full VM name to verify
 * @param state - Current state file
 * @param actualVM - Actual VM from Hyper-V
 * @param configPath - Path to the config file
 * @returns Ownership verification result
 */
export function verifyOwnership(
  vmName: string,
  state: StateFile | null,
  actualVM: HyperVVM | null,
  configPath: string
): OwnershipResult {
  const absoluteConfigPath = resolve(configPath);
  const checks = {
    inStateFile: false,
    hasMarkerInNotes: false,
    nameMatchesPattern: false,
  };

  // Check 1: Is the VM in the state file?
  if (state) {
    const stateEntry = findVMInState(state, vmName);
    checks.inStateFile = stateEntry !== null;
  }

  // Check 2: Does the VM have the ragnatramp marker in Notes?
  if (actualVM) {
    checks.hasMarkerInNotes = hasRagnatrampMarker(actualVM.Notes, absoluteConfigPath);
  }

  // Check 3: Does the VM name match the expected pattern?
  // We need to find the machine name from state to verify
  if (state) {
    for (const [machineName, vmState] of Object.entries(state.vms)) {
      if (vmState.name === vmName) {
        checks.nameMatchesPattern = matchesExpectedName(
          vmName,
          state.project,
          machineName,
          absoluteConfigPath
        );
        break;
      }
    }
  }

  // All three checks must pass for ownership confirmation
  const owned = checks.inStateFile && checks.hasMarkerInNotes && checks.nameMatchesPattern;

  if (owned) {
    return { owned: true, checks };
  }

  // Build failure reason
  const failures: string[] = [];
  if (!checks.inStateFile) {
    failures.push('not in state file');
  }
  if (!checks.hasMarkerInNotes) {
    failures.push('missing ragnatramp marker in VM Notes');
  }
  if (!checks.nameMatchesPattern) {
    failures.push('name does not match expected pattern');
  }

  return {
    owned: false,
    reason: `Ownership verification failed: ${failures.join(', ')}`,
    checks,
  };
}

/**
 * Verify ownership of a VM by machine name.
 *
 * Convenience function that looks up the VM in state by machine name.
 *
 * @param machineName - Machine name from config
 * @param state - Current state file
 * @param actualVMs - Map of actual VMs from Hyper-V (by name)
 * @param configPath - Path to the config file
 * @param projectName - Project name from config
 * @returns Ownership verification result
 */
export function verifyOwnershipByMachineName(
  machineName: string,
  state: StateFile | null,
  actualVMs: Map<string, HyperVVM>,
  configPath: string,
  projectName: string
): OwnershipResult {
  // Generate expected VM name
  const expectedVMName = generateVMName(projectName, machineName, configPath);

  // Get state entry
  const stateEntry = state?.vms[machineName];

  // Get actual VM
  const actualVM = actualVMs.get(expectedVMName) ?? null;

  return verifyOwnership(
    stateEntry?.name ?? expectedVMName,
    state,
    actualVM,
    configPath
  );
}

/**
 * Find a VM in the state file by its full name.
 *
 * @param state - State file
 * @param vmName - Full VM name to find
 * @returns VMState if found, null otherwise
 */
function findVMInState(state: StateFile, vmName: string): VMState | null {
  for (const vmState of Object.values(state.vms)) {
    if (vmState.name === vmName) {
      return vmState;
    }
  }
  return null;
}

/**
 * Throw a PreflightError if checks failed.
 *
 * @param results - Preflight check results
 * @throws PreflightError if any check failed
 */
export function assertPreflightPassed(results: PreflightCheckResults): void {
  if (results.allPassed) {
    return;
  }

  // Find the first failing check
  if (!results.hyperVAvailable.passed) {
    throw new PreflightError(
      results.hyperVAvailable.message ?? 'Hyper-V is not available',
      'HYPERV_NOT_AVAILABLE',
      results.hyperVAvailable.suggestion
    );
  }

  if (!results.defaultSwitchExists.passed) {
    throw new PreflightError(
      results.defaultSwitchExists.message ?? 'Default Switch not found',
      'DEFAULT_SWITCH_NOT_FOUND',
      results.defaultSwitchExists.suggestion
    );
  }

  if (!results.baseImagesExist.passed) {
    throw new PreflightError(
      results.baseImagesExist.message ?? 'Base image(s) not found',
      'BASE_IMAGE_NOT_FOUND',
      results.baseImagesExist.suggestion,
      { missing: results.baseImagesExist.missing }
    );
  }
}
