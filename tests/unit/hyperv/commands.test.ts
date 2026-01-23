/**
 * Unit tests for HyperV Command Builders
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  escapePowerShellString,
  buildGetVMsScript,
  buildGetVMByNameScript,
  buildGetVMByIdScript,
  buildCreateVMScript,
  buildStartVMScript,
  buildStopVMScript,
  buildGracefulStopVMScript,
  buildRemoveVMScript,
  buildCheckpointVMScript,
  buildRestoreVMSnapshotScript,
  buildGetVMSnapshotsScript,
  buildRemoveVMSnapshotScript,
  buildCheckHyperVScript,
  buildCheckDefaultSwitchScript,
  buildCheckFileExistsScript,
  buildDeleteFileScript,
} from '../../../src/hyperv/commands.js';

describe('escapePowerShellString', () => {
  it('should escape single quotes by doubling them', () => {
    const result = escapePowerShellString("test'value");
    assert.strictEqual(result, "test''value");
  });

  it('should escape multiple single quotes', () => {
    const result = escapePowerShellString("it's a test's string");
    assert.strictEqual(result, "it''s a test''s string");
  });

  it('should return unchanged string without quotes', () => {
    const result = escapePowerShellString('test value');
    assert.strictEqual(result, 'test value');
  });

  it('should handle empty string', () => {
    const result = escapePowerShellString('');
    assert.strictEqual(result, '');
  });
});

describe('buildGetVMsScript', () => {
  it('should contain Get-VM cmdlet', () => {
    const script = buildGetVMsScript();
    assert.ok(script.includes('Get-VM'));
  });

  it('should select required properties', () => {
    const script = buildGetVMsScript();
    assert.ok(script.includes('Id'));
    assert.ok(script.includes('Name'));
    assert.ok(script.includes('State'));
    assert.ok(script.includes('Notes'));
    assert.ok(script.includes('MemoryMB'));
    assert.ok(script.includes('CPUCount'));
  });

  it('should convert to JSON', () => {
    const script = buildGetVMsScript();
    assert.ok(script.includes('ConvertTo-Json'));
  });

  it('should handle null/empty arrays', () => {
    const script = buildGetVMsScript();
    // Should check for null and return empty array
    assert.ok(script.includes("'[]'") || script.includes('[]'));
  });
});

describe('buildGetVMByNameScript', () => {
  it('should include VM name in query', () => {
    const script = buildGetVMByNameScript('test-vm');
    assert.ok(script.includes("'test-vm'"));
  });

  it('should escape single quotes in name', () => {
    const script = buildGetVMByNameScript("test's-vm");
    assert.ok(script.includes("'test''s-vm'"));
  });

  it('should use SilentlyContinue for missing VMs', () => {
    const script = buildGetVMByNameScript('test-vm');
    assert.ok(script.includes('SilentlyContinue'));
  });

  it('should return null for missing VM', () => {
    const script = buildGetVMByNameScript('test-vm');
    assert.ok(script.includes("'null'"));
  });
});

describe('buildGetVMByIdScript', () => {
  it('should include VM ID in query', () => {
    const script = buildGetVMByIdScript('12345678-1234-1234-1234-123456789abc');
    assert.ok(script.includes('12345678-1234-1234-1234-123456789abc'));
  });

  it('should use Get-VM -Id', () => {
    const script = buildGetVMByIdScript('test-id');
    assert.ok(script.includes('Get-VM -Id'));
  });
});

describe('buildCreateVMScript', () => {
  const baseParams = {
    name: 'test-vm',
    cpu: 2,
    memoryMB: 4096,
    baseImage: 'C:/Images/base.vhdx',
    diskPath: 'C:/VMs/test-vm.vhdx',
    notes: 'Test VM notes',
    differencing: true,
  };

  it('should include New-VM cmdlet', () => {
    const script = buildCreateVMScript(baseParams);
    assert.ok(script.includes('New-VM'));
  });

  it('should set VM name', () => {
    const script = buildCreateVMScript(baseParams);
    assert.ok(script.includes("'test-vm'"));
  });

  it('should set Generation 2', () => {
    const script = buildCreateVMScript(baseParams);
    assert.ok(script.includes('-Generation 2'));
  });

  it('should set memory in bytes', () => {
    const script = buildCreateVMScript(baseParams);
    assert.ok(script.includes('4096MB'));
  });

  it('should set processor count', () => {
    const script = buildCreateVMScript(baseParams);
    assert.ok(script.includes('-ProcessorCount 2'));
  });

  it('should create differencing disk when specified', () => {
    const script = buildCreateVMScript(baseParams);
    assert.ok(script.includes('New-VHD'));
    assert.ok(script.includes('-Differencing'));
    assert.ok(script.includes('-ParentPath'));
  });

  it('should copy disk when differencing is false', () => {
    const script = buildCreateVMScript({ ...baseParams, differencing: false });
    assert.ok(script.includes('Copy-Item'));
    assert.ok(!script.includes('-Differencing'));
  });

  it('should connect to Default Switch', () => {
    const script = buildCreateVMScript(baseParams);
    assert.ok(script.includes("'Default Switch'"));
    assert.ok(script.includes('Connect-VMNetworkAdapter'));
  });

  it('should set VM Notes', () => {
    const script = buildCreateVMScript(baseParams);
    assert.ok(script.includes('-Notes'));
    assert.ok(script.includes('Test VM notes'));
  });

  it('should add hard disk drive', () => {
    const script = buildCreateVMScript(baseParams);
    assert.ok(script.includes('Add-VMHardDiskDrive'));
  });

  it('should escape special characters in paths', () => {
    const script = buildCreateVMScript({
      ...baseParams,
      baseImage: "C:/Images/test's image.vhdx",
    });
    assert.ok(script.includes("C:/Images/test''s image.vhdx"));
  });

  it('should return VM Id and Name as JSON', () => {
    const script = buildCreateVMScript(baseParams);
    assert.ok(script.includes('Select-Object Id, Name'));
    assert.ok(script.includes('ConvertTo-Json'));
  });

  it('should create disk directory if needed', () => {
    const script = buildCreateVMScript(baseParams);
    assert.ok(script.includes('New-Item -ItemType Directory'));
  });
});

describe('buildStartVMScript', () => {
  it('should use Start-VM cmdlet', () => {
    const script = buildStartVMScript('test-id');
    assert.ok(script.includes('Start-VM'));
  });

  it('should include VM ID', () => {
    const script = buildStartVMScript('test-id');
    assert.ok(script.includes("'test-id'"));
  });

  it('should set ErrorActionPreference to Stop', () => {
    const script = buildStartVMScript('test-id');
    assert.ok(script.includes("$ErrorActionPreference = 'Stop'"));
  });
});

describe('buildStopVMScript', () => {
  it('should use Stop-VM cmdlet', () => {
    const script = buildStopVMScript('test-id');
    assert.ok(script.includes('Stop-VM'));
  });

  it('should include VM ID', () => {
    const script = buildStopVMScript('test-id');
    assert.ok(script.includes("'test-id'"));
  });

  it('should include -Force flag', () => {
    const script = buildStopVMScript('test-id', true);
    assert.ok(script.includes('-Force'));
  });
});

describe('buildGracefulStopVMScript', () => {
  it('should attempt graceful stop first', () => {
    const script = buildGracefulStopVMScript('test-id');
    assert.ok(script.includes('Stop-VM'));
    assert.ok(script.includes('-Force:$false'));
  });

  it('should wait for specified timeout', () => {
    const script = buildGracefulStopVMScript('test-id', 60);
    assert.ok(script.includes('60'));
  });

  it('should force stop after timeout', () => {
    const script = buildGracefulStopVMScript('test-id');
    assert.ok(script.includes('-TurnOff'));
  });
});

describe('buildRemoveVMScript', () => {
  it('should use Remove-VM cmdlet', () => {
    const script = buildRemoveVMScript('test-id');
    assert.ok(script.includes('Remove-VM'));
  });

  it('should use -Force flag', () => {
    const script = buildRemoveVMScript('test-id');
    assert.ok(script.includes('-Force'));
  });

  it('should stop VM if running', () => {
    const script = buildRemoveVMScript('test-id');
    assert.ok(script.includes('Stop-VM'));
    assert.ok(script.includes('-TurnOff'));
  });

  it('should check if VM exists first', () => {
    const script = buildRemoveVMScript('test-id');
    assert.ok(script.includes('SilentlyContinue'));
    assert.ok(script.includes('if ($vm)'));
  });
});

describe('buildCheckpointVMScript', () => {
  it('should use Checkpoint-VM cmdlet', () => {
    const script = buildCheckpointVMScript({ vmId: 'test-id', name: 'baseline' });
    assert.ok(script.includes('Checkpoint-VM'));
  });

  it('should set snapshot name', () => {
    const script = buildCheckpointVMScript({ vmId: 'test-id', name: 'my-checkpoint' });
    assert.ok(script.includes("'my-checkpoint'"));
  });

  it('should use -Passthru to return result', () => {
    const script = buildCheckpointVMScript({ vmId: 'test-id', name: 'baseline' });
    assert.ok(script.includes('-Passthru'));
  });

  it('should return checkpoint details as JSON', () => {
    const script = buildCheckpointVMScript({ vmId: 'test-id', name: 'baseline' });
    assert.ok(script.includes('Select-Object Id, Name, VMId'));
    assert.ok(script.includes('ConvertTo-Json'));
  });
});

describe('buildRestoreVMSnapshotScript', () => {
  it('should use Restore-VMSnapshot cmdlet', () => {
    const script = buildRestoreVMSnapshotScript('vm-id', 'snapshot-id');
    assert.ok(script.includes('Restore-VMSnapshot'));
  });

  it('should stop VM before restore', () => {
    const script = buildRestoreVMSnapshotScript('vm-id', 'snapshot-id');
    assert.ok(script.includes('Stop-VM'));
  });

  it('should find snapshot by ID', () => {
    const script = buildRestoreVMSnapshotScript('vm-id', 'snapshot-id');
    assert.ok(script.includes('Get-VMSnapshot'));
    assert.ok(script.includes("'snapshot-id'"));
  });

  it('should throw if snapshot not found', () => {
    const script = buildRestoreVMSnapshotScript('vm-id', 'snapshot-id');
    assert.ok(script.includes('throw'));
    assert.ok(script.includes('Snapshot not found'));
  });

  it('should skip confirmation', () => {
    const script = buildRestoreVMSnapshotScript('vm-id', 'snapshot-id');
    assert.ok(script.includes('-Confirm:$false'));
  });
});

describe('buildGetVMSnapshotsScript', () => {
  it('should use Get-VMSnapshot cmdlet', () => {
    const script = buildGetVMSnapshotsScript('test-id');
    assert.ok(script.includes('Get-VMSnapshot'));
  });

  it('should query by VM ID', () => {
    const script = buildGetVMSnapshotsScript('test-id');
    assert.ok(script.includes('-VMId'));
    assert.ok(script.includes("'test-id'"));
  });

  it('should select required properties', () => {
    const script = buildGetVMSnapshotsScript('test-id');
    assert.ok(script.includes('Id'));
    assert.ok(script.includes('Name'));
    assert.ok(script.includes('VMId'));
    assert.ok(script.includes('CreationTime'));
  });

  it('should handle empty snapshots', () => {
    const script = buildGetVMSnapshotsScript('test-id');
    assert.ok(script.includes("'[]'") || script.includes('[]'));
  });
});

describe('buildRemoveVMSnapshotScript', () => {
  it('should use Remove-VMSnapshot cmdlet', () => {
    const script = buildRemoveVMSnapshotScript('vm-id', 'snapshot-id');
    assert.ok(script.includes('Remove-VMSnapshot'));
  });

  it('should find snapshot by ID', () => {
    const script = buildRemoveVMSnapshotScript('vm-id', 'snapshot-id');
    assert.ok(script.includes("'snapshot-id'"));
  });
});

describe('buildCheckHyperVScript', () => {
  it('should check vmms service', () => {
    const script = buildCheckHyperVScript();
    assert.ok(script.includes('Get-Service vmms'));
  });

  it('should return available status', () => {
    const script = buildCheckHyperVScript();
    assert.ok(script.includes('available'));
  });

  it('should include message on failure', () => {
    const script = buildCheckHyperVScript();
    assert.ok(script.includes('message'));
  });
});

describe('buildCheckDefaultSwitchScript', () => {
  it('should query Default Switch', () => {
    const script = buildCheckDefaultSwitchScript();
    assert.ok(script.includes("'Default Switch'"));
    assert.ok(script.includes('Get-VMSwitch'));
  });

  it('should return exists status', () => {
    const script = buildCheckDefaultSwitchScript();
    assert.ok(script.includes('exists'));
  });
});

describe('buildCheckFileExistsScript', () => {
  it('should use Test-Path', () => {
    const script = buildCheckFileExistsScript('C:/test.vhdx');
    assert.ok(script.includes('Test-Path'));
  });

  it('should check for file (not directory)', () => {
    const script = buildCheckFileExistsScript('C:/test.vhdx');
    assert.ok(script.includes('-PathType Leaf'));
  });

  it('should return path in result', () => {
    const script = buildCheckFileExistsScript('C:/test.vhdx');
    assert.ok(script.includes('path'));
    assert.ok(script.includes('C:/test.vhdx'));
  });

  it('should escape path with quotes', () => {
    const script = buildCheckFileExistsScript("C:/test's file.vhdx");
    assert.ok(script.includes("C:/test''s file.vhdx"));
  });
});

describe('buildDeleteFileScript', () => {
  it('should use Remove-Item', () => {
    const script = buildDeleteFileScript('C:/test.vhdx');
    assert.ok(script.includes('Remove-Item'));
  });

  it('should check if file exists first', () => {
    const script = buildDeleteFileScript('C:/test.vhdx');
    assert.ok(script.includes('Test-Path'));
  });

  it('should use -Force flag', () => {
    const script = buildDeleteFileScript('C:/test.vhdx');
    assert.ok(script.includes('-Force'));
  });
});
