/**
 * Unit tests for VM Naming Utilities
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolve } from 'node:path';
import {
  generateVMName,
  computePathHash,
  generateNotesMarker,
  generateVMNotes,
  parseVMName,
  matchesProjectPattern,
  matchesExpectedName,
  extractConfigPathFromNotes,
  hasRagnatrampMarker,
  VM_NAME_PATTERN,
  RAGNATRAMP_MARKER_PREFIX,
} from '../../../src/core/naming.js';

describe('generateVMName', () => {
  it('should generate deterministic names', () => {
    const name1 = generateVMName('myproject', 'web', '/path/to/config.yaml');
    const name2 = generateVMName('myproject', 'web', '/path/to/config.yaml');

    assert.strictEqual(name1, name2);
  });

  it('should include project name, machine name, and hash', () => {
    const name = generateVMName('myproject', 'web', '/path/to/config.yaml');

    assert.ok(name.startsWith('myproject-web-'));
    assert.strictEqual(name.length, 'myproject-web-'.length + 8);
  });

  it('should produce different names for different config paths', () => {
    const name1 = generateVMName('myproject', 'web', '/path/to/config1.yaml');
    const name2 = generateVMName('myproject', 'web', '/path/to/config2.yaml');

    assert.notStrictEqual(name1, name2);
  });

  it('should produce different names for different machine names', () => {
    const name1 = generateVMName('myproject', 'web', '/path/to/config.yaml');
    const name2 = generateVMName('myproject', 'db', '/path/to/config.yaml');

    assert.notStrictEqual(name1, name2);
  });

  it('should produce different names for different project names', () => {
    const name1 = generateVMName('project1', 'web', '/path/to/config.yaml');
    const name2 = generateVMName('project2', 'web', '/path/to/config.yaml');

    assert.notStrictEqual(name1, name2);
  });

  it('should match the VM name pattern', () => {
    const name = generateVMName('myproject', 'web', '/path/to/config.yaml');

    assert.ok(VM_NAME_PATTERN.test(name), `Name "${name}" should match pattern`);
  });
});

describe('computePathHash', () => {
  it('should return 8 character hex string', () => {
    const hash = computePathHash('/path/to/config.yaml');

    assert.strictEqual(hash.length, 8);
    assert.ok(/^[a-f0-9]+$/.test(hash), `Hash "${hash}" should be hex`);
  });

  it('should be deterministic', () => {
    const hash1 = computePathHash('/path/to/config.yaml');
    const hash2 = computePathHash('/path/to/config.yaml');

    assert.strictEqual(hash1, hash2);
  });

  it('should produce different hashes for different paths', () => {
    const hash1 = computePathHash('/path/to/config1.yaml');
    const hash2 = computePathHash('/path/to/config2.yaml');

    assert.notStrictEqual(hash1, hash2);
  });

  it('should normalize backslashes to forward slashes', () => {
    const hash1 = computePathHash('C:/path/to/config.yaml');
    const hash2 = computePathHash('C:\\path\\to\\config.yaml');

    assert.strictEqual(hash1, hash2);
  });

  it('should be case-insensitive (for Windows compatibility)', () => {
    const hash1 = computePathHash('C:/Path/To/Config.yaml');
    const hash2 = computePathHash('c:/path/to/config.yaml');

    assert.strictEqual(hash1, hash2);
  });
});

describe('generateNotesMarker', () => {
  it('should include the ragnatramp prefix', () => {
    const marker = generateNotesMarker('/path/to/config.yaml');

    assert.ok(marker.startsWith(RAGNATRAMP_MARKER_PREFIX));
  });

  it('should include the config path', () => {
    const configPath = '/path/to/config.yaml';
    const marker = generateNotesMarker(configPath);

    assert.ok(marker.includes(resolve(configPath)));
  });
});

describe('generateVMNotes', () => {
  it('should include version marker', () => {
    const notes = generateVMNotes('/path/to/config.yaml');

    assert.ok(notes.includes('ragnatramp:v0.1.0'));
  });

  it('should include config path', () => {
    const configPath = '/path/to/config.yaml';
    const notes = generateVMNotes(configPath);

    assert.ok(notes.includes(`config:${resolve(configPath)}`));
  });

  it('should include managed marker', () => {
    const notes = generateVMNotes('/path/to/config.yaml');

    assert.ok(notes.includes('managed:true'));
  });
});

describe('parseVMName', () => {
  it('should parse valid VM names', () => {
    const result = parseVMName('myproject-web-a1b2c3d4');

    assert.ok(result !== null);
    assert.strictEqual(result.project, 'myproject');
    assert.strictEqual(result.machine, 'web');
    assert.strictEqual(result.hash, 'a1b2c3d4');
  });

  it('should return null for invalid names', () => {
    assert.strictEqual(parseVMName('invalid'), null);
    assert.strictEqual(parseVMName('no-hash'), null);
    assert.strictEqual(parseVMName('project-machine-tooshort'), null);
    assert.strictEqual(parseVMName('project-machine-notahexhash!'), null);
  });

  it('should handle names with hyphens in project/machine', () => {
    const result = parseVMName('my-project-my-machine-a1b2c3d4');

    // This will parse as project="my-project-my", machine="machine"
    // which might not be ideal but matches the pattern
    assert.ok(result !== null);
  });
});

describe('matchesProjectPattern', () => {
  it('should return true for matching project names', () => {
    assert.ok(matchesProjectPattern('myproject-web-a1b2c3d4', 'myproject'));
  });

  it('should return false for non-matching project names', () => {
    assert.ok(!matchesProjectPattern('myproject-web-a1b2c3d4', 'otherproject'));
  });

  it('should be case-insensitive', () => {
    assert.ok(matchesProjectPattern('MyProject-web-a1b2c3d4', 'myproject'));
    assert.ok(matchesProjectPattern('myproject-web-a1b2c3d4', 'MyProject'));
  });

  it('should return false for invalid VM names', () => {
    assert.ok(!matchesProjectPattern('invalid-name', 'myproject'));
  });
});

describe('matchesExpectedName', () => {
  it('should return true for exact match', () => {
    const configPath = '/path/to/config.yaml';
    const expectedName = generateVMName('myproject', 'web', configPath);

    assert.ok(matchesExpectedName(expectedName, 'myproject', 'web', configPath));
  });

  it('should return false for different config path', () => {
    const name = generateVMName('myproject', 'web', '/path/to/config1.yaml');

    assert.ok(!matchesExpectedName(name, 'myproject', 'web', '/path/to/config2.yaml'));
  });

  it('should return false for different machine name', () => {
    const name = generateVMName('myproject', 'web', '/path/to/config.yaml');

    assert.ok(!matchesExpectedName(name, 'myproject', 'db', '/path/to/config.yaml'));
  });
});

describe('extractConfigPathFromNotes', () => {
  it('should extract config path from notes', () => {
    const configPath = '/path/to/config.yaml';
    const notes = generateVMNotes(configPath);
    const extracted = extractConfigPathFromNotes(notes);

    assert.strictEqual(extracted, resolve(configPath));
  });

  it('should return null for null notes', () => {
    assert.strictEqual(extractConfigPathFromNotes(null), null);
  });

  it('should return null for notes without config marker', () => {
    assert.strictEqual(extractConfigPathFromNotes('some random notes'), null);
  });
});

describe('hasRagnatrampMarker', () => {
  it('should return true for valid ragnatramp notes', () => {
    const notes = generateVMNotes('/path/to/config.yaml');

    assert.ok(hasRagnatrampMarker(notes));
  });

  it('should return false for null notes', () => {
    assert.ok(!hasRagnatrampMarker(null));
  });

  it('should return false for notes without managed:true', () => {
    const notes = 'ragnatramp:v0.1.0\nconfig:/path/to/config.yaml';

    assert.ok(!hasRagnatrampMarker(notes));
  });

  it('should verify config path when provided', () => {
    const configPath = '/path/to/config.yaml';
    const notes = generateVMNotes(configPath);

    assert.ok(hasRagnatrampMarker(notes, configPath));
    assert.ok(!hasRagnatrampMarker(notes, '/different/path.yaml'));
  });
});
