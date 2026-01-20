/**
 * Unit tests for Configuration Resolver
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadYamlFile } from '../../../src/config/loader.js';
import { validateConfig } from '../../../src/config/validator.js';
import { resolveConfig, expandPath } from '../../../src/config/resolver.js';
import type { RagnatrampConfig } from '../../../src/config/types.js';

const FIXTURES_DIR = join(import.meta.dirname, '../../fixtures');
const VALID_CONFIGS = join(FIXTURES_DIR, 'valid-configs');

async function loadAndValidate(filename: string): Promise<RagnatrampConfig> {
  const data = await loadYamlFile(join(VALID_CONFIGS, filename));
  const result = validateConfig(data);
  if (!result.valid) {
    throw new Error(`Validation failed: ${JSON.stringify(result.errors)}`);
  }
  return result.config;
}

describe('expandPath', () => {
  describe('tilde expansion', () => {
    it('should expand ~ to home directory', () => {
      const result = expandPath('~/test/path', '/base');
      assert.ok(result.startsWith(homedir()));
      assert.ok(result.includes('test'));
      assert.ok(result.includes('path'));
    });

    it('should expand ~/subdir correctly', () => {
      const result = expandPath('~/.ragnatramp/vms', '/base');
      const expected = join(homedir(), '.ragnatramp', 'vms');
      assert.strictEqual(result, expected);
    });
  });

  describe('relative path resolution', () => {
    it('should make relative paths absolute based on basePath', () => {
      const result = expandPath('configs/test.yaml', '/project/root');
      assert.ok(result.includes('project'));
      assert.ok(result.includes('configs'));
      assert.ok(result.includes('test.yaml'));
    });

    it('should leave absolute paths unchanged', () => {
      const absolutePath = 'C:/HyperV/Golden/test.vhdx';
      const result = expandPath(absolutePath, '/some/base');
      assert.strictEqual(result, absolutePath);
    });
  });

  describe('environment variable expansion', () => {
    const originalEnv: Record<string, string | undefined> = {};

    beforeEach(() => {
      // Save original values
      originalEnv['TEST_VAR'] = process.env['TEST_VAR'];
      originalEnv['ANOTHER_VAR'] = process.env['ANOTHER_VAR'];

      // Set test values
      process.env['TEST_VAR'] = 'test-value';
      process.env['ANOTHER_VAR'] = 'another-value';
    });

    afterEach(() => {
      // Restore original values
      if (originalEnv['TEST_VAR'] === undefined) {
        delete process.env['TEST_VAR'];
      } else {
        process.env['TEST_VAR'] = originalEnv['TEST_VAR'];
      }
      if (originalEnv['ANOTHER_VAR'] === undefined) {
        delete process.env['ANOTHER_VAR'];
      } else {
        process.env['ANOTHER_VAR'] = originalEnv['ANOTHER_VAR'];
      }
    });

    it('should expand Windows-style %VAR% variables', () => {
      const result = expandPath('C:/%TEST_VAR%/path', '/base');
      assert.ok(result.includes('test-value'));
    });

    it('should expand Unix-style $VAR variables', () => {
      const result = expandPath('/path/$TEST_VAR/subdir', '/base');
      assert.ok(result.includes('test-value'));
    });

    it('should replace undefined variables with empty string', () => {
      const result = expandPath('/path/$UNDEFINED_VAR/end', '/base');
      assert.ok(result.includes('/path/'));
      assert.ok(result.includes('/end'));
    });
  });
});

describe('resolveConfig', () => {
  describe('defaults application', () => {
    it('should apply default cpu and memory when not specified in machine', async () => {
      const config = await loadAndValidate('minimal.yaml');
      const configPath = join(VALID_CONFIGS, 'minimal.yaml');
      const resolved = await resolveConfig(config, configPath);

      assert.strictEqual(resolved.machines.length, 1);
      const machine = resolved.machines[0];
      assert.ok(machine);
      // Default cpu is 2, default memory is 2048
      assert.strictEqual(machine.cpu, 2);
      assert.strictEqual(machine.memory, 2048);
    });

    it('should use defaults from config when specified', async () => {
      const config = await loadAndValidate('two-vms.yaml');
      const configPath = join(VALID_CONFIGS, 'two-vms.yaml');
      const resolved = await resolveConfig(config, configPath);

      // web machine inherits defaults.cpu=2 but overrides memory=4096
      const webMachine = resolved.machines.find((m) => m.name === 'web');
      assert.ok(webMachine);
      assert.strictEqual(webMachine.cpu, 2); // From defaults
      assert.strictEqual(webMachine.memory, 4096); // Overridden
    });
  });

  describe('per-machine overrides', () => {
    it('should allow machines to override default values', async () => {
      const config = await loadAndValidate('two-vms.yaml');
      const configPath = join(VALID_CONFIGS, 'two-vms.yaml');
      const resolved = await resolveConfig(config, configPath);

      // db machine overrides both cpu and memory
      const dbMachine = resolved.machines.find((m) => m.name === 'db');
      assert.ok(dbMachine);
      assert.strictEqual(dbMachine.cpu, 4); // Overridden from 2
      assert.strictEqual(dbMachine.memory, 8192); // Overridden from 2048
    });

    it('should allow per-machine base_image override', async () => {
      const config = await loadAndValidate('three-vms.yaml');
      const configPath = join(VALID_CONFIGS, 'three-vms.yaml');
      const resolved = await resolveConfig(config, configPath);

      // database machine has its own base_image
      const dbMachine = resolved.machines.find((m) => m.name === 'database');
      assert.ok(dbMachine);
      assert.ok(dbMachine.baseImage.includes('postgres'));

      // frontend uses default base_image
      const frontendMachine = resolved.machines.find(
        (m) => m.name === 'frontend'
      );
      assert.ok(frontendMachine);
      assert.ok(frontendMachine.baseImage.includes('ubuntu'));
    });
  });

  describe('path expansion', () => {
    it('should expand base_image paths', async () => {
      const config = await loadAndValidate('minimal.yaml');
      const configPath = join(VALID_CONFIGS, 'minimal.yaml');
      const resolved = await resolveConfig(config, configPath);

      const machine = resolved.machines[0];
      assert.ok(machine);
      // The path should be absolute (from config or expanded)
      assert.ok(
        machine.baseImage.includes('C:') || machine.baseImage.startsWith('/'),
        `Expected absolute path, got: ${machine.baseImage}`
      );
    });

    it('should set default artifact path when not specified', async () => {
      const config = await loadAndValidate('minimal.yaml');
      const configPath = join(VALID_CONFIGS, 'minimal.yaml');
      const resolved = await resolveConfig(config, configPath);

      // Default artifact path is ~/.ragnatramp/vms/{projectName}
      assert.ok(resolved.artifactPath.includes('.ragnatramp'));
      assert.ok(resolved.artifactPath.includes('vms'));
      assert.ok(resolved.artifactPath.includes('testproject'));
    });

    it('should use custom artifact_path when specified', async () => {
      const config = await loadAndValidate('three-vms.yaml');
      const configPath = join(VALID_CONFIGS, 'three-vms.yaml');
      const resolved = await resolveConfig(config, configPath);

      // three-vms.yaml specifies artifact_path: "~/.ragnatramp/vms/fullstack"
      assert.ok(resolved.artifactPath.includes('.ragnatramp'));
      assert.ok(resolved.artifactPath.includes('fullstack'));
    });
  });

  describe('config hash', () => {
    it('should compute a config hash', async () => {
      const config = await loadAndValidate('minimal.yaml');
      const configPath = join(VALID_CONFIGS, 'minimal.yaml');
      const resolved = await resolveConfig(config, configPath);

      assert.ok(resolved.configHash);
      assert.strictEqual(resolved.configHash.length, 8);
      // Hash should be hexadecimal
      assert.ok(/^[0-9a-f]{8}$/.test(resolved.configHash));
    });

    it('should produce deterministic hash for same file', async () => {
      const config = await loadAndValidate('minimal.yaml');
      const configPath = join(VALID_CONFIGS, 'minimal.yaml');

      const resolved1 = await resolveConfig(config, configPath);
      const resolved2 = await resolveConfig(config, configPath);

      assert.strictEqual(resolved1.configHash, resolved2.configHash);
    });
  });

  describe('auto_start setting', () => {
    it('should default autoStart to true', async () => {
      const config = await loadAndValidate('minimal.yaml');
      const configPath = join(VALID_CONFIGS, 'minimal.yaml');
      const resolved = await resolveConfig(config, configPath);

      assert.strictEqual(resolved.autoStart, true);
    });

    it('should respect explicit auto_start setting', async () => {
      const config = await loadAndValidate('three-vms.yaml');
      const configPath = join(VALID_CONFIGS, 'three-vms.yaml');
      const resolved = await resolveConfig(config, configPath);

      // three-vms.yaml sets auto_start: true explicitly
      assert.strictEqual(resolved.autoStart, true);
    });
  });

  describe('disk strategy', () => {
    it('should default disk strategy to differencing', async () => {
      const config = await loadAndValidate('minimal.yaml');
      const configPath = join(VALID_CONFIGS, 'minimal.yaml');
      const resolved = await resolveConfig(config, configPath);

      const machine = resolved.machines[0];
      assert.ok(machine);
      assert.strictEqual(machine.diskStrategy, 'differencing');
    });

    it('should respect explicit disk_strategy setting', async () => {
      const config = await loadAndValidate('three-vms.yaml');
      const configPath = join(VALID_CONFIGS, 'three-vms.yaml');
      const resolved = await resolveConfig(config, configPath);

      // three-vms.yaml sets disk_strategy: differencing explicitly
      const machine = resolved.machines[0];
      assert.ok(machine);
      assert.strictEqual(machine.diskStrategy, 'differencing');
    });
  });
});
