/**
 * Hyper-V Queries
 *
 * High-level query functions that use the executor to query Hyper-V state.
 */

import type { HyperVVM, HyperVCheckpoint } from './types.js';
import type { HyperVExecutor } from './executor.js';
import {
  buildGetVMsScript,
  buildGetVMByNameScript,
  buildGetVMByIdScript,
  buildGetVMSnapshotsScript,
  buildCheckHyperVScript,
  buildCheckDefaultSwitchScript,
  buildCheckFileExistsScript,
} from './commands.js';

/**
 * Result of Hyper-V availability check
 */
export interface HyperVAvailabilityResult {
  available: boolean;
  message?: string;
}

/**
 * Result of Default Switch check
 */
export interface DefaultSwitchResult {
  exists: boolean;
  name?: string;
}

/**
 * Result of file existence check
 */
export interface FileExistsResult {
  exists: boolean;
  path: string;
}

/**
 * Get all VMs from Hyper-V.
 *
 * @param executor - HyperVExecutor instance
 * @returns Array of all VMs
 */
export async function getVMs(executor: HyperVExecutor): Promise<HyperVVM[]> {
  const script = buildGetVMsScript();
  const result = await executor.execute<HyperVVM[] | null>(script);
  return result ?? [];
}

/**
 * Get a VM by name.
 *
 * @param executor - HyperVExecutor instance
 * @param name - VM name to find
 * @returns VM if found, null otherwise
 */
export async function getVMByName(
  executor: HyperVExecutor,
  name: string
): Promise<HyperVVM | null> {
  const script = buildGetVMByNameScript(name);
  return executor.execute<HyperVVM | null>(script);
}

/**
 * Get a VM by ID (GUID).
 *
 * @param executor - HyperVExecutor instance
 * @param id - VM GUID
 * @returns VM if found, null otherwise
 */
export async function getVMById(
  executor: HyperVExecutor,
  id: string
): Promise<HyperVVM | null> {
  const script = buildGetVMByIdScript(id);
  return executor.execute<HyperVVM | null>(script);
}

/**
 * Get all snapshots for a VM.
 *
 * @param executor - HyperVExecutor instance
 * @param vmId - VM GUID
 * @returns Array of snapshots for the VM
 */
export async function getVMSnapshots(
  executor: HyperVExecutor,
  vmId: string
): Promise<HyperVCheckpoint[]> {
  const script = buildGetVMSnapshotsScript(vmId);
  const result = await executor.execute<HyperVCheckpoint[] | null>(script);
  return result ?? [];
}

/**
 * Check if Hyper-V is available and running.
 *
 * @param executor - HyperVExecutor instance
 * @returns Availability status and message if not available
 */
export async function checkHyperVAvailable(
  executor: HyperVExecutor
): Promise<HyperVAvailabilityResult> {
  const script = buildCheckHyperVScript();
  return executor.execute<HyperVAvailabilityResult>(script);
}

/**
 * Check if the Default Switch exists.
 *
 * @param executor - HyperVExecutor instance
 * @returns Whether Default Switch exists
 */
export async function checkDefaultSwitch(
  executor: HyperVExecutor
): Promise<DefaultSwitchResult> {
  const script = buildCheckDefaultSwitchScript();
  return executor.execute<DefaultSwitchResult>(script);
}

/**
 * Check if a file (e.g., base image) exists.
 *
 * @param executor - HyperVExecutor instance
 * @param path - File path to check
 * @returns Whether the file exists
 */
export async function checkFileExists(
  executor: HyperVExecutor,
  path: string
): Promise<FileExistsResult> {
  const script = buildCheckFileExistsScript(path);
  return executor.execute<FileExistsResult>(script);
}

/**
 * Find VMs matching a name pattern (prefix match).
 *
 * @param executor - HyperVExecutor instance
 * @param prefix - Name prefix to match
 * @returns Array of matching VMs
 */
export async function findVMsByPrefix(
  executor: HyperVExecutor,
  prefix: string
): Promise<HyperVVM[]> {
  const allVMs = await getVMs(executor);
  return allVMs.filter((vm) => vm.Name.startsWith(prefix));
}

/**
 * Find VMs with a specific marker in Notes.
 *
 * @param executor - HyperVExecutor instance
 * @param marker - String to find in Notes field
 * @returns Array of matching VMs
 */
export async function findVMsByNotesMarker(
  executor: HyperVExecutor,
  marker: string
): Promise<HyperVVM[]> {
  const allVMs = await getVMs(executor);
  return allVMs.filter((vm) => vm.Notes?.includes(marker));
}
