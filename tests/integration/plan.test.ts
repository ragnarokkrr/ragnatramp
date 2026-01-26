/**
 * Integration tests for the `plan` command
 *
 * Tests the plan preview functionality without modifying Hyper-V.
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
import { computePlan, hasActions, formatPlanSummary } from '../../src/core/planner.js';
import { generateVMName, generateVMNotes } from '../../src/core/naming.js';
import type { HyperVVM } from '../../src/hyperv/types.js';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a temporary directory for test files
 */
async function createTempDir(): Promise<string> {
  const dir = join(tmpdir(), `ragnatramp-plan-test-${randomUUID()}`);
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

// =============================================================================
// Tests
// =============================================================================

describe('plan command integration', () => {
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

  describe('shows create actions for new VMs', () => {
    it('should plan create actions when no VMs exist', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('myproject', ['web', 'db']), 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      assert.ok(validationResult.valid);
      const config = await resolveConfig(validationResult.config, configPath);

      // No state, no VMs
      const state = null;
      const actualVMs: HyperVVM[] = [];

      // Act
      const plan = computePlan(config, state, actualVMs);

      // Assert
      assert.ok(hasActions(plan), 'Plan should have actions');
      assert.strictEqual(plan.actions.length, 2, 'Should have 2 create actions');
      assert.strictEqual(plan.summary.create, 2, 'Summary should show 2 creates');

      const actionTypes = plan.actions.map((a) => a.type);
      assert.ok(actionTypes.every((t) => t === 'create'), 'All actions should be create');

      const machineNames = plan.actions.map((a) => a.machineName);
      assert.ok(machineNames.includes('web'), 'Should include web');
      assert.ok(machineNames.includes('db'), 'Should include db');
    });

    it('should show details for each create action', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('devenv', ['app']), 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      assert.ok(validationResult.valid);
      const config = await resolveConfig(validationResult.config, configPath);

      // Act
      const plan = computePlan(config, null, []);

      // Assert
      assert.strictEqual(plan.actions.length, 1);
      const action = plan.actions[0];
      assert.ok(action);
      assert.strictEqual(action.type, 'create');
      assert.strictEqual(action.machineName, 'app');

      const details = action.details;
      assert.strictEqual(details.type, 'create');
      if (details.type === 'create') {
        assert.strictEqual(details.cpu, 2);
        assert.strictEqual(details.memoryMB, 2048);
        assert.ok(details.diskPath, 'Should have disk path');
        assert.ok(details.differencing, 'Should use differencing disk');
      }
    });

    it('should format plan summary correctly', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('project', ['a', 'b', 'c']), 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      assert.ok(validationResult.valid);
      const config = await resolveConfig(validationResult.config, configPath);

      // Act
      const plan = computePlan(config, null, []);
      const summary = formatPlanSummary(plan);

      // Assert
      assert.ok(summary.includes('3'), 'Summary should mention 3 VMs');
      assert.ok(summary.includes('create'), 'Summary should mention create');
    });
  });

  describe('shows "no changes" when converged', () => {
    it('should show no actions when VMs exist and are running', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('myproject', ['web', 'db']), 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      assert.ok(validationResult.valid);
      const config = await resolveConfig(validationResult.config, configPath);

      // Create state with existing VMs
      const stateManager = new StateManager(configPath);
      await stateManager.create(config.project.name);

      const webVMName = generateVMName('myproject', 'web', configPath);
      const dbVMName = generateVMName('myproject', 'db', configPath);
      const webId = randomUUID();
      const dbId = randomUUID();

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

      // Simulate Hyper-V reporting these VMs as Running
      const actualVMs: HyperVVM[] = [
        {
          Id: webId,
          Name: webVMName,
          State: 'Running',
          Notes: generateVMNotes(configPath),
          CPUCount: 2,
          MemoryMB: 2048,
        },
        {
          Id: dbId,
          Name: dbVMName,
          State: 'Running',
          Notes: generateVMNotes(configPath),
          CPUCount: 2,
          MemoryMB: 2048,
        },
      ];

      // Act
      const plan = computePlan(config, stateManager.getState(), actualVMs);

      // Assert
      assert.ok(!hasActions(plan), 'Plan should have no actions');
      assert.strictEqual(plan.actions.length, 0, 'Should have 0 actions');
      assert.strictEqual(plan.summary.unchanged, 2, 'Should show 2 unchanged');
    });

    it('should show "No changes needed" in summary when converged', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('myproject', ['single']), 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      assert.ok(validationResult.valid);
      const config = await resolveConfig(validationResult.config, configPath);

      const stateManager = new StateManager(configPath);
      await stateManager.create(config.project.name);

      const vmName = generateVMName('myproject', 'single', configPath);
      const vmId = randomUUID();

      stateManager.addVM('single', {
        id: vmId,
        name: vmName,
        machineName: 'single',
        diskPath: join(config.artifactPath, 'single.vhdx'),
        createdAt: new Date().toISOString(),
        checkpoints: [],
      });

      await stateManager.save();

      const actualVMs: HyperVVM[] = [
        {
          Id: vmId,
          Name: vmName,
          State: 'Running',
          Notes: generateVMNotes(configPath),
          CPUCount: 2,
          MemoryMB: 2048,
        },
      ];

      // Act
      const plan = computePlan(config, stateManager.getState(), actualVMs);
      const summary = formatPlanSummary(plan);

      // Assert
      assert.strictEqual(summary, 'No changes needed', 'Should show no changes needed');
    });
  });

  describe('shows start actions for stopped VMs', () => {
    it('should plan start action for stopped VMs', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('myproject', ['worker']), 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      assert.ok(validationResult.valid);
      const config = await resolveConfig(validationResult.config, configPath);

      const stateManager = new StateManager(configPath);
      await stateManager.create(config.project.name);

      const vmName = generateVMName('myproject', 'worker', configPath);
      const vmId = randomUUID();

      stateManager.addVM('worker', {
        id: vmId,
        name: vmName,
        machineName: 'worker',
        diskPath: join(config.artifactPath, 'worker.vhdx'),
        createdAt: new Date().toISOString(),
        checkpoints: [],
      });

      await stateManager.save();

      // VM exists but is Off
      const actualVMs: HyperVVM[] = [
        {
          Id: vmId,
          Name: vmName,
          State: 'Off',
          Notes: generateVMNotes(configPath),
          CPUCount: 2,
          MemoryMB: 2048,
        },
      ];

      // Act
      const plan = computePlan(config, stateManager.getState(), actualVMs);

      // Assert
      assert.ok(hasActions(plan), 'Plan should have actions');
      assert.strictEqual(plan.actions.length, 1, 'Should have 1 action');
      assert.strictEqual(plan.summary.start, 1, 'Should show 1 start');

      const action = plan.actions[0];
      assert.ok(action);
      assert.strictEqual(action.type, 'start', 'Action should be start');
      assert.strictEqual(action.machineName, 'worker');
    });
  });

  describe('plan is read-only', () => {
    it('should not modify state file when computing plan', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('myproject', ['web']), 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      assert.ok(validationResult.valid);
      const config = await resolveConfig(validationResult.config, configPath);

      // No state exists initially
      const stateManager = new StateManager(configPath);
      const existsBefore = await stateManager.exists();
      assert.ok(!existsBefore, 'State should not exist before plan');

      // Act
      const plan = computePlan(config, null, []);

      // Assert - state still should not exist
      const existsAfter = await stateManager.exists();
      assert.ok(!existsAfter, 'State should not exist after plan - plan is read-only');
      assert.strictEqual(plan.actions.length, 1, 'Plan should still compute correctly');
    });
  });
});
