/**
 * Integration tests for the `status` command
 *
 * Tests the status display functionality with mocked Hyper-V state.
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
import { generateVMName, generateVMNotes } from '../../src/core/naming.js';
import type { HyperVVM } from '../../src/hyperv/types.js';
import type { VMState } from '../../src/state/types.js';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a temporary directory for test files
 */
async function createTempDir(): Promise<string> {
  const dir = join(tmpdir(), `ragnatramp-status-test-${randomUUID()}`);
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

/**
 * Simulate status computation logic (mirrors what status command does)
 * This allows us to test the logic without calling actual Hyper-V
 */
interface VMStatusInfo {
  machineName: string;
  vmName: string;
  state: string;
  cpu: number;
  memoryMB: number;
  missing: boolean;
}

function computeStatusFromState(
  stateVMs: Record<string, VMState>,
  actualVMs: Map<string, HyperVVM>
): VMStatusInfo[] {
  const statuses: VMStatusInfo[] = [];

  for (const [machineName, vmState] of Object.entries(stateVMs)) {
    const actualVM = actualVMs.get(vmState.id);

    if (!actualVM) {
      // VM is in state but not found in Hyper-V
      statuses.push({
        machineName,
        vmName: vmState.name,
        state: 'Missing',
        cpu: 0,
        memoryMB: 0,
        missing: true,
      });
    } else {
      statuses.push({
        machineName,
        vmName: actualVM.Name,
        state: actualVM.State,
        cpu: actualVM.CPUCount,
        memoryMB: actualVM.MemoryMB,
        missing: false,
      });
    }
  }

  return statuses;
}

// =============================================================================
// Tests
// =============================================================================

describe('status command integration', () => {
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

  describe('shows running VMs', () => {
    it('should show Running state for running VMs', async () => {
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
      const actualVMs = new Map<string, HyperVVM>();
      actualVMs.set(webId, createMockVM(webId, webVMName, 'Running', notes, 2, 2048));
      actualVMs.set(dbId, createMockVM(dbId, dbVMName, 'Running', notes, 2, 2048));

      // Act
      const statuses = computeStatusFromState(stateManager.getVMs(), actualVMs);

      // Assert
      assert.strictEqual(statuses.length, 2, 'Should have 2 VMs');

      const webStatus = statuses.find((s) => s.machineName === 'web');
      assert.ok(webStatus, 'Should have web VM status');
      assert.strictEqual(webStatus.state, 'Running', 'web should be Running');
      assert.strictEqual(webStatus.missing, false, 'web should not be missing');
      assert.strictEqual(webStatus.cpu, 2);
      assert.strictEqual(webStatus.memoryMB, 2048);

      const dbStatus = statuses.find((s) => s.machineName === 'db');
      assert.ok(dbStatus, 'Should have db VM status');
      assert.strictEqual(dbStatus.state, 'Running', 'db should be Running');
      assert.strictEqual(dbStatus.missing, false, 'db should not be missing');
    });

    it('should show Off state for stopped VMs', async () => {
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

      // VM is Off
      const actualVMs = new Map<string, HyperVVM>();
      actualVMs.set(webId, createMockVM(webId, webVMName, 'Off', notes, 2, 2048));

      // Act
      const statuses = computeStatusFromState(stateManager.getVMs(), actualVMs);

      // Assert
      assert.strictEqual(statuses.length, 1);
      const webStatus = statuses[0];
      assert.ok(webStatus);
      assert.strictEqual(webStatus.state, 'Off', 'web should be Off');
      assert.strictEqual(webStatus.missing, false);
    });

    it('should show different states for mixed VM states', async () => {
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

      // Mixed states
      const actualVMs = new Map<string, HyperVVM>();
      actualVMs.set(webId, createMockVM(webId, generateVMName('myproject', 'web', configPath), 'Running', notes));
      actualVMs.set(dbId, createMockVM(dbId, generateVMName('myproject', 'db', configPath), 'Off', notes));
      actualVMs.set(cacheId, createMockVM(cacheId, generateVMName('myproject', 'cache', configPath), 'Saved', notes));

      // Act
      const statuses = computeStatusFromState(stateManager.getVMs(), actualVMs);

      // Assert
      assert.strictEqual(statuses.length, 3);

      const webStatus = statuses.find((s) => s.machineName === 'web');
      const dbStatus = statuses.find((s) => s.machineName === 'db');
      const cacheStatus = statuses.find((s) => s.machineName === 'cache');

      assert.ok(webStatus && dbStatus && cacheStatus);
      assert.strictEqual(webStatus.state, 'Running');
      assert.strictEqual(dbStatus.state, 'Off');
      assert.strictEqual(cacheStatus.state, 'Saved');
    });
  });

  describe('shows missing VMs', () => {
    it('should show Missing state for VM in state but not in Hyper-V', async () => {
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

      // Only web exists in Hyper-V, db is missing
      const actualVMs = new Map<string, HyperVVM>();
      actualVMs.set(webId, createMockVM(webId, webVMName, 'Running', notes));
      // db is NOT in actualVMs - simulates VM deleted outside ragnatramp

      // Act
      const statuses = computeStatusFromState(stateManager.getVMs(), actualVMs);

      // Assert
      assert.strictEqual(statuses.length, 2);

      const webStatus = statuses.find((s) => s.machineName === 'web');
      const dbStatus = statuses.find((s) => s.machineName === 'db');

      assert.ok(webStatus, 'Should have web status');
      assert.strictEqual(webStatus.state, 'Running');
      assert.strictEqual(webStatus.missing, false);

      assert.ok(dbStatus, 'Should have db status');
      assert.strictEqual(dbStatus.state, 'Missing', 'db should show Missing');
      assert.strictEqual(dbStatus.missing, true, 'db should be marked as missing');
      assert.strictEqual(dbStatus.cpu, 0, 'Missing VM should have 0 CPU');
      assert.strictEqual(dbStatus.memoryMB, 0, 'Missing VM should have 0 memory');
    });

    it('should show all VMs as Missing when all are deleted', async () => {
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

      await stateManager.save();

      // No VMs in Hyper-V - all deleted externally
      const actualVMs = new Map<string, HyperVVM>();

      // Act
      const statuses = computeStatusFromState(stateManager.getVMs(), actualVMs);

      // Assert
      assert.strictEqual(statuses.length, 2);

      for (const status of statuses) {
        assert.strictEqual(status.state, 'Missing', `${status.machineName} should be Missing`);
        assert.strictEqual(status.missing, true);
      }
    });
  });

  describe('no state file', () => {
    it('should handle non-existent state gracefully', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('myproject', ['web']), 'utf-8');

      const stateManager = new StateManager(configPath);

      // Act
      const exists = await stateManager.exists();

      // Assert
      assert.strictEqual(exists, false, 'State should not exist');
      // In the actual command, this would display "No VMs have been created yet"
    });
  });

  describe('empty state', () => {
    it('should handle state with no VMs', async () => {
      // Arrange
      const configPath = join(tempDir, 'ragnatramp.yaml');
      await writeFile(configPath, createTestConfig('myproject', ['web']), 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      assert.ok(validationResult.valid);
      const config = await resolveConfig(validationResult.config, configPath);

      const stateManager = new StateManager(configPath);
      await stateManager.create(config.project.name);
      // Don't add any VMs
      await stateManager.save();

      // Act
      const vmCount = Object.keys(stateManager.getVMs()).length;

      // Assert
      assert.strictEqual(vmCount, 0, 'Should have no VMs in state');
      // In the actual command, this would display "No VMs managed for project"
    });
  });

  describe('CPU and memory display', () => {
    it('should show correct CPU and memory values', async () => {
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
      const webVMName = generateVMName('myproject', 'web', configPath);
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

      // VM with custom CPU/memory
      const actualVMs = new Map<string, HyperVVM>();
      actualVMs.set(webId, createMockVM(webId, webVMName, 'Running', notes, 4, 8192));

      // Act
      const statuses = computeStatusFromState(stateManager.getVMs(), actualVMs);

      // Assert
      assert.strictEqual(statuses.length, 1);
      const webStatus = statuses[0];
      assert.ok(webStatus);
      assert.strictEqual(webStatus.cpu, 4, 'Should show 4 CPUs');
      assert.strictEqual(webStatus.memoryMB, 8192, 'Should show 8192 MB memory');
    });
  });
});
