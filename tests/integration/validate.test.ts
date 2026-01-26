/**
 * Integration tests for the `validate` command
 *
 * Tests configuration validation without Hyper-V dependency.
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

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Create a temporary directory for test files
 */
async function createTempDir(): Promise<string> {
  const dir = join(tmpdir(), `ragnatramp-validate-test-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Create a valid test YAML config
 */
function createValidConfig(projectName: string, machines: string[]): string {
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
 * Create an invalid config missing required fields
 */
function createInvalidConfigMissingMachines(): string {
  return `
project:
  name: testproject
defaults:
  cpu: 2
  memory: 2048
  base_image: C:/HyperV/Golden/base.vhdx
`;
}

/**
 * Create an invalid config with wrong type
 */
function createInvalidConfigWrongType(): string {
  return `
project:
  name: testproject
defaults:
  cpu: "lots"
  memory: 2048
  base_image: C:/HyperV/Golden/base.vhdx
machines:
  - name: web
`;
}

/**
 * Create an invalid config with missing base image
 */
function createInvalidConfigMissingBaseImage(): string {
  return `
project:
  name: testproject
defaults:
  cpu: 2
  memory: 2048
machines:
  - name: web
`;
}

// =============================================================================
// Tests
// =============================================================================

describe('validate command integration', () => {
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

  describe('valid configuration', () => {
    it('should validate a minimal valid config', async () => {
      // Arrange
      const configPath = join(tempDir, 'valid.yaml');
      await writeFile(configPath, createValidConfig('myproject', ['web']), 'utf-8');

      // Act
      const rawConfig = await loadYamlFile(configPath);
      const result = validateConfig(rawConfig);

      // Assert
      assert.ok(result.valid, 'Config should be valid');
      if (result.valid) {
        assert.ok(result.config, 'Should have parsed config');
      }
    });

    it('should validate a multi-machine config', async () => {
      // Arrange
      const configPath = join(tempDir, 'multi.yaml');
      await writeFile(configPath, createValidConfig('devenv', ['web', 'db', 'cache']), 'utf-8');

      // Act
      const rawConfig = await loadYamlFile(configPath);
      const result = validateConfig(rawConfig);

      // Assert
      assert.ok(result.valid, 'Config should be valid');
      assert.strictEqual(result.config.machines.length, 3, 'Should have 3 machines');
    });

    it('should resolve config with defaults applied', async () => {
      // Arrange
      const configPath = join(tempDir, 'resolve.yaml');
      await writeFile(configPath, createValidConfig('testproj', ['worker']), 'utf-8');

      // Act
      const rawConfig = await loadYamlFile(configPath);
      const validationResult = validateConfig(rawConfig);
      assert.ok(validationResult.valid);
      const config = await resolveConfig(validationResult.config, configPath);

      // Assert
      assert.strictEqual(config.project.name, 'testproj');
      assert.strictEqual(config.machines.length, 1);
      const machine = config.machines[0];
      assert.ok(machine);
      assert.strictEqual(machine.name, 'worker');
      assert.strictEqual(machine.cpu, 2);
      assert.strictEqual(machine.memory, 2048);
    });
  });

  describe('invalid configuration - missing machines', () => {
    it('should reject config without machines array', async () => {
      // Arrange
      const configPath = join(tempDir, 'invalid-no-machines.yaml');
      await writeFile(configPath, createInvalidConfigMissingMachines(), 'utf-8');

      // Act
      const rawConfig = await loadYamlFile(configPath);
      const result = validateConfig(rawConfig);

      // Assert
      assert.ok(!result.valid, 'Config should be invalid');
      assert.ok(result.errors.length > 0, 'Should have errors');

      // Check that error mentions machines
      const errorMessages = result.errors.map((e) => e.message.toLowerCase());
      const hasMachinesError = errorMessages.some(
        (msg) => msg.includes('machines') || msg.includes('required')
      );
      assert.ok(hasMachinesError, 'Should have error about missing machines');
    });
  });

  describe('invalid configuration - wrong type', () => {
    it('should reject config with invalid cpu type', async () => {
      // Arrange
      const configPath = join(tempDir, 'invalid-cpu.yaml');
      await writeFile(configPath, createInvalidConfigWrongType(), 'utf-8');

      // Act
      const rawConfig = await loadYamlFile(configPath);
      const result = validateConfig(rawConfig);

      // Assert
      assert.ok(!result.valid, 'Config should be invalid');
      assert.ok(result.errors.length > 0, 'Should have errors');

      // Check that error mentions cpu or type
      const hasTypeError = result.errors.some(
        (e) => e.path.includes('cpu') || e.message.toLowerCase().includes('integer')
      );
      assert.ok(hasTypeError, 'Should have error about cpu type');
    });
  });

  describe('invalid configuration - missing base image', () => {
    it('should reject config without base_image anywhere', async () => {
      // Arrange
      const configPath = join(tempDir, 'invalid-base-image.yaml');
      await writeFile(configPath, createInvalidConfigMissingBaseImage(), 'utf-8');

      // Act
      const rawConfig = await loadYamlFile(configPath);
      const result = validateConfig(rawConfig);

      // Assert
      assert.ok(!result.valid, 'Config should be invalid');
      assert.ok(result.errors.length > 0, 'Should have errors');
    });
  });

  describe('error messages are actionable', () => {
    it('should include field path in error', async () => {
      // Arrange
      const configPath = join(tempDir, 'error-path.yaml');
      await writeFile(configPath, createInvalidConfigWrongType(), 'utf-8');

      // Act
      const rawConfig = await loadYamlFile(configPath);
      const result = validateConfig(rawConfig);

      // Assert
      assert.ok(!result.valid);
      const cpuError = result.errors.find((e) => e.path.includes('cpu'));
      assert.ok(cpuError, 'Should have error with cpu path');
      assert.ok(cpuError.path.length > 0, 'Path should not be empty');
    });

    it('should provide meaningful error message', async () => {
      // Arrange
      const configPath = join(tempDir, 'error-msg.yaml');
      await writeFile(configPath, createInvalidConfigMissingMachines(), 'utf-8');

      // Act
      const rawConfig = await loadYamlFile(configPath);
      const result = validateConfig(rawConfig);

      // Assert
      assert.ok(!result.valid);
      assert.ok(result.errors.length > 0);
      const error = result.errors[0];
      assert.ok(error);
      assert.ok(error.message.length > 5, 'Error message should be descriptive');
    });
  });

  describe('config file handling', () => {
    it('should report file not found for non-existent file', async () => {
      // Arrange
      const configPath = join(tempDir, 'does-not-exist.yaml');

      // Act & Assert
      await assert.rejects(
        () => loadYamlFile(configPath),
        {
          name: 'ConfigLoadError',
        },
        'Should throw ConfigLoadError for missing file'
      );
    });

    it('should report invalid YAML syntax', async () => {
      // Arrange
      const configPath = join(tempDir, 'invalid-yaml.yaml');
      await writeFile(configPath, 'invalid: yaml: syntax: [unclosed', 'utf-8');

      // Act & Assert
      await assert.rejects(
        () => loadYamlFile(configPath),
        {
          name: 'ConfigLoadError',
        },
        'Should throw ConfigLoadError for invalid YAML'
      );
    });
  });
});
