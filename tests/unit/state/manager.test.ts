/**
 * Unit tests for State Manager
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdir, rm, writeFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { StateManager } from '../../../src/state/manager.js';
import type { VMState, CheckpointState } from '../../../src/state/types.js';

// Create a unique temp directory for each test run
function createTempDir(): string {
  return join(tmpdir(), `ragnatramp-test-${randomUUID()}`);
}

describe('StateManager', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = createTempDir();
    await mkdir(tempDir, { recursive: true });
    configPath = join(tempDir, 'ragnatramp.yaml');

    // Create a minimal config file for hash computation
    await writeFile(configPath, 'project:\n  name: test-project\nmachines: []');
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    it('should initialize with config path', () => {
      const manager = new StateManager(configPath);

      assert.ok(manager instanceof StateManager);
      assert.ok(manager.getStatePath().includes('.ragnatramp'));
      assert.ok(manager.getStatePath().includes('state.json'));
    });
  });

  describe('exists', () => {
    it('should return false when state file does not exist', async () => {
      const manager = new StateManager(configPath);

      const result = await manager.exists();

      assert.strictEqual(result, false);
    });

    it('should return true when state file exists', async () => {
      const manager = new StateManager(configPath);
      await manager.create('test-project');

      const result = await manager.exists();

      assert.strictEqual(result, true);
    });
  });

  describe('create', () => {
    it('should create new state file', async () => {
      const manager = new StateManager(configPath);

      const state = await manager.create('test-project');

      assert.strictEqual(state.version, 1);
      assert.strictEqual(state.project, 'test-project');
      assert.deepStrictEqual(state.vms, {});
      assert.ok(state.createdAt);
      assert.ok(state.updatedAt);
      assert.ok(state.configHash);
      assert.strictEqual(state.configHash.length, 8);
    });

    it('should create .ragnatramp directory', async () => {
      const manager = new StateManager(configPath);

      await manager.create('test-project');

      const statDir = await stat(manager.getStateDir());
      assert.ok(statDir.isDirectory());
    });

    it('should persist state to disk', async () => {
      const manager = new StateManager(configPath);

      await manager.create('test-project');

      const content = await readFile(manager.getStatePath(), 'utf-8');
      const parsed = JSON.parse(content);
      assert.strictEqual(parsed.project, 'test-project');
    });
  });

  describe('load', () => {
    it('should load existing state', async () => {
      const manager = new StateManager(configPath);
      await manager.create('test-project');

      const newManager = new StateManager(configPath);
      const state = await newManager.load();

      assert.strictEqual(state.project, 'test-project');
      assert.strictEqual(state.version, 1);
    });

    it('should throw for non-existent state', async () => {
      const manager = new StateManager(configPath);

      await assert.rejects(
        async () => manager.load(),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          return true;
        }
      );
    });
  });

  describe('getState', () => {
    it('should return loaded state', async () => {
      const manager = new StateManager(configPath);
      await manager.create('test-project');

      const state = manager.getState();

      assert.strictEqual(state.project, 'test-project');
    });

    it('should throw if state not loaded', () => {
      const manager = new StateManager(configPath);

      assert.throws(
        () => manager.getState(),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok((error as Error).message.includes('not loaded'));
          return true;
        }
      );
    });
  });

  describe('save', () => {
    it('should update timestamp on save', async () => {
      const manager = new StateManager(configPath);
      const state = await manager.create('test-project');
      const originalUpdatedAt = state.updatedAt;

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      await manager.save();
      const newState = manager.getState();

      assert.ok(new Date(newState.updatedAt) >= new Date(originalUpdatedAt));
    });

    it('should throw if no state loaded', async () => {
      const manager = new StateManager(configPath);

      await assert.rejects(
        async () => manager.save(),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok((error as Error).message.includes('No state'));
          return true;
        }
      );
    });
  });

  describe('atomic write safety', () => {
    it('should not leave temp file on successful save', async () => {
      const manager = new StateManager(configPath);
      await manager.create('test-project');

      const tempPath = `${manager.getStatePath()}.tmp`;

      try {
        await stat(tempPath);
        assert.fail('Temp file should not exist');
      } catch (error: unknown) {
        assert.ok((error as NodeJS.ErrnoException).code === 'ENOENT');
      }
    });

    it('should produce valid JSON after save', async () => {
      const manager = new StateManager(configPath);
      await manager.create('test-project');

      const content = await readFile(manager.getStatePath(), 'utf-8');

      assert.doesNotThrow(() => JSON.parse(content));
    });
  });

  describe('addVM', () => {
    it('should add VM to state', async () => {
      const manager = new StateManager(configPath);
      await manager.create('test-project');

      const vmState: VMState = {
        id: 'vm-guid-123',
        name: 'test-project-web-abc12345',
        machineName: 'web',
        diskPath: '/path/to/disk.vhdx',
        createdAt: new Date().toISOString(),
        checkpoints: [],
      };

      manager.addVM('web', vmState);

      const state = manager.getState();
      assert.deepStrictEqual(state.vms['web'], vmState);
    });

    it('should throw if state not loaded', () => {
      const manager = new StateManager(configPath);

      const vmState: VMState = {
        id: 'vm-guid-123',
        name: 'test-project-web-abc12345',
        machineName: 'web',
        diskPath: '/path/to/disk.vhdx',
        createdAt: new Date().toISOString(),
        checkpoints: [],
      };

      assert.throws(
        () => manager.addVM('web', vmState),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          return true;
        }
      );
    });
  });

  describe('removeVM', () => {
    it('should remove VM from state', async () => {
      const manager = new StateManager(configPath);
      await manager.create('test-project');

      const vmState: VMState = {
        id: 'vm-guid-123',
        name: 'test-project-web-abc12345',
        machineName: 'web',
        diskPath: '/path/to/disk.vhdx',
        createdAt: new Date().toISOString(),
        checkpoints: [],
      };

      manager.addVM('web', vmState);
      const removed = manager.removeVM('web');

      assert.deepStrictEqual(removed, vmState);
      assert.strictEqual(manager.getVM('web'), undefined);
    });

    it('should return undefined for non-existent VM', async () => {
      const manager = new StateManager(configPath);
      await manager.create('test-project');

      const removed = manager.removeVM('nonexistent');

      assert.strictEqual(removed, undefined);
    });
  });

  describe('getVM', () => {
    it('should return VM by machine name', async () => {
      const manager = new StateManager(configPath);
      await manager.create('test-project');

      const vmState: VMState = {
        id: 'vm-guid-123',
        name: 'test-project-web-abc12345',
        machineName: 'web',
        diskPath: '/path/to/disk.vhdx',
        createdAt: new Date().toISOString(),
        checkpoints: [],
      };

      manager.addVM('web', vmState);

      const result = manager.getVM('web');

      assert.deepStrictEqual(result, vmState);
    });

    it('should return undefined for non-existent VM', async () => {
      const manager = new StateManager(configPath);
      await manager.create('test-project');

      const result = manager.getVM('nonexistent');

      assert.strictEqual(result, undefined);
    });
  });

  describe('getVMs', () => {
    it('should return all VMs', async () => {
      const manager = new StateManager(configPath);
      await manager.create('test-project');

      const vm1: VMState = {
        id: 'vm-guid-1',
        name: 'test-project-web-abc12345',
        machineName: 'web',
        diskPath: '/path/to/disk1.vhdx',
        createdAt: new Date().toISOString(),
        checkpoints: [],
      };
      const vm2: VMState = {
        id: 'vm-guid-2',
        name: 'test-project-db-def67890',
        machineName: 'db',
        diskPath: '/path/to/disk2.vhdx',
        createdAt: new Date().toISOString(),
        checkpoints: [],
      };

      manager.addVM('web', vm1);
      manager.addVM('db', vm2);

      const vms = manager.getVMs();

      assert.strictEqual(Object.keys(vms).length, 2);
      assert.deepStrictEqual(vms['web'], vm1);
      assert.deepStrictEqual(vms['db'], vm2);
    });
  });

  describe('hasVMs', () => {
    it('should return false when no VMs', async () => {
      const manager = new StateManager(configPath);
      await manager.create('test-project');

      assert.strictEqual(manager.hasVMs(), false);
    });

    it('should return true when VMs exist', async () => {
      const manager = new StateManager(configPath);
      await manager.create('test-project');

      const vmState: VMState = {
        id: 'vm-guid-123',
        name: 'test-project-web-abc12345',
        machineName: 'web',
        diskPath: '/path/to/disk.vhdx',
        createdAt: new Date().toISOString(),
        checkpoints: [],
      };

      manager.addVM('web', vmState);

      assert.strictEqual(manager.hasVMs(), true);
    });
  });

  describe('addCheckpoint', () => {
    it('should add checkpoint to VM', async () => {
      const manager = new StateManager(configPath);
      await manager.create('test-project');

      const vmState: VMState = {
        id: 'vm-guid-123',
        name: 'test-project-web-abc12345',
        machineName: 'web',
        diskPath: '/path/to/disk.vhdx',
        createdAt: new Date().toISOString(),
        checkpoints: [],
      };
      manager.addVM('web', vmState);

      const checkpoint: CheckpointState = {
        id: 'checkpoint-guid-456',
        name: 'before-update',
        createdAt: new Date().toISOString(),
      };

      manager.addCheckpoint('web', checkpoint);

      const vm = manager.getVM('web');
      assert.strictEqual(vm?.checkpoints.length, 1);
      assert.deepStrictEqual(vm?.checkpoints[0], checkpoint);
    });

    it('should throw for non-existent VM', async () => {
      const manager = new StateManager(configPath);
      await manager.create('test-project');

      const checkpoint: CheckpointState = {
        id: 'checkpoint-guid-456',
        name: 'before-update',
        createdAt: new Date().toISOString(),
      };

      assert.throws(
        () => manager.addCheckpoint('nonexistent', checkpoint),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok((error as Error).message.includes('not found'));
          return true;
        }
      );
    });
  });

  describe('getCheckpoint', () => {
    it('should return checkpoint by name', async () => {
      const manager = new StateManager(configPath);
      await manager.create('test-project');

      const vmState: VMState = {
        id: 'vm-guid-123',
        name: 'test-project-web-abc12345',
        machineName: 'web',
        diskPath: '/path/to/disk.vhdx',
        createdAt: new Date().toISOString(),
        checkpoints: [],
      };
      manager.addVM('web', vmState);

      const checkpoint: CheckpointState = {
        id: 'checkpoint-guid-456',
        name: 'before-update',
        createdAt: new Date().toISOString(),
      };
      manager.addCheckpoint('web', checkpoint);

      const result = manager.getCheckpoint('web', 'before-update');

      assert.deepStrictEqual(result, checkpoint);
    });

    it('should return undefined for non-existent checkpoint', async () => {
      const manager = new StateManager(configPath);
      await manager.create('test-project');

      const vmState: VMState = {
        id: 'vm-guid-123',
        name: 'test-project-web-abc12345',
        machineName: 'web',
        diskPath: '/path/to/disk.vhdx',
        createdAt: new Date().toISOString(),
        checkpoints: [],
      };
      manager.addVM('web', vmState);

      const result = manager.getCheckpoint('web', 'nonexistent');

      assert.strictEqual(result, undefined);
    });

    it('should return undefined for non-existent VM', async () => {
      const manager = new StateManager(configPath);
      await manager.create('test-project');

      const result = manager.getCheckpoint('nonexistent', 'checkpoint');

      assert.strictEqual(result, undefined);
    });
  });

  describe('removeCheckpoint', () => {
    it('should remove checkpoint from VM', async () => {
      const manager = new StateManager(configPath);
      await manager.create('test-project');

      const vmState: VMState = {
        id: 'vm-guid-123',
        name: 'test-project-web-abc12345',
        machineName: 'web',
        diskPath: '/path/to/disk.vhdx',
        createdAt: new Date().toISOString(),
        checkpoints: [],
      };
      manager.addVM('web', vmState);

      const checkpoint: CheckpointState = {
        id: 'checkpoint-guid-456',
        name: 'before-update',
        createdAt: new Date().toISOString(),
      };
      manager.addCheckpoint('web', checkpoint);

      const removed = manager.removeCheckpoint('web', 'before-update');

      assert.deepStrictEqual(removed, checkpoint);
      assert.strictEqual(manager.getCheckpoint('web', 'before-update'), undefined);
    });

    it('should return undefined for non-existent checkpoint', async () => {
      const manager = new StateManager(configPath);
      await manager.create('test-project');

      const vmState: VMState = {
        id: 'vm-guid-123',
        name: 'test-project-web-abc12345',
        machineName: 'web',
        diskPath: '/path/to/disk.vhdx',
        createdAt: new Date().toISOString(),
        checkpoints: [],
      };
      manager.addVM('web', vmState);

      const removed = manager.removeCheckpoint('web', 'nonexistent');

      assert.strictEqual(removed, undefined);
    });
  });

  describe('updateConfigHash', () => {
    it('should update config hash', async () => {
      const manager = new StateManager(configPath);
      const state = await manager.create('test-project');
      const originalHash = state.configHash;

      // Modify config file
      await writeFile(configPath, 'project:\n  name: modified-project\nmachines: []');

      await manager.updateConfigHash();

      const newHash = manager.getState().configHash;
      assert.notStrictEqual(newHash, originalHash);
      assert.strictEqual(newHash.length, 8);
    });
  });
});
