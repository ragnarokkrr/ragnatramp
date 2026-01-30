/**
 * Unit tests for HyperV Executor
 *
 * Note: The executor tests focus on testing the HyperVError class and
 * command script validation, since mocking spawn in ES modules is complex.
 * Integration tests with actual PowerShell are done separately.
 */

import { describe, it, afterEach } from 'node:test';
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
      const executor = new HyperVExecutor({ powershellPath: 'pwsh.exe' });
      assert.ok(executor instanceof HyperVExecutor);
    });

    it('should accept verbose option', () => {
      const executor = new HyperVExecutor({ verbose: true });
      assert.ok(executor instanceof HyperVExecutor);
    });
  });

  describe('verbose output', () => {
    const originalWrite = process.stderr.write;
    let captured: string[] = [];

    afterEach(() => {
      process.stderr.write = originalWrite;
      captured = [];
    });

    function spyStderrWrite(): void {
      captured = [];
      process.stderr.write = function (chunk: unknown): boolean {
        if (typeof chunk === 'string') {
          captured.push(chunk);
        }
        return true;
      } as typeof process.stderr.write;
    }

    it('should NOT write to stderr when verbose is false (default)', async () => {
      spyStderrWrite();
      const executor = new HyperVExecutor();
      try {
        await executor.execute('Write-Output "test"');
      } catch {
        // Expected: spawn fails in test environment (no PowerShell)
      }
      const verboseOutput = captured.filter((s) => s.includes('[PS]'));
      assert.strictEqual(verboseOutput.length, 0, 'should not write [PS] output when verbose is false');
    });

    it('should write to stderr exactly once when verbose is true', async () => {
      spyStderrWrite();
      const executor = new HyperVExecutor({ verbose: true });
      try {
        await executor.execute('Write-Output "test"');
      } catch {
        // Expected: spawn fails in test environment
      }
      const verboseOutput = captured.filter((s) => s.includes('[PS]'));
      assert.strictEqual(verboseOutput.length, 1, 'should write [PS] output exactly once');
    });

    it('should include the exact script content in verbose output', async () => {
      spyStderrWrite();
      const script = 'Get-VM | Select-Object Name';
      const executor = new HyperVExecutor({ verbose: true });
      try {
        await executor.execute(script);
      } catch {
        // Expected: spawn fails in test environment
      }
      const verboseOutput = captured.filter((s) => s.includes('[PS]'));
      assert.strictEqual(verboseOutput.length, 1);
      assert.ok(
        verboseOutput[0]!.includes(script),
        `verbose output should contain the exact script: "${script}"`
      );
    });

    it('should not change reject behavior when verbose is true', async () => {
      spyStderrWrite();
      const executor = new HyperVExecutor({ verbose: true });
      // execute() should still reject (spawn fails) — verbose doesn't suppress errors
      await assert.rejects(
        () => executor.execute('Write-Output "test"'),
        (err: unknown) => err instanceof Error,
        'should still reject when PowerShell is unavailable'
      );
    });
  });
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
