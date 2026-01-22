/**
 * State Manager
 *
 * Manages persisted state for tracking VMs, disks, and checkpoints.
 * Uses atomic writes to prevent corruption from concurrent access.
 */

import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type { CheckpointState, StateFile, VMState } from './types.js';
import { getStateDir, getStatePath } from '../lib/paths.js';
import { computeConfigHash } from '../lib/hash.js';

/**
 * Manages state persistence for Ragnatramp.
 *
 * State is stored in .ragnatramp/state.json relative to the config file.
 * All writes are atomic (write to temp, then rename) to prevent corruption.
 */
export class StateManager {
  private readonly configPath: string;
  private readonly statePath: string;
  private readonly stateDir: string;
  private state: StateFile | null = null;

  constructor(configPath: string) {
    this.configPath = resolve(configPath);
    this.statePath = getStatePath(this.configPath);
    this.stateDir = getStateDir(this.configPath);
  }

  /**
   * Check if a state file exists for this config.
   */
  async exists(): Promise<boolean> {
    try {
      await stat(this.statePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Load state from disk.
   *
   * @throws If state file doesn't exist or is invalid JSON
   */
  async load(): Promise<StateFile> {
    const content = await readFile(this.statePath, 'utf-8');
    const parsed = JSON.parse(content) as StateFile;
    this.state = parsed;
    return parsed;
  }

  /**
   * Get currently loaded state without reading from disk.
   *
   * @throws If state hasn't been loaded yet
   */
  getState(): StateFile {
    if (!this.state) {
      throw new Error('State not loaded. Call load() or create() first.');
    }
    return this.state;
  }

  /**
   * Save current state to disk using atomic write.
   *
   * Writes to a temp file first, then renames to ensure atomicity.
   */
  async save(): Promise<void> {
    if (!this.state) {
      throw new Error('No state to save. Call load() or create() first.');
    }

    // Update timestamp
    this.state.updatedAt = new Date().toISOString();

    // Ensure directory exists
    await mkdir(this.stateDir, { recursive: true });

    // Write to temp file first
    const tempPath = `${this.statePath}.tmp`;
    const content = JSON.stringify(this.state, null, 2);
    await writeFile(tempPath, content, 'utf-8');

    // Atomic rename
    await rename(tempPath, this.statePath);
  }

  /**
   * Create a new state file for a project.
   *
   * @param projectName - Name of the project from config
   * @returns The newly created state
   */
  async create(projectName: string): Promise<StateFile> {
    const configHash = await computeConfigHash(this.configPath);
    const now = new Date().toISOString();

    this.state = {
      version: 1,
      configHash,
      configPath: this.configPath,
      project: projectName,
      createdAt: now,
      updatedAt: now,
      vms: {},
    };

    await this.save();
    return this.state;
  }

  /**
   * Add a VM to the state.
   *
   * @param machineName - Machine name from config (used as key)
   * @param vmState - VM state to add
   */
  addVM(machineName: string, vmState: VMState): void {
    if (!this.state) {
      throw new Error('State not loaded. Call load() or create() first.');
    }
    this.state.vms[machineName] = vmState;
  }

  /**
   * Remove a VM from the state.
   *
   * @param machineName - Machine name from config
   * @returns The removed VM state, or undefined if not found
   */
  removeVM(machineName: string): VMState | undefined {
    if (!this.state) {
      throw new Error('State not loaded. Call load() or create() first.');
    }
    const vm = this.state.vms[machineName];
    if (vm) {
      delete this.state.vms[machineName];
    }
    return vm;
  }

  /**
   * Get a VM from the state.
   *
   * @param machineName - Machine name from config
   * @returns VM state or undefined if not found
   */
  getVM(machineName: string): VMState | undefined {
    if (!this.state) {
      throw new Error('State not loaded. Call load() or create() first.');
    }
    return this.state.vms[machineName];
  }

  /**
   * Get all VMs in the state.
   *
   * @returns Record of machine names to VM states
   */
  getVMs(): Record<string, VMState> {
    if (!this.state) {
      throw new Error('State not loaded. Call load() or create() first.');
    }
    return this.state.vms;
  }

  /**
   * Add a checkpoint to a VM.
   *
   * @param machineName - Machine name from config
   * @param checkpoint - Checkpoint state to add
   * @throws If VM not found in state
   */
  addCheckpoint(machineName: string, checkpoint: CheckpointState): void {
    if (!this.state) {
      throw new Error('State not loaded. Call load() or create() first.');
    }
    const vm = this.state.vms[machineName];
    if (!vm) {
      throw new Error(`VM '${machineName}' not found in state`);
    }
    vm.checkpoints.push(checkpoint);
  }

  /**
   * Get a checkpoint by name for a VM.
   *
   * @param machineName - Machine name from config
   * @param checkpointName - Name of the checkpoint
   * @returns Checkpoint state or undefined if not found
   */
  getCheckpoint(
    machineName: string,
    checkpointName: string
  ): CheckpointState | undefined {
    if (!this.state) {
      throw new Error('State not loaded. Call load() or create() first.');
    }
    const vm = this.state.vms[machineName];
    if (!vm) {
      return undefined;
    }
    return vm.checkpoints.find((cp) => cp.name === checkpointName);
  }

  /**
   * Remove a checkpoint from a VM.
   *
   * @param machineName - Machine name from config
   * @param checkpointName - Name of the checkpoint to remove
   * @returns The removed checkpoint, or undefined if not found
   */
  removeCheckpoint(
    machineName: string,
    checkpointName: string
  ): CheckpointState | undefined {
    if (!this.state) {
      throw new Error('State not loaded. Call load() or create() first.');
    }
    const vm = this.state.vms[machineName];
    if (!vm) {
      return undefined;
    }
    const index = vm.checkpoints.findIndex((cp) => cp.name === checkpointName);
    if (index === -1) {
      return undefined;
    }
    const [removed] = vm.checkpoints.splice(index, 1);
    return removed;
  }

  /**
   * Update the config hash (e.g., after config file changes).
   */
  async updateConfigHash(): Promise<void> {
    if (!this.state) {
      throw new Error('State not loaded. Call load() or create() first.');
    }
    this.state.configHash = await computeConfigHash(this.configPath);
  }

  /**
   * Check if any VMs are tracked in state.
   */
  hasVMs(): boolean {
    if (!this.state) {
      throw new Error('State not loaded. Call load() or create() first.');
    }
    return Object.keys(this.state.vms).length > 0;
  }

  /**
   * Get the state file path.
   */
  getStatePath(): string {
    return this.statePath;
  }

  /**
   * Get the state directory path.
   */
  getStateDir(): string {
    return this.stateDir;
  }
}
