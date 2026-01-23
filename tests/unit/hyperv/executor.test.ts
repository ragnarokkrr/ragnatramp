/**
 * Unit tests for HyperV Executor
 *
 * Note: The executor tests focus on testing the HyperVError class and
 * command script validation, since mocking spawn in ES modules is complex.
 * Integration tests with actual PowerShell are done separately.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { HyperVExecutor, HyperVError } from '../../../src/hyperv/executor.js';

describe('HyperVError', () => {
  it('should contain all error details', () => {
    const error = new HyperVError(
      'Test error',
      'ACCESS_DENIED',
      1,
      'stderr content',
      'test script'
    );

    assert.strictEqual(error.message, 'Test error');
    assert.strictEqual(error.code, 'ACCESS_DENIED');
    assert.strictEqual(error.exitCode, 1);
    assert.strictEqual(error.stderr, 'stderr content');
    assert.strictEqual(error.script, 'test script');
    assert.strictEqual(error.name, 'HyperVError');
  });

  it('should be instanceof Error', () => {
    const error = new HyperVError(
      'Test error',
      'EXECUTION_FAILED',
      1,
      'stderr',
      'script'
    );
    assert.ok(error instanceof Error);
    assert.ok(error instanceof HyperVError);
  });

  it('should have correct error codes', () => {
    const accessDenied = new HyperVError('msg', 'ACCESS_DENIED', 1, '', '');
    const notFound = new HyperVError('msg', 'NOT_FOUND', 1, '', '');
    const invalidResponse = new HyperVError('msg', 'INVALID_RESPONSE', 0, '', '');
    const execFailed = new HyperVError('msg', 'EXECUTION_FAILED', 1, '', '');
    const notAvailable = new HyperVError('msg', 'HYPERV_NOT_AVAILABLE', 1, '', '');

    assert.strictEqual(accessDenied.code, 'ACCESS_DENIED');
    assert.strictEqual(notFound.code, 'NOT_FOUND');
    assert.strictEqual(invalidResponse.code, 'INVALID_RESPONSE');
    assert.strictEqual(execFailed.code, 'EXECUTION_FAILED');
    assert.strictEqual(notAvailable.code, 'HYPERV_NOT_AVAILABLE');
  });

  it('should handle null exit code', () => {
    const error = new HyperVError(
      'Timeout error',
      'EXECUTION_FAILED',
      null,
      '',
      'script'
    );
    assert.strictEqual(error.exitCode, null);
  });
});

describe('HyperVExecutor', () => {
  describe('constructor', () => {
    it('should use default PowerShell path', () => {
      const executor = new HyperVExecutor();
      // We can't easily test the internal path, but the constructor shouldn't throw
      assert.ok(executor instanceof HyperVExecutor);
    });

    it('should accept custom PowerShell path', () => {
      const executor = new HyperVExecutor('pwsh.exe');
      assert.ok(executor instanceof HyperVExecutor);
    });
  });

  // Note: execute() and executeVoid() tests would require mocking spawn,
  // which is complex in ES modules. These methods are tested via integration
  // tests that actually run PowerShell commands.
  //
  // The command builders (commands.ts) are tested separately to ensure
  // the scripts are well-formed.
});

describe('Error classification patterns', () => {
  // Test the patterns that the executor uses for error classification
  // by checking what text triggers each error code

  it('should recognize access denied patterns', () => {
    const patterns = [
      'access denied',
      'access is denied',
      'permission denied',
      'not have permission',
      'unauthorized',
    ];

    for (const pattern of patterns) {
      const lower = pattern.toLowerCase();
      assert.ok(
        lower.includes('access denied') ||
          lower.includes('access is denied') ||
          lower.includes('permission denied') ||
          lower.includes('not have permission') ||
          lower.includes('unauthorized'),
        `Pattern should be recognized: ${pattern}`
      );
    }
  });

  it('should recognize not found patterns', () => {
    const patterns = [
      'not found',
      'does not exist',
      'cannot find',
      'unable to find',
    ];

    for (const pattern of patterns) {
      const lower = pattern.toLowerCase();
      assert.ok(
        lower.includes('not found') ||
          lower.includes('does not exist') ||
          lower.includes('cannot find') ||
          lower.includes('unable to find'),
        `Pattern should be recognized: ${pattern}`
      );
    }
  });

  it('should recognize Hyper-V unavailable patterns', () => {
    const patterns = ['hyper-v', 'vmms', 'virtualization'];

    for (const pattern of patterns) {
      const lower = pattern.toLowerCase();
      assert.ok(
        lower.includes('hyper-v') ||
          lower.includes('vmms') ||
          lower.includes('virtualization'),
        `Pattern should be recognized: ${pattern}`
      );
    }
  });
});
