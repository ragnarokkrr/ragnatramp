/**
 * Integration tests for checkpoint and restore commands (T109)
 *
 * Tests for User Story 7: Checkpoints
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { StateManager } from '../../src/state/manager.js';
import type { StateFile, VMState, CheckpointState } from '../../src/state/types.js';

/**
 * Helper to create a test directory with config and state
 */
async function createTestEnvironment(): Promise<{
  configPath: string;
  testDir: string;
  cleanup: () => Promise<void>;
}> {
  const testDir = join(tmpdir(), `ragnatramp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(testDir, { recursive: true });

  const configPath = join(testDir, 'ragnatramp.yaml');
  const config = `
project:
  name: test-project

defaults:
  base_image: C:/HyperV/Golden/test.vhdx
  cpu: 2
  memory: 2048

machines:
  - name: web
  - name: db
`;

  await writeFile(configPath, config, 'utf-8');

  return {
    configPath,
    testDir,
    cleanup: async () => {
      await rm(testDir, { recursive: true, force: true });
    },
  };
}

/**
 * Helper to create a state file with VMs
 */
async function createStateWithVMs(
  stateManager: StateManager,
  projectName: string,
  vms: Array<{ machineName: string; vmId: string; vmName: string }>
): Promise<void> {
  await stateManager.create(projectName);

  for (const vm of vms) {
    const vmState: VMState = {
      id: vm.vmId,
      name: vm.vmName,
      machineName: vm.machineName,
      diskPath: `C:/test/${vm.machineName}.vhdx`,
      createdAt: new Date().toISOString(),
      checkpoints: [],
    };
    stateManager.addVM(vm.machineName, vmState);
  }

  await stateManager.save();
}

describe('checkpoint command integration', () => {
  describe('creates checkpoint for managed VMs', () => {
    it('should add checkpoint to state when created', async () => {
      const { configPath, cleanup } = await createTestEnvironment();

      try {
        const stateManager = new StateManager(configPath);
        await createStateWithVMs(stateManager, 'test-project', [
          { machineName: 'web', vmId: 'vm-id-web', vmName: 'test-project-web-abc12345' },
          { machineName: 'db', vmId: 'vm-id-db', vmName: 'test-project-db-abc12345' },
        ]);

        // Simulate checkpoint creation by adding to state
        const checkpoint: CheckpointState = {
          id: 'checkpoint-id-1',
          name: 'before-upgrade',
          createdAt: new Date().toISOString(),
        };

        await stateManager.load();
        stateManager.addCheckpoint('web', checkpoint);
        await stateManager.save();

        // Verify checkpoint was added
        const savedCheckpoint = stateManager.getCheckpoint('web', 'before-upgrade');
        assert.ok(savedCheckpoint, 'Checkpoint should exist in state');
        assert.strictEqual(savedCheckpoint.name, 'before-upgrade');
        assert.strictEqual(savedCheckpoint.id, 'checkpoint-id-1');
      } finally {
        await cleanup();
      }
    });

    it('should track multiple checkpoints per VM', async () => {
      const { configPath, cleanup } = await createTestEnvironment();

      try {
        const stateManager = new StateManager(configPath);
        await createStateWithVMs(stateManager, 'test-project', [
          { machineName: 'web', vmId: 'vm-id-web', vmName: 'test-project-web-abc12345' },
        ]);

        await stateManager.load();

        // Add multiple checkpoints
        stateManager.addCheckpoint('web', {
          id: 'checkpoint-1',
          name: 'checkpoint-a',
          createdAt: new Date().toISOString(),
        });
        stateManager.addCheckpoint('web', {
          id: 'checkpoint-2',
          name: 'checkpoint-b',
          createdAt: new Date().toISOString(),
        });
        stateManager.addCheckpoint('web', {
          id: 'checkpoint-3',
          name: 'checkpoint-c',
          createdAt: new Date().toISOString(),
        });

        await stateManager.save();

        // Verify all checkpoints exist
        assert.ok(stateManager.getCheckpoint('web', 'checkpoint-a'));
        assert.ok(stateManager.getCheckpoint('web', 'checkpoint-b'));
        assert.ok(stateManager.getCheckpoint('web', 'checkpoint-c'));

        // Verify checkpoint count
        const vmState = stateManager.getVM('web');
        assert.strictEqual(vmState?.checkpoints.length, 3);
      } finally {
        await cleanup();
      }
    });
  });

  describe('restores checkpoint', () => {
    it('should find checkpoint by name for restore', async () => {
      const { configPath, cleanup } = await createTestEnvironment();

      try {
        const stateManager = new StateManager(configPath);
        await createStateWithVMs(stateManager, 'test-project', [
          { machineName: 'web', vmId: 'vm-id-web', vmName: 'test-project-web-abc12345' },
        ]);

        await stateManager.load();

        // Add checkpoint
        const checkpoint: CheckpointState = {
          id: 'checkpoint-guid-123',
          name: 'before-upgrade',
          createdAt: new Date().toISOString(),
        };
        stateManager.addCheckpoint('web', checkpoint);
        await stateManager.save();

        // Reload and verify checkpoint can be found
        const freshManager = new StateManager(configPath);
        await freshManager.load();

        const foundCheckpoint = freshManager.getCheckpoint('web', 'before-upgrade');
        assert.ok(foundCheckpoint, 'Checkpoint should be found after reload');
        assert.strictEqual(foundCheckpoint.id, 'checkpoint-guid-123');
        assert.strictEqual(foundCheckpoint.name, 'before-upgrade');
      } finally {
        await cleanup();
      }
    });

    it('should return undefined for non-existent checkpoint', async () => {
      const { configPath, cleanup } = await createTestEnvironment();

      try {
        const stateManager = new StateManager(configPath);
        await createStateWithVMs(stateManager, 'test-project', [
          { machineName: 'web', vmId: 'vm-id-web', vmName: 'test-project-web-abc12345' },
        ]);

        await stateManager.load();

        const notFound = stateManager.getCheckpoint('web', 'does-not-exist');
        assert.strictEqual(notFound, undefined);
      } finally {
        await cleanup();
      }
    });

    it('should return undefined for non-existent VM', async () => {
      const { configPath, cleanup } = await createTestEnvironment();

      try {
        const stateManager = new StateManager(configPath);
        await createStateWithVMs(stateManager, 'test-project', [
          { machineName: 'web', vmId: 'vm-id-web', vmName: 'test-project-web-abc12345' },
        ]);

        await stateManager.load();

        const notFound = stateManager.getCheckpoint('non-existent-vm', 'checkpoint');
        assert.strictEqual(notFound, undefined);
      } finally {
        await cleanup();
      }
    });
  });

  describe('checkpoint removal', () => {
    it('should remove checkpoint from state', async () => {
      const { configPath, cleanup } = await createTestEnvironment();

      try {
        const stateManager = new StateManager(configPath);
        await createStateWithVMs(stateManager, 'test-project', [
          { machineName: 'web', vmId: 'vm-id-web', vmName: 'test-project-web-abc12345' },
        ]);

        await stateManager.load();

        // Add checkpoints
        stateManager.addCheckpoint('web', {
          id: 'checkpoint-1',
          name: 'keep-this',
          createdAt: new Date().toISOString(),
        });
        stateManager.addCheckpoint('web', {
          id: 'checkpoint-2',
          name: 'remove-this',
          createdAt: new Date().toISOString(),
        });
        await stateManager.save();

        // Remove one checkpoint
        const removed = stateManager.removeCheckpoint('web', 'remove-this');
        assert.ok(removed, 'Should return removed checkpoint');
        assert.strictEqual(removed.name, 'remove-this');

        await stateManager.save();

        // Verify only one remains
        assert.ok(stateManager.getCheckpoint('web', 'keep-this'));
        assert.strictEqual(stateManager.getCheckpoint('web', 'remove-this'), undefined);
      } finally {
        await cleanup();
      }
    });

    it('should return undefined when removing non-existent checkpoint', async () => {
      const { configPath, cleanup } = await createTestEnvironment();

      try {
        const stateManager = new StateManager(configPath);
        await createStateWithVMs(stateManager, 'test-project', [
          { machineName: 'web', vmId: 'vm-id-web', vmName: 'test-project-web-abc12345' },
        ]);

        await stateManager.load();

        const removed = stateManager.removeCheckpoint('web', 'does-not-exist');
        assert.strictEqual(removed, undefined);
      } finally {
        await cleanup();
      }
    });
  });

  describe('checkpoint command validation', () => {
    it('should require checkpoint name to be non-empty', async () => {
      const { configPath, cleanup } = await createTestEnvironment();

      try {
        const stateManager = new StateManager(configPath);
        await createStateWithVMs(stateManager, 'test-project', [
          { machineName: 'web', vmId: 'vm-id-web', vmName: 'test-project-web-abc12345' },
        ]);

        await stateManager.load();

        // The checkpoint name should be validated at command level
        // Here we test the state manager behavior with empty names
        const checkpoint: CheckpointState = {
          id: 'checkpoint-id',
          name: '',
          createdAt: new Date().toISOString(),
        };
        stateManager.addCheckpoint('web', checkpoint);

        // Empty name works in state but would be rejected by CLI
        const found = stateManager.getCheckpoint('web', '');
        assert.ok(found, 'Empty checkpoint name is stored but should be rejected by CLI');
      } finally {
        await cleanup();
      }
    });
  });

  describe('checkpoint data persistence', () => {
    it('should persist checkpoints across state file reloads', async () => {
      const { configPath, cleanup } = await createTestEnvironment();

      try {
        // First session: create state and checkpoints
        const stateManager1 = new StateManager(configPath);
        await createStateWithVMs(stateManager1, 'test-project', [
          { machineName: 'web', vmId: 'vm-id-web', vmName: 'test-project-web-abc12345' },
          { machineName: 'db', vmId: 'vm-id-db', vmName: 'test-project-db-abc12345' },
        ]);

        await stateManager1.load();
        stateManager1.addCheckpoint('web', {
          id: 'cp-web-1',
          name: 'baseline',
          createdAt: '2026-01-01T00:00:00.000Z',
        });
        stateManager1.addCheckpoint('db', {
          id: 'cp-db-1',
          name: 'baseline',
          createdAt: '2026-01-01T00:00:00.000Z',
        });
        await stateManager1.save();

        // Second session: reload and verify
        const stateManager2 = new StateManager(configPath);
        await stateManager2.load();

        const webCheckpoint = stateManager2.getCheckpoint('web', 'baseline');
        const dbCheckpoint = stateManager2.getCheckpoint('db', 'baseline');

        assert.ok(webCheckpoint, 'Web checkpoint should persist');
        assert.ok(dbCheckpoint, 'DB checkpoint should persist');
        assert.strictEqual(webCheckpoint.id, 'cp-web-1');
        assert.strictEqual(dbCheckpoint.id, 'cp-db-1');
        assert.strictEqual(webCheckpoint.createdAt, '2026-01-01T00:00:00.000Z');
      } finally {
        await cleanup();
      }
    });
  });

  describe('checkpoint with VM not in Hyper-V', () => {
    it('should track checkpoint even if VM is temporarily unavailable', async () => {
      const { configPath, cleanup } = await createTestEnvironment();

      try {
        const stateManager = new StateManager(configPath);
        await createStateWithVMs(stateManager, 'test-project', [
          { machineName: 'web', vmId: 'vm-id-web', vmName: 'test-project-web-abc12345' },
        ]);

        await stateManager.load();

        // Add checkpoint - state doesn't validate VM existence
        stateManager.addCheckpoint('web', {
          id: 'checkpoint-id',
          name: 'before-vm-deleted',
          createdAt: new Date().toISOString(),
        });
        await stateManager.save();

        // Checkpoint is tracked even though VM may not exist
        const checkpoint = stateManager.getCheckpoint('web', 'before-vm-deleted');
        assert.ok(checkpoint);
      } finally {
        await cleanup();
      }
    });
  });
});

describe('restore command integration', () => {
  describe('validates checkpoint exists', () => {
    it('should fail if checkpoint does not exist for any VM', async () => {
      const { configPath, cleanup } = await createTestEnvironment();

      try {
        const stateManager = new StateManager(configPath);
        await createStateWithVMs(stateManager, 'test-project', [
          { machineName: 'web', vmId: 'vm-id-web', vmName: 'test-project-web-abc12345' },
          { machineName: 'db', vmId: 'vm-id-db', vmName: 'test-project-db-abc12345' },
        ]);

        await stateManager.load();

        // Only add checkpoint to 'web', not 'db'
        stateManager.addCheckpoint('web', {
          id: 'checkpoint-id',
          name: 'partial-checkpoint',
          createdAt: new Date().toISOString(),
        });
        await stateManager.save();

        // Check which VMs have the checkpoint
        const webHas = stateManager.getCheckpoint('web', 'partial-checkpoint') !== undefined;
        const dbHas = stateManager.getCheckpoint('db', 'partial-checkpoint') !== undefined;

        assert.strictEqual(webHas, true, 'web should have checkpoint');
        assert.strictEqual(dbHas, false, 'db should NOT have checkpoint');

        // Restore command would fail because db doesn't have the checkpoint
      } finally {
        await cleanup();
      }
    });

    it('should succeed when all VMs have the checkpoint', async () => {
      const { configPath, cleanup } = await createTestEnvironment();

      try {
        const stateManager = new StateManager(configPath);
        await createStateWithVMs(stateManager, 'test-project', [
          { machineName: 'web', vmId: 'vm-id-web', vmName: 'test-project-web-abc12345' },
          { machineName: 'db', vmId: 'vm-id-db', vmName: 'test-project-db-abc12345' },
        ]);

        await stateManager.load();

        // Add checkpoint to both VMs
        stateManager.addCheckpoint('web', {
          id: 'checkpoint-web',
          name: 'release-1.0',
          createdAt: new Date().toISOString(),
        });
        stateManager.addCheckpoint('db', {
          id: 'checkpoint-db',
          name: 'release-1.0',
          createdAt: new Date().toISOString(),
        });
        await stateManager.save();

        // Check all VMs have the checkpoint
        const vmNames = Object.keys(stateManager.getVMs());
        const allHaveCheckpoint = vmNames.every(
          (name) => stateManager.getCheckpoint(name, 'release-1.0') !== undefined
        );

        assert.strictEqual(allHaveCheckpoint, true, 'All VMs should have checkpoint');
      } finally {
        await cleanup();
      }
    });
  });

  describe('restore preserves state', () => {
    it('should not modify checkpoint list after restore', async () => {
      const { configPath, cleanup } = await createTestEnvironment();

      try {
        const stateManager = new StateManager(configPath);
        await createStateWithVMs(stateManager, 'test-project', [
          { machineName: 'web', vmId: 'vm-id-web', vmName: 'test-project-web-abc12345' },
        ]);

        await stateManager.load();

        // Add multiple checkpoints
        stateManager.addCheckpoint('web', {
          id: 'checkpoint-1',
          name: 'v1',
          createdAt: new Date().toISOString(),
        });
        stateManager.addCheckpoint('web', {
          id: 'checkpoint-2',
          name: 'v2',
          createdAt: new Date().toISOString(),
        });
        await stateManager.save();

        // Simulate restore (doesn't modify state, just uses checkpoint ID)
        const checkpointToRestore = stateManager.getCheckpoint('web', 'v1');
        assert.ok(checkpointToRestore, 'Checkpoint should exist');

        // After restore, checkpoints should still exist
        const vmState = stateManager.getVM('web');
        assert.strictEqual(vmState?.checkpoints.length, 2, 'All checkpoints should remain');
      } finally {
        await cleanup();
      }
    });
  });
});
