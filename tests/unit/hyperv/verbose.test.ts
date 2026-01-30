/**
 * Unit tests for verbose output helpers
 *
 * Tests formatCommand() and supportsAnsi() from src/hyperv/verbose.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { formatCommand, supportsAnsi } from '../../../src/hyperv/verbose.js';

describe('formatCommand', () => {
  describe('single-line script', () => {
    it('should prefix with [PS] ', () => {
      const result = formatCommand('Get-VM', false);
      assert.ok(result.includes('[PS] Get-VM'));
    });

    it('should have blank line before the command', () => {
      const result = formatCommand('Get-VM', false);
      assert.ok(result.startsWith('\n'), 'should start with blank line');
    });

    it('should have blank line after the command', () => {
      const result = formatCommand('Get-VM', false);
      assert.ok(result.endsWith('\n'), 'should end with blank line');
      // The structure is: \n[PS] Get-VM\n\n
      // Count trailing newlines: body line ends with \n, then fence adds \n
      const lines = result.split('\n');
      // First element is empty (leading \n), then command, then two empty (trailing \n\n)
      assert.strictEqual(lines[lines.length - 1], '', 'last element should be empty (trailing newline)');
    });

    it('should produce expected exact format', () => {
      const result = formatCommand('Get-VM', false);
      assert.strictEqual(result, '\n[PS] Get-VM\n\n');
    });
  });

  describe('multi-line script', () => {
    it('should prefix first line with [PS] ', () => {
      const script = '$vms = Get-VM\n$vms | Select-Object Name';
      const result = formatCommand(script, false);
      assert.ok(result.includes('[PS] $vms = Get-VM'));
    });

    it('should indent continuation lines with 5 spaces', () => {
      const script = '$vms = Get-VM\n$vms | Select-Object Name';
      const result = formatCommand(script, false);
      assert.ok(result.includes('     $vms | Select-Object Name'));
    });

    it('should have blank line fence around multi-line block', () => {
      const script = 'line1\nline2\nline3';
      const result = formatCommand(script, false);
      assert.strictEqual(
        result,
        '\n[PS] line1\n     line2\n     line3\n\n'
      );
    });

    it('should match prefix width (5 chars) for continuation indent', () => {
      const script = 'first\nsecond';
      const result = formatCommand(script, false);
      const lines = result.split('\n');
      // lines[0] = '' (leading blank), lines[1] = '[PS] first', lines[2] = '     second', lines[3] = '', lines[4] = ''
      const prefixLine = lines[1]!;
      const continuationLine = lines[2]!;
      // [PS] is 5 chars, indent is 5 spaces — content starts at same column
      const prefixContentStart = prefixLine.indexOf('first');
      const contContentStart = continuationLine.indexOf('second');
      assert.strictEqual(prefixContentStart, contContentStart, 'content should align');
      assert.strictEqual(prefixContentStart, 5, 'content starts at column 5');
    });
  });

  describe('ANSI wrapping', () => {
    it('should wrap in gray ANSI codes when ansi is true', () => {
      const result = formatCommand('Get-VM', true);
      assert.ok(result.includes('\x1b[90m'), 'should contain ANSI gray (SGR 90)');
      assert.ok(result.includes('\x1b[0m'), 'should contain ANSI reset (SGR 0)');
    });

    it('should start with ANSI gray and end with ANSI reset', () => {
      const result = formatCommand('Get-VM', true);
      assert.ok(result.startsWith('\x1b[90m'), 'should start with gray');
      assert.ok(result.endsWith('\x1b[0m'), 'should end with reset');
    });

    it('should contain no ANSI sequences when ansi is false', () => {
      const result = formatCommand('Get-VM', false);
      assert.ok(!result.includes('\x1b['), 'should not contain any ANSI escape sequences');
      assert.ok(!result.includes('\x1b[90m'), 'should not contain gray');
      assert.ok(!result.includes('\x1b[0m'), 'should not contain reset');
    });

    it('should produce identical content between ansi true and false (ignoring escapes)', () => {
      const plain = formatCommand('Get-VM', false);
      const ansi = formatCommand('Get-VM', true);
      // Strip ANSI codes from the ansi version
      const stripped = ansi.replace(/\x1b\[[0-9;]*m/g, '');
      assert.strictEqual(stripped, plain);
    });
  });
});

describe('supportsAnsi', () => {
  it('should return a boolean', () => {
    const result = supportsAnsi();
    assert.strictEqual(typeof result, 'boolean');
  });
});
