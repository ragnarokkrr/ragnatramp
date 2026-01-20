/**
 * Unit tests for Configuration Validator
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { join } from 'node:path';
import { loadYamlFile } from '../../../src/config/loader.js';
import {
  validateConfig,
  formatValidationErrors,
} from '../../../src/config/validator.js';

const FIXTURES_DIR = join(import.meta.dirname, '../../fixtures');
const VALID_CONFIGS = join(FIXTURES_DIR, 'valid-configs');
const INVALID_CONFIGS = join(FIXTURES_DIR, 'invalid-configs');

describe('validateConfig', () => {
  describe('valid configurations', () => {
    it('should validate minimal config successfully', async () => {
      const data = await loadYamlFile(join(VALID_CONFIGS, 'minimal.yaml'));
      const result = validateConfig(data);

      assert.strictEqual(result.valid, true);
      if (result.valid) {
        assert.strictEqual(result.config.project.name, 'testproject');
        assert.strictEqual(result.config.machines.length, 1);
        assert.strictEqual(result.config.machines[0]?.name, 'web');
      }
    });

    it('should validate two-vms config successfully', async () => {
      const data = await loadYamlFile(join(VALID_CONFIGS, 'two-vms.yaml'));
      const result = validateConfig(data);

      assert.strictEqual(result.valid, true);
      if (result.valid) {
        assert.strictEqual(result.config.project.name, 'myproject');
        assert.strictEqual(result.config.machines.length, 2);
        assert.strictEqual(result.config.machines[0]?.name, 'web');
        assert.strictEqual(result.config.machines[1]?.name, 'db');
      }
    });

    it('should validate three-vms config with all options', async () => {
      const data = await loadYamlFile(join(VALID_CONFIGS, 'three-vms.yaml'));
      const result = validateConfig(data);

      assert.strictEqual(result.valid, true);
      if (result.valid) {
        assert.strictEqual(result.config.project.name, 'fullstack');
        assert.strictEqual(result.config.machines.length, 3);
        assert.ok(result.config.settings);
        assert.strictEqual(result.config.settings.auto_start, true);
      }
    });
  });

  describe('missing required fields', () => {
    it('should reject config missing machines array', async () => {
      const data = await loadYamlFile(
        join(INVALID_CONFIGS, 'missing-machines.yaml')
      );
      const result = validateConfig(data);

      assert.strictEqual(result.valid, false);
      if (!result.valid) {
        assert.ok(result.errors.length > 0);
        // Should have error about missing 'machines' property
        const hasMachinesError = result.errors.some(
          (e) =>
            e.path === '' ||
            e.path === '/' ||
            e.message.includes('machines') ||
            e.message.includes('required')
        );
        assert.ok(
          hasMachinesError,
          `Expected error about missing machines, got: ${JSON.stringify(result.errors)}`
        );
      }
    });
  });

  describe('invalid types', () => {
    it('should reject config with invalid cpu type (string instead of integer)', async () => {
      const data = await loadYamlFile(
        join(INVALID_CONFIGS, 'invalid-cpu-type.yaml')
      );
      const result = validateConfig(data);

      assert.strictEqual(result.valid, false);
      if (!result.valid) {
        assert.ok(result.errors.length > 0);
        // Should have error about cpu type
        const hasCpuError = result.errors.some(
          (e) =>
            e.path.includes('cpu') ||
            e.message.includes('integer') ||
            e.message.includes('type')
        );
        assert.ok(
          hasCpuError,
          `Expected error about cpu type, got: ${JSON.stringify(result.errors)}`
        );
      }
    });
  });

  describe('missing base_image', () => {
    it('should reject config with no base_image anywhere', async () => {
      const data = await loadYamlFile(
        join(INVALID_CONFIGS, 'missing-base-image.yaml')
      );
      const result = validateConfig(data);

      assert.strictEqual(result.valid, false);
      if (!result.valid) {
        assert.ok(result.errors.length > 0);
        // Should have error about base_image
        const hasBaseImageError = result.errors.some(
          (e) =>
            e.path.includes('base_image') ||
            e.message.includes('base_image') ||
            e.message.includes('required')
        );
        assert.ok(
          hasBaseImageError,
          `Expected error about base_image, got: ${JSON.stringify(result.errors)}`
        );
      }
    });
  });
});

describe('formatValidationErrors', () => {
  it('should format errors with paths and messages', () => {
    const errors = [
      { path: '/project/name', message: 'must be string', params: {} },
      { path: '/machines', message: "must have required property 'name'", params: {} },
    ];

    const formatted = formatValidationErrors(errors);

    assert.ok(formatted.includes('/project/name'));
    assert.ok(formatted.includes('must be string'));
    assert.ok(formatted.includes('/machines'));
    assert.ok(formatted.includes("must have required property 'name'"));
  });

  it('should handle empty path with root indicator', () => {
    const errors = [{ path: '', message: 'invalid', params: {} }];

    const formatted = formatValidationErrors(errors);

    assert.ok(formatted.includes('/'));
    assert.ok(formatted.includes('invalid'));
  });
});
