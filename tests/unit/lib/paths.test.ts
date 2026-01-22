/**
 * Unit tests for Path Utilities
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import {
  expandPath,
  getStatePath,
  getStateDir,
  getDefaultArtifactPath,
} from '../../../src/lib/paths.js';

describe('expandPath', () => {
  describe('tilde expansion', () => {
    it('should expand ~ to home directory', () => {
      const result = expandPath('~', '/base');

      assert.strictEqual(result, homedir());
    });

    it('should expand ~/path to home directory path', () => {
      const result = expandPath('~/some/path', '/base');

      assert.strictEqual(result, join(homedir(), 'some/path'));
    });

    it('should expand ~\\path on Windows-style paths', () => {
      const result = expandPath('~\\some\\path', '/base');

      // On Windows, join will normalize the separators
      const expected = join(homedir(), 'some\\path');
      assert.strictEqual(result, expected);
    });
  });

  describe('relative path resolution', () => {
    it('should resolve relative path against base path', () => {
      const basePath = resolve('/project/config');
      const result = expandPath('relative/file.txt', basePath);

      assert.strictEqual(result, resolve(basePath, 'relative/file.txt'));
    });

    it('should preserve absolute paths', () => {
      // Use platform-appropriate absolute path
      const absolutePath = process.platform === 'win32'
        ? 'C:\\absolute\\path'
        : '/absolute/path';
      const result = expandPath(absolutePath, '/base');

      assert.strictEqual(result, absolutePath);
    });

    it('should resolve . as current directory', () => {
      const basePath = resolve('/project/config');
      const result = expandPath('.', basePath);

      assert.strictEqual(result, basePath);
    });

    it('should resolve .. as parent directory', () => {
      const basePath = resolve('/project/config');
      const result = expandPath('..', basePath);

      assert.strictEqual(result, resolve(basePath, '..'));
    });
  });

  describe('environment variable expansion', () => {
    const originalEnv: Record<string, string | undefined> = {};

    beforeEach(() => {
      // Save original values
      originalEnv['TEST_VAR'] = process.env['TEST_VAR'];
      originalEnv['ANOTHER_VAR'] = process.env['ANOTHER_VAR'];

      // Set test values
      process.env['TEST_VAR'] = 'test_value';
      process.env['ANOTHER_VAR'] = 'another_value';
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

    it('should expand Windows-style %VAR% environment variables', () => {
      const basePath = resolve('/base');
      const result = expandPath('%TEST_VAR%/path', basePath);

      assert.strictEqual(result, resolve(basePath, 'test_value/path'));
    });

    it('should expand Unix-style $VAR environment variables', () => {
      const basePath = resolve('/base');
      const result = expandPath('$TEST_VAR/path', basePath);

      assert.strictEqual(result, resolve(basePath, 'test_value/path'));
    });

    it('should expand multiple environment variables', () => {
      const basePath = resolve('/base');
      const result = expandPath('%TEST_VAR%/$ANOTHER_VAR/end', basePath);

      assert.strictEqual(result, resolve(basePath, 'test_value/another_value/end'));
    });

    it('should replace undefined env vars with empty string', () => {
      const basePath = resolve('/base');
      const result = expandPath('%UNDEFINED_VAR%/path', basePath);

      // After replacing undefined var with empty string, we get '/path'
      // '/path' is considered absolute by isAbsolute() on both platforms,
      // so it's returned unchanged
      assert.strictEqual(result, '/path');
    });
  });
});

describe('getStatePath', () => {
  it('should return state.json path relative to config', () => {
    const configPath = resolve('/project/ragnatramp.yaml');
    const result = getStatePath(configPath);

    assert.strictEqual(result, join(resolve('/project'), '.ragnatramp', 'state.json'));
  });

  it('should handle config in subdirectory', () => {
    const configPath = resolve('/project/config/ragnatramp.yaml');
    const result = getStatePath(configPath);

    assert.strictEqual(result, join(resolve('/project/config'), '.ragnatramp', 'state.json'));
  });

  it('should resolve relative config paths', () => {
    const configPath = 'ragnatramp.yaml';
    const result = getStatePath(configPath);

    const expectedDir = resolve(configPath, '..');
    assert.strictEqual(result, join(expectedDir, '.ragnatramp', 'state.json'));
  });
});

describe('getStateDir', () => {
  it('should return .ragnatramp directory path', () => {
    const configPath = resolve('/project/ragnatramp.yaml');
    const result = getStateDir(configPath);

    assert.strictEqual(result, join(resolve('/project'), '.ragnatramp'));
  });

  it('should handle config in subdirectory', () => {
    const configPath = resolve('/project/config/ragnatramp.yaml');
    const result = getStateDir(configPath);

    assert.strictEqual(result, join(resolve('/project/config'), '.ragnatramp'));
  });
});

describe('getDefaultArtifactPath', () => {
  it('should return path under home directory', () => {
    const result = getDefaultArtifactPath('myproject');

    assert.strictEqual(result, join(homedir(), '.ragnatramp', 'vms', 'myproject'));
  });

  it('should handle project names with special characters', () => {
    const result = getDefaultArtifactPath('my-project_2');

    assert.strictEqual(result, join(homedir(), '.ragnatramp', 'vms', 'my-project_2'));
  });
});
