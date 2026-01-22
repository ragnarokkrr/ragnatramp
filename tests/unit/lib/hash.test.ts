/**
 * Unit tests for Hash Utilities
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { join } from 'node:path';
import { computeConfigHash, computeContentHash } from '../../../src/lib/hash.js';

const FIXTURES_DIR = join(import.meta.dirname, '../../fixtures');
const VALID_CONFIGS = join(FIXTURES_DIR, 'valid-configs');

describe('computeContentHash', () => {
  it('should return a string of 8 characters', () => {
    const result = computeContentHash('test content');

    assert.strictEqual(typeof result, 'string');
    assert.strictEqual(result.length, 8);
  });

  it('should be deterministic - same input produces same output', () => {
    const content = 'deterministic test content';
    const hash1 = computeContentHash(content);
    const hash2 = computeContentHash(content);

    assert.strictEqual(hash1, hash2);
  });

  it('should produce different hashes for different inputs', () => {
    const hash1 = computeContentHash('content A');
    const hash2 = computeContentHash('content B');

    assert.notStrictEqual(hash1, hash2);
  });

  it('should produce valid hexadecimal characters', () => {
    const result = computeContentHash('hex test');

    assert.match(result, /^[0-9a-f]{8}$/);
  });

  it('should handle empty string', () => {
    const result = computeContentHash('');

    assert.strictEqual(typeof result, 'string');
    assert.strictEqual(result.length, 8);
    assert.match(result, /^[0-9a-f]{8}$/);
  });

  it('should handle special characters', () => {
    const result = computeContentHash('Special: !@#$%^&*()_+{}|:"<>?[]\\;\',./`~');

    assert.strictEqual(result.length, 8);
    assert.match(result, /^[0-9a-f]{8}$/);
  });

  it('should handle unicode content', () => {
    const result = computeContentHash('Unicode: 日本語 中文 한국어 émojis: 🎉🚀');

    assert.strictEqual(result.length, 8);
    assert.match(result, /^[0-9a-f]{8}$/);
  });
});

describe('computeConfigHash', () => {
  it('should compute hash of file contents', async () => {
    const result = await computeConfigHash(join(VALID_CONFIGS, 'minimal.yaml'));

    assert.strictEqual(typeof result, 'string');
    assert.strictEqual(result.length, 8);
    assert.match(result, /^[0-9a-f]{8}$/);
  });

  it('should be deterministic for same file', async () => {
    const filePath = join(VALID_CONFIGS, 'minimal.yaml');
    const hash1 = await computeConfigHash(filePath);
    const hash2 = await computeConfigHash(filePath);

    assert.strictEqual(hash1, hash2);
  });

  it('should produce different hashes for different files', async () => {
    const hash1 = await computeConfigHash(join(VALID_CONFIGS, 'minimal.yaml'));
    const hash2 = await computeConfigHash(join(VALID_CONFIGS, 'two-vms.yaml'));

    assert.notStrictEqual(hash1, hash2);
  });

  it('should throw error for non-existent file', async () => {
    const nonExistentPath = join(VALID_CONFIGS, 'does-not-exist.yaml');

    await assert.rejects(
      async () => computeConfigHash(nonExistentPath),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        return true;
      }
    );
  });
});
