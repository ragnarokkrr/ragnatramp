/**
 * Integration tests for the `halt` command
 *
 * Tests the halt/stop functionality with mocked Hyper-V state.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { loadYamlFile } from '../../src/config/loader.js';
import { validateConfig } from '../../src/config/validator.js';
import { resolveConfig } from '../../src/config/resolver.js';
import { StateManager } from '../../src/state/manager.js';
import { computeHaltPlan, hasActions } from '../../src/core/planner.js';
import { generateVMName, generateVMNotes } from '../../src/core/naming.js';
import type { HyperVVM } from '../../src/hyperv/types.js';
import type { StopActionDetails } from '../../src/core/types.js';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a temporary directory for test files
 */
async function createTempDir(): Promise<string> {
  const dir = join(tmpdir(), `ragnatramp-halt-test-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Create a valid test YAML config
 */
function createTestConfig(projectName: string, machines: string[]): string {
  const machineLines = machines.map((name) => `      - name: ${name}`).join('\n');
  return `
project:
  name: ${projectName}
defaults:
  cpu: 2
  memory: 2048
  base_image: C:/HyperV/Golden/base.vhdx
machines:
${machineLines}
`;
}

/**
 * Create a mock HyperVVM object
 */
function createMockVM(
  id: string,
  name: string,
  state: 'Running' | 'Off' | 'Saved' | 'Paused',
  notes: string,
  cpu: number = 2,
  memoryMB: number = 2048
): HyperVVM {
  return {
    Id: id,
    Name: name,
    State: state,
    Notes: notes,
    CPUCount: cpu,
    MemoryMB: memoryMB,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('halt command integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('stops running VMs', () => {
    it('should create stop action for running VM', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('myproject', ['web', 'db']), 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      assert.ok(validationResult.valid);
      const config = await resolveConfig(validationResult.config, configPath);

      // Create state with VMs
      const stateManager = new StateManager(configPath);
      await stateManager.create(config.project.name);

      const webVMName = generateVMName('myproject', 'web', configPath);
      const dbVMName = generateVMName('myproject', 'db', configPath);
      const webId = randomUUID();
      const dbId = randomUUID();
      const notes = generateVMNotes(configPath);

      stateManager.addVM('web', {
        id: webId,
        name: webVMName,
        machineName: 'web',
        diskPath: join(config.artifactPath, 'web.vhdx'),
        createdAt: new Date().toISOString(),
        checkpoints: [],
      });

      stateManager.addVM('db', {
        id: dbId,
        name: dbVMName,
        machineName: 'db',
        diskPath: join(config.artifactPath, 'db.vhdx'),
        createdAt: new Date().toISOString(),
        checkpoints: [],
      });

      await stateManager.save();

      // Simulate Hyper-V returning running VMs
      const actualVMs: HyperVVM[] = [
        createMockVM(webId, webVMName, 'Running', notes),
        createMockVM(dbId, dbVMName, 'Running', notes),
      ];

      // Act
      const plan = computeHaltPlan(config, stateManager.getState(), actualVMs, {});

      // Assert
      assert.ok(hasActions(plan), 'Should have stop actions');
      assert.strictEqual(plan.actions.length, 2, 'Should have 2 stop actions');
      assert.strictEqual(plan.summary.stop, 2, 'Summary should show 2 stops');

      for (const action of plan.actions) {
        assert.strictEqual(action.type, 'stop', 'Action should be stop');
        const details = action.details as StopActionDetails;
        assert.ok(details.vmId, 'Should have vmId in details');
      }
    });

    it('should create stop action for specific machine only', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('myproject', ['web', 'db']), 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      assert.ok(validationResult.valid);
      const config = await resolveConfig(validationResult.config, configPath);

      const stateManager = new StateManager(configPath);
      await stateManager.create(config.project.name);

      const webVMName = generateVMName('myproject', 'web', configPath);
      const dbVMName = generateVMName('myproject', 'db', configPath);
      const webId = randomUUID();
      const dbId = randomUUID();
      const notes = generateVMNotes(configPath);

      stateManager.addVM('web', {
        id: webId,
        name: webVMName,
        machineName: 'web',
        diskPath: join(config.artifactPath, 'web.vhdx'),
        createdAt: new Date().toISOString(),
        checkpoints: [],
      });

      stateManager.addVM('db', {
        id: dbId,
        name: dbVMName,
        machineName: 'db',
        diskPath: join(config.artifactPath, 'db.vhdx'),
        createdAt: new Date().toISOString(),
        checkpoints: [],
      });

      await stateManager.save();

      // Both VMs running
      const actualVMs: HyperVVM[] = [
        createMockVM(webId, webVMName, 'Running', notes),
        createMockVM(dbId, dbVMName, 'Running', notes),
      ];

      // Act - filter to only 'web' machine
      const plan = computeHaltPlan(config, stateManager.getState(), actualVMs, {
        filterMachines: ['web'],
      });

      // Assert
      assert.ok(hasActions(plan), 'Should have stop actions');
      assert.strictEqual(plan.actions.length, 1, 'Should have 1 stop action');
      assert.strictEqual(plan.actions[0]?.machineName, 'web', 'Should be for web machine');
    });
  });

  describe('idempotent on already stopped VMs', () => {
    it('should not create stop action for already stopped VM', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('myproject', ['web', 'db']), 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      assert.ok(validationResult.valid);
      const config = await resolveConfig(validationResult.config, configPath);

      const stateManager = new StateManager(configPath);
      await stateManager.create(config.project.name);

      const webVMName = generateVMName('myproject', 'web', configPath);
      const dbVMName = generateVMName('myproject', 'db', configPath);
      const webId = randomUUID();
      const dbId = randomUUID();
      const notes = generateVMNotes(configPath);

      stateManager.addVM('web', {
        id: webId,
        name: webVMName,
        machineName: 'web',
        diskPath: join(config.artifactPath, 'web.vhdx'),
        createdAt: new Date().toISOString(),
        checkpoints: [],
      });

      stateManager.addVM('db', {
        id: dbId,
        name: dbVMName,
        machineName: 'db',
        diskPath: join(config.artifactPath, 'db.vhdx'),
        createdAt: new Date().toISOString(),
        checkpoints: [],
      });

      await stateManager.save();

      // Both VMs are already off
      const actualVMs: HyperVVM[] = [
        createMockVM(webId, webVMName, 'Off', notes),
        createMockVM(dbId, dbVMName, 'Off', notes),
      ];

      // Act
      const plan = computeHaltPlan(config, stateManager.getState(), actualVMs, {});

      // Assert
      assert.strictEqual(hasActions(plan), false, 'Should have no actions');
      assert.strictEqual(plan.actions.length, 0, 'Should have 0 actions');
      assert.strictEqual(plan.summary.unchanged, 2, 'Should show 2 unchanged');
    });

    it('should only stop running VMs in mixed state', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('myproject', ['web', 'db', 'cache']), 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      assert.ok(validationResult.valid);
      const config = await resolveConfig(validationResult.config, configPath);

      const stateManager = new StateManager(configPath);
      await stateManager.create(config.project.name);

      const webId = randomUUID();
      const dbId = randomUUID();
      const cacheId = randomUUID();
      const notes = generateVMNotes(configPath);

      stateManager.addVM('web', {
        id: webId,
        name: generateVMName('myproject', 'web', configPath),
        machineName: 'web',
        diskPath: join(config.artifactPath, 'web.vhdx'),
        createdAt: new Date().toISOString(),
        checkpoints: [],
      });

      stateManager.addVM('db', {
        id: dbId,
        name: generateVMName('myproject', 'db', configPath),
        machineName: 'db',
        diskPath: join(config.artifactPath, 'db.vhdx'),
        createdAt: new Date().toISOString(),
        checkpoints: [],
      });

      stateManager.addVM('cache', {
        id: cacheId,
        name: generateVMName('myproject', 'cache', configPath),
        machineName: 'cache',
        diskPath: join(config.artifactPath, 'cache.vhdx'),
        createdAt: new Date().toISOString(),
        checkpoints: [],
      });

      await stateManager.save();

      // Mixed states: web Running, db Off, cache Running
      const actualVMs: HyperVVM[] = [
        createMockVM(webId, generateVMName('myproject', 'web', configPath), 'Running', notes),
        createMockVM(dbId, generateVMName('myproject', 'db', configPath), 'Off', notes),
        createMockVM(cacheId, generateVMName('myproject', 'cache', configPath), 'Running', notes),
      ];

      // Act
      const plan = computeHaltPlan(config, stateManager.getState(), actualVMs, {});

      // Assert
      assert.ok(hasActions(plan), 'Should have stop actions');
      assert.strictEqual(plan.actions.length, 2, 'Should have 2 stop actions (web and cache)');
      assert.strictEqual(plan.summary.stop, 2, 'Summary should show 2 stops');
      assert.strictEqual(plan.summary.unchanged, 1, 'Summary should show 1 unchanged (db)');

      const machineNames = plan.actions.map((a) => a.machineName);
      assert.ok(machineNames.includes('web'), 'Should include web');
      assert.ok(machineNames.includes('cache'), 'Should include cache');
      assert.ok(!machineNames.includes('db'), 'Should not include db (already off)');
    });
  });

  describe('no state file', () => {
    it('should have no actions when state does not exist', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('myproject', ['web']), 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      assert.ok(validationResult.valid);
      const config = await resolveConfig(validationResult.config, configPath);

      // No state exists
      const actualVMs: HyperVVM[] = [];

      // Act
      const plan = computeHaltPlan(config, null, actualVMs, {});

      // Assert
      assert.strictEqual(hasActions(plan), false, 'Should have no actions');
    });
  });

  describe('VM missing from Hyper-V', () => {
    it('should not create stop action for VM missing from Hyper-V', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('myproject', ['web']), 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      assert.ok(validationResult.valid);
      const config = await resolveConfig(validationResult.config, configPath);

      const stateManager = new StateManager(configPath);
      await stateManager.create(config.project.name);

      const webId = randomUUID();

      stateManager.addVM('web', {
        id: webId,
        name: generateVMName('myproject', 'web', configPath),
        machineName: 'web',
        diskPath: join(config.artifactPath, 'web.vhdx'),
        createdAt: new Date().toISOString(),
        checkpoints: [],
      });

      await stateManager.save();

      // VM is not in Hyper-V (deleted externally)
      const actualVMs: HyperVVM[] = [];

      // Act
      const plan = computeHaltPlan(config, stateManager.getState(), actualVMs, {});

      // Assert
      assert.strictEqual(hasActions(plan), false, 'Should have no actions');
      assert.strictEqual(plan.summary.unchanged, 1, 'Should show 1 unchanged');
    });
  });

  describe('graceful shutdown with force fallback', () => {
    it('should include force option in stop action details', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('myproject', ['web']), 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      assert.ok(validationResult.valid);
      const config = await resolveConfig(validationResult.config, configPath);

      const stateManager = new StateManager(configPath);
      await stateManager.create(config.project.name);

      const webVMName = generateVMName('myproject', 'web', configPath);
      const webId = randomUUID();
      const notes = generateVMNotes(configPath);

      stateManager.addVM('web', {
        id: webId,
        name: webVMName,
        machineName: 'web',
        diskPath: join(config.artifactPath, 'web.vhdx'),
        createdAt: new Date().toISOString(),
        checkpoints: [],
      });

      await stateManager.save();

      const actualVMs: HyperVVM[] = [
        createMockVM(webId, webVMName, 'Running', notes),
      ];

      // Act - with force option
      const plan = computeHaltPlan(config, stateManager.getState(), actualVMs, {
        force: true,
      });

      // Assert
      assert.ok(hasActions(plan), 'Should have stop action');
      const stopAction = plan.actions[0];
      assert.ok(stopAction);
      const details = stopAction.details as StopActionDetails;
      assert.strictEqual(details.force, true, 'Should have force flag set');
    });

    it('should default to non-force stop', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('myproject', ['web']), 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      assert.ok(validationResult.valid);
      const config = await resolveConfig(validationResult.config, configPath);

      const stateManager = new StateManager(configPath);
      await stateManager.create(config.project.name);

      const webVMName = generateVMName('myproject', 'web', configPath);
      const webId = randomUUID();
      const notes = generateVMNotes(configPath);

      stateManager.addVM('web', {
        id: webId,
        name: webVMName,
        machineName: 'web',
        diskPath: join(config.artifactPath, 'web.vhdx'),
        createdAt: new Date().toISOString(),
        checkpoints: [],
      });

      await stateManager.save();

      const actualVMs: HyperVVM[] = [
        createMockVM(webId, webVMName, 'Running', notes),
      ];

      // Act - without force option
      const plan = computeHaltPlan(config, stateManager.getState(), actualVMs, {});

      // Assert
      assert.ok(hasActions(plan), 'Should have stop action');
      const stopAction = plan.actions[0];
      assert.ok(stopAction);
      const details = stopAction.details as StopActionDetails;
      assert.strictEqual(details.force, false, 'Should have force flag as false by default');
    });
  });
});
