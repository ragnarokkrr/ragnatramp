/**
 * Safety Tests for the `destroy` command
 *
 * CRITICAL: These tests verify that the destroy command NEVER deletes
 * unmanaged VMs. The triple ownership verification must prevent deletion
 * of any VM that doesn't pass all three checks.
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
import { computeDestroyPlan, hasActions } from '../../src/core/planner.js';
import { verifyOwnership, verifyOwnershipByMachineName } from '../../src/core/preflight.js';
import { generateVMName, generateVMNotes } from '../../src/core/naming.js';
import type { HyperVVM } from '../../src/hyperv/types.js';
import type { StateFile } from '../../src/state/types.js';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a temporary directory for test files
 */
async function createTempDir(): Promise<string> {
  const dir = join(tmpdir(), `ragnatramp-destroy-safety-test-${randomUUID()}`);
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
  notes: string | null,
  state: 'Running' | 'Off' = 'Running'
): HyperVVM {
  return {
    Id: id,
    Name: name,
    State: state,
    Notes: notes,
    CPUCount: 2,
    MemoryMB: 2048,
  };
}

// =============================================================================
// Safety Tests
// =============================================================================

describe('destroy command safety - ownership verification', () => {
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

  describe('T099: refuses to delete VM not in state file', () => {
    it('should reject VM that exists in Hyper-V but not in state', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('myproject', ['web']), 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      assert.ok(validationResult.valid);
      const config = await resolveConfig(validationResult.config, configPath);

      // Create state WITHOUT the VM (empty state)
      const stateManager = new StateManager(configPath);
      await stateManager.create(config.project.name);
      await stateManager.save();

      const vmName = generateVMName('myproject', 'web', configPath);
      const notes = generateVMNotes(configPath);

      // VM exists in Hyper-V with correct name and notes, but NOT in state
      const actualVM = createMockVM(randomUUID(), vmName, notes);

      // Act
      const result = verifyOwnership(vmName, stateManager.getState(), actualVM, configPath);

      // Assert
      assert.strictEqual(result.owned, false, 'VM should NOT be owned');
      assert.ok(result.reason?.includes('not in state file'), 'Should mention state file issue');
      assert.strictEqual(result.checks?.inStateFile, false, 'inStateFile check should fail');
      assert.strictEqual(result.checks?.hasMarkerInNotes, true, 'hasMarkerInNotes should pass');
    });

    it('should reject VM when state is null', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('myproject', ['web']), 'utf-8');

      const vmName = generateVMName('myproject', 'web', configPath);
      const notes = generateVMNotes(configPath);
      const actualVM = createMockVM(randomUUID(), vmName, notes);

      // Act - state is null (never created)
      const result = verifyOwnership(vmName, null, actualVM, configPath);

      // Assert
      assert.strictEqual(result.owned, false, 'VM should NOT be owned when state is null');
      assert.strictEqual(result.checks?.inStateFile, false);
    });
  });

  describe('T100: refuses to delete VM with wrong Notes marker', () => {
    it('should reject VM with missing Notes', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('myproject', ['web']), 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      assert.ok(validationResult.valid);
      const config = await resolveConfig(validationResult.config, configPath);

      const stateManager = new StateManager(configPath);
      await stateManager.create(config.project.name);

      const vmId = randomUUID();
      const vmName = generateVMName('myproject', 'web', configPath);

      stateManager.addVM('web', {
        id: vmId,
        name: vmName,
        machineName: 'web',
        diskPath: join(config.artifactPath, 'web.vhdx'),
        createdAt: new Date().toISOString(),
        checkpoints: [],
      });
      await stateManager.save();

      // VM exists but has NULL notes (no marker)
      const actualVM = createMockVM(vmId, vmName, null);

      // Act
      const result = verifyOwnership(vmName, stateManager.getState(), actualVM, configPath);

      // Assert
      assert.strictEqual(result.owned, false, 'VM should NOT be owned with null Notes');
      assert.strictEqual(result.checks?.hasMarkerInNotes, false, 'hasMarkerInNotes should fail');
    });

    it('should reject VM with Notes missing managed:true marker', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('myproject', ['web']), 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      assert.ok(validationResult.valid);
      const config = await resolveConfig(validationResult.config, configPath);

      const stateManager = new StateManager(configPath);
      await stateManager.create(config.project.name);

      const vmId = randomUUID();
      const vmName = generateVMName('myproject', 'web', configPath);

      stateManager.addVM('web', {
        id: vmId,
        name: vmName,
        machineName: 'web',
        diskPath: join(config.artifactPath, 'web.vhdx'),
        createdAt: new Date().toISOString(),
        checkpoints: [],
      });
      await stateManager.save();

      // VM has notes but missing managed:true
      const wrongNotes = `ragnatramp:v0.1.0\nconfig:${configPath}`;
      const actualVM = createMockVM(vmId, vmName, wrongNotes);

      // Act
      const result = verifyOwnership(vmName, stateManager.getState(), actualVM, configPath);

      // Assert
      assert.strictEqual(result.owned, false, 'VM should NOT be owned without managed:true');
      assert.strictEqual(result.checks?.hasMarkerInNotes, false);
    });

    it('should reject VM with Notes pointing to different config', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      const otherConfigPath = join(tempDir, 'other', 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('myproject', ['web']), 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      assert.ok(validationResult.valid);
      const config = await resolveConfig(validationResult.config, configPath);

      const stateManager = new StateManager(configPath);
      await stateManager.create(config.project.name);

      const vmId = randomUUID();
      const vmName = generateVMName('myproject', 'web', configPath);

      stateManager.addVM('web', {
        id: vmId,
        name: vmName,
        machineName: 'web',
        diskPath: join(config.artifactPath, 'web.vhdx'),
        createdAt: new Date().toISOString(),
        checkpoints: [],
      });
      await stateManager.save();

      // VM has notes pointing to DIFFERENT config file
      const wrongConfigNotes = generateVMNotes(otherConfigPath);
      const actualVM = createMockVM(vmId, vmName, wrongConfigNotes);

      // Act
      const result = verifyOwnership(vmName, stateManager.getState(), actualVM, configPath);

      // Assert
      assert.strictEqual(result.owned, false, 'VM should NOT be owned with different config path');
      assert.strictEqual(result.checks?.hasMarkerInNotes, false);
    });
  });

  describe('T101: refuses to delete VM with non-matching name pattern', () => {
    it('should reject VM with completely wrong name', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('myproject', ['web']), 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      assert.ok(validationResult.valid);
      const config = await resolveConfig(validationResult.config, configPath);

      const stateManager = new StateManager(configPath);
      await stateManager.create(config.project.name);

      const vmId = randomUUID();
      const wrongVMName = 'some-random-vm-name';
      const notes = generateVMNotes(configPath);

      stateManager.addVM('web', {
        id: vmId,
        name: wrongVMName,  // Wrong name stored in state!
        machineName: 'web',
        diskPath: join(config.artifactPath, 'web.vhdx'),
        createdAt: new Date().toISOString(),
        checkpoints: [],
      });
      await stateManager.save();

      const actualVM = createMockVM(vmId, wrongVMName, notes);

      // Act
      const result = verifyOwnership(wrongVMName, stateManager.getState(), actualVM, configPath);

      // Assert
      assert.strictEqual(result.owned, false, 'VM should NOT be owned with wrong name pattern');
      assert.strictEqual(result.checks?.nameMatchesPattern, false, 'nameMatchesPattern should fail');
    });

    it('should reject VM with wrong hash in name', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('myproject', ['web']), 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      assert.ok(validationResult.valid);
      const config = await resolveConfig(validationResult.config, configPath);

      const stateManager = new StateManager(configPath);
      await stateManager.create(config.project.name);

      const vmId = randomUUID();
      // Same project and machine, but wrong hash
      const wrongHashName = 'myproject-web-deadbeef';
      const notes = generateVMNotes(configPath);

      stateManager.addVM('web', {
        id: vmId,
        name: wrongHashName,
        machineName: 'web',
        diskPath: join(config.artifactPath, 'web.vhdx'),
        createdAt: new Date().toISOString(),
        checkpoints: [],
      });
      await stateManager.save();

      const actualVM = createMockVM(vmId, wrongHashName, notes);

      // Act
      const result = verifyOwnership(wrongHashName, stateManager.getState(), actualVM, configPath);

      // Assert
      assert.strictEqual(result.owned, false, 'VM should NOT be owned with wrong hash');
      assert.strictEqual(result.checks?.nameMatchesPattern, false);
    });
  });

  describe('T102: all three checks must pass', () => {
    it('should accept VM that passes all three checks', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('myproject', ['web']), 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      assert.ok(validationResult.valid);
      const config = await resolveConfig(validationResult.config, configPath);

      const stateManager = new StateManager(configPath);
      await stateManager.create(config.project.name);

      const vmId = randomUUID();
      const vmName = generateVMName('myproject', 'web', configPath);
      const notes = generateVMNotes(configPath);

      stateManager.addVM('web', {
        id: vmId,
        name: vmName,
        machineName: 'web',
        diskPath: join(config.artifactPath, 'web.vhdx'),
        createdAt: new Date().toISOString(),
        checkpoints: [],
      });
      await stateManager.save();

      const actualVM = createMockVM(vmId, vmName, notes);

      // Act
      const result = verifyOwnership(vmName, stateManager.getState(), actualVM, configPath);

      // Assert
      assert.strictEqual(result.owned, true, 'VM should be owned when all checks pass');
      assert.strictEqual(result.checks?.inStateFile, true);
      assert.strictEqual(result.checks?.hasMarkerInNotes, true);
      assert.strictEqual(result.checks?.nameMatchesPattern, true);
    });

    it('should reject VM that fails any single check', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('myproject', ['web']), 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      assert.ok(validationResult.valid);
      const config = await resolveConfig(validationResult.config, configPath);

      const stateManager = new StateManager(configPath);
      await stateManager.create(config.project.name);

      const vmId = randomUUID();
      const vmName = generateVMName('myproject', 'web', configPath);

      stateManager.addVM('web', {
        id: vmId,
        name: vmName,
        machineName: 'web',
        diskPath: join(config.artifactPath, 'web.vhdx'),
        createdAt: new Date().toISOString(),
        checkpoints: [],
      });
      await stateManager.save();

      // All correct except Notes has wrong config path
      const otherConfigPath = 'C:/other/config.yaml';
      const wrongNotes = generateVMNotes(otherConfigPath);
      const actualVM = createMockVM(vmId, vmName, wrongNotes);

      // Act
      const result = verifyOwnership(vmName, stateManager.getState(), actualVM, configPath);

      // Assert
      assert.strictEqual(result.owned, false, 'VM should NOT be owned if any check fails');
      assert.strictEqual(result.checks?.inStateFile, true, 'State check should pass');
      assert.strictEqual(result.checks?.hasMarkerInNotes, false, 'Notes check should fail');
      assert.strictEqual(result.checks?.nameMatchesPattern, true, 'Name check should pass');
    });
  });

  describe('verifyOwnershipByMachineName convenience function', () => {
    it('should verify ownership using machine name', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('myproject', ['web']), 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      assert.ok(validationResult.valid);
      const config = await resolveConfig(validationResult.config, configPath);

      const stateManager = new StateManager(configPath);
      await stateManager.create(config.project.name);

      const vmId = randomUUID();
      const vmName = generateVMName('myproject', 'web', configPath);
      const notes = generateVMNotes(configPath);

      stateManager.addVM('web', {
        id: vmId,
        name: vmName,
        machineName: 'web',
        diskPath: join(config.artifactPath, 'web.vhdx'),
        createdAt: new Date().toISOString(),
        checkpoints: [],
      });
      await stateManager.save();

      const actualVMs = new Map<string, HyperVVM>();
      actualVMs.set(vmName, createMockVM(vmId, vmName, notes));

      // Act
      const result = verifyOwnershipByMachineName(
        'web',
        stateManager.getState(),
        actualVMs,
        configPath,
        'myproject'
      );

      // Assert
      assert.strictEqual(result.owned, true);
    });

    it('should reject when machine not found in state', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('myproject', ['web']), 'utf-8');

      const stateManager = new StateManager(configPath);
      await stateManager.create('myproject');
      // Don't add any VMs to state
      await stateManager.save();

      const vmName = generateVMName('myproject', 'web', configPath);
      const notes = generateVMNotes(configPath);
      const actualVMs = new Map<string, HyperVVM>();
      actualVMs.set(vmName, createMockVM(randomUUID(), vmName, notes));

      // Act
      const result = verifyOwnershipByMachineName(
        'web',
        stateManager.getState(),
        actualVMs,
        configPath,
        'myproject'
      );

      // Assert
      assert.strictEqual(result.owned, false);
    });
  });

  describe('destroy plan with ownership verification', () => {
    it('should not include VMs that fail ownership verification in destroy plan', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('myproject', ['web', 'db']), 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      assert.ok(validationResult.valid);
      const config = await resolveConfig(validationResult.config, configPath);

      const stateManager = new StateManager(configPath);
      await stateManager.create(config.project.name);

      const webId = randomUUID();
      const dbId = randomUUID();
      const webVMName = generateVMName('myproject', 'web', configPath);
      const dbVMName = generateVMName('myproject', 'db', configPath);

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

      // Only web exists in Hyper-V
      const actualVMs: HyperVVM[] = [
        createMockVM(webId, webVMName, generateVMNotes(configPath)),
        // db is NOT in Hyper-V
      ];

      // Act
      const plan = computeDestroyPlan(config, stateManager.getState(), actualVMs, {});

      // Assert - plan should only include web (db doesn't exist in Hyper-V)
      assert.ok(hasActions(plan));
      assert.strictEqual(plan.actions.length, 1);
      assert.strictEqual(plan.actions[0]?.machineName, 'web');
    });
  });
});
