/**
 * Integration tests for the `up` command
 *
 * Tests the full workflow from loading config to executing actions.
 * Uses mocked PowerShell responses to avoid actual Hyper-V calls.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { loadYamlFile } from '../../src/config/loader.js';
import { validateConfig } from '../../src/config/validator.js';
import { resolveConfig } from '../../src/config/resolver.js';
import { StateManager } from '../../src/state/manager.js';
import { computePlan, hasActions } from '../../src/core/planner.js';
import { executeActions } from '../../src/core/reconciler.js';
import { generateVMName, generateVMNotes } from '../../src/core/naming.js';
import type { HyperVVM, CreateVMResult } from '../../src/hyperv/types.js';
import type { ResolvedConfig } from '../../src/config/types.js';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a temporary directory for test files
 */
async function createTempDir(): Promise<string> {
  const dir = join(tmpdir(), `ragnatramp-test-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Create a minimal test YAML config
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
 * Mock HyperVExecutor that tracks executed scripts and returns mocked responses
 */
class MockHyperVExecutor {
  executedScripts: string[] = [];
  private createdVMs: Map<string, HyperVVM> = new Map();
  private vmCounter = 0;

  async execute<T>(script: string): Promise<T> {
    this.executedScripts.push(script);

    // Parse what command is being executed
    if (script.includes('New-VM')) {
      // Extract VM name from script
      const nameMatch = script.match(/-Name\s+'([^']+)'/);
      const vmName = nameMatch?.[1] ?? `vm-${this.vmCounter++}`;

      const result: CreateVMResult = {
        Id: randomUUID(),
        Name: vmName,
      };

      // Track created VM
      const vm: HyperVVM = {
        Id: result.Id,
        Name: result.Name,
        State: 'Running', // Script includes Start-VM
        Notes: '',
        CPUCount: 2,
        MemoryMB: 2048,
      };
      this.createdVMs.set(vmName, vm);

      return result as T;
    }

    if (script.includes('Get-VM') && !script.includes('-Name') && !script.includes('-Id')) {
      // Return all created VMs
      const vms = Array.from(this.createdVMs.values());
      return vms as T;
    }

    // Default: return empty result
    return {} as T;
  }

  async executeVoid(script: string): Promise<void> {
    this.executedScripts.push(script);

    // Update VM state for Start-VM calls
    if (script.includes('Start-VM')) {
      const idMatch = script.match(/-Id\s+'([^']+)'/);
      if (idMatch) {
        for (const vm of this.createdVMs.values()) {
          if (vm.Id === idMatch[1]) {
            vm.State = 'Running';
            break;
          }
        }
      }
    }
  }

  getCreatedVMs(): HyperVVM[] {
    return Array.from(this.createdVMs.values());
  }

  reset(): void {
    this.executedScripts = [];
    this.createdVMs.clear();
    this.vmCounter = 0;
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('up command integration', () => {
  let tempDir: string;
  let configPath: string;
  let mockExecutor: MockHyperVExecutor;

  beforeEach(async () => {
    tempDir = await createTempDir();
    configPath = join(tempDir, 'ragnatramp.yaml');
    mockExecutor = new MockHyperVExecutor();
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('T072: creates VMs when none exist', () => {
    it('should create all VMs defined in config', async () => {
      // Arrange: Create test config with 2 VMs
      const yamlContent = createTestConfig('myproject', ['web', 'db']);
      await writeFile(configPath, yamlContent, 'utf-8');

      // Load and resolve config
      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      assert.ok(validationResult.valid, 'Config should be valid');
      const config = await resolveConfig(validationResult.config, configPath);

      // Create state manager (no existing state)
      const stateManager = new StateManager(configPath);
      const state = await stateManager.create(config.project.name);

      // No existing VMs in Hyper-V
      const actualVMs: HyperVVM[] = [];

      // Act: Compute plan and execute
      const plan = computePlan(config, state, actualVMs);

      assert.ok(hasActions(plan), 'Plan should have actions');
      assert.strictEqual(plan.actions.length, 2, 'Should have 2 create actions');
      assert.strictEqual(plan.summary.create, 2, 'Summary should show 2 creates');

      // Execute actions
      const result = await executeActions(
        plan.actions,
        mockExecutor as unknown as import('../../src/hyperv/executor.js').HyperVExecutor,
        stateManager
      );

      // Assert
      assert.ok(result.success, 'All actions should succeed');
      assert.strictEqual(result.summary.succeeded, 2, 'Should have 2 successful actions');
      assert.strictEqual(result.summary.failed, 0, 'Should have 0 failed actions');

      // Verify VMs were created
      const createdVMs = mockExecutor.getCreatedVMs();
      assert.strictEqual(createdVMs.length, 2, 'Should have created 2 VMs');

      // Verify VM names follow pattern
      const expectedWebName = generateVMName('myproject', 'web', configPath);
      const expectedDbName = generateVMName('myproject', 'db', configPath);

      const vmNames = createdVMs.map((vm) => vm.Name);
      assert.ok(vmNames.includes(expectedWebName), `Should have VM named ${expectedWebName}`);
      assert.ok(vmNames.includes(expectedDbName), `Should have VM named ${expectedDbName}`);

      // Verify state was updated
      const webState = stateManager.getVM('web');
      const dbState = stateManager.getVM('db');
      assert.ok(webState, 'web VM should be in state');
      assert.ok(dbState, 'db VM should be in state');
      assert.strictEqual(webState.name, expectedWebName);
      assert.strictEqual(dbState.name, expectedDbName);

      // Verify PowerShell scripts were executed
      assert.ok(
        mockExecutor.executedScripts.some((s) => s.includes('New-VM') && s.includes(expectedWebName)),
        'Should have executed New-VM for web'
      );
      assert.ok(
        mockExecutor.executedScripts.some((s) => s.includes('New-VM') && s.includes(expectedDbName)),
        'Should have executed New-VM for db'
      );
    });

    it('should create state file after first run', async () => {
      // Arrange
      const yamlContent = createTestConfig('testproj', ['worker']);
      await writeFile(configPath, yamlContent, 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      const config = await resolveConfig(validationResult.config, configPath);

      const stateManager = new StateManager(configPath);
      const state = await stateManager.create(config.project.name);

      // Act
      const plan = computePlan(config, state, []);
      await executeActions(
        plan.actions,
        mockExecutor as unknown as import('../../src/hyperv/executor.js').HyperVExecutor,
        stateManager
      );

      // Assert: State file should exist and be valid JSON
      const statePath = join(dirname(configPath), '.ragnatramp', 'state.json');
      const stateContent = await readFile(statePath, 'utf-8');
      const parsedState = JSON.parse(stateContent);

      assert.strictEqual(parsedState.project, 'testproj');
      assert.ok(parsedState.vms.worker, 'Should have worker VM in state');
    });
  });

  describe('T073: idempotent re-run does nothing', () => {
    it('should not create actions when VMs already exist and are running', async () => {
      // Arrange: Create test config
      const yamlContent = createTestConfig('myproject', ['web', 'db']);
      await writeFile(configPath, yamlContent, 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      const config = await resolveConfig(validationResult.config, configPath);

      // Create state manager with existing VMs
      const stateManager = new StateManager(configPath);
      const state = await stateManager.create(config.project.name);

      // Simulate first run - add VMs to state
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

      // Act: Compute plan for second run
      const plan = computePlan(config, stateManager.getState(), actualVMs);

      // Assert: No actions needed
      assert.ok(!hasActions(plan), 'Plan should have no actions');
      assert.strictEqual(plan.actions.length, 0, 'Should have 0 actions');
      assert.strictEqual(plan.summary.unchanged, 2, 'Should show 2 unchanged');
    });

    it('should only start stopped VMs on re-run', async () => {
      // Arrange
      const yamlContent = createTestConfig('myproject', ['web', 'db']);
      await writeFile(configPath, yamlContent, 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      const config = await resolveConfig(validationResult.config, configPath);

      const stateManager = new StateManager(configPath);
      const state = await stateManager.create(config.project.name);

      // VMs exist in state
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

      // web is Running, db is Off
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
          State: 'Off',
          Notes: generateVMNotes(configPath),
          CPUCount: 2,
          MemoryMB: 2048,
        },
      ];

      // Act: Compute plan
      const plan = computePlan(config, stateManager.getState(), actualVMs);

      // Assert: Should only have start action for db
      assert.strictEqual(plan.actions.length, 1, 'Should have 1 action');
      assert.strictEqual(plan.summary.start, 1, 'Should have 1 start');
      assert.strictEqual(plan.summary.unchanged, 1, 'Should have 1 unchanged');

      const action = plan.actions[0];
      assert.ok(action);
      assert.strictEqual(action.type, 'start');
      assert.strictEqual(action.machineName, 'db');
    });

    it('should recreate VMs missing from Hyper-V but present in state', async () => {
      // Arrange
      const yamlContent = createTestConfig('myproject', ['web']);
      await writeFile(configPath, yamlContent, 'utf-8');

      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      const config = await resolveConfig(validationResult.config, configPath);

      const stateManager = new StateManager(configPath);
      const state = await stateManager.create(config.project.name);

      // VM in state
      const webVMName = generateVMName('myproject', 'web', configPath);
      const webId = randomUUID();

      stateManager.addVM('web', {
        id: webId,
        name: webVMName,
        machineName: 'web',
        diskPath: join(config.artifactPath, 'web.vhdx'),
        createdAt: new Date().toISOString(),
        checkpoints: [],
      });

      await stateManager.save();

      // But VM is not in Hyper-V (was deleted externally)
      const actualVMs: HyperVVM[] = [];

      // Act: Compute plan
      const plan = computePlan(config, stateManager.getState(), actualVMs);

      // Assert: Should recreate the VM
      assert.strictEqual(plan.actions.length, 1, 'Should have 1 action');
      assert.strictEqual(plan.summary.create, 1, 'Should have 1 create');

      const action = plan.actions[0];
      assert.ok(action);
      assert.strictEqual(action.type, 'create');
      assert.strictEqual(action.machineName, 'web');
    });
  });
});
