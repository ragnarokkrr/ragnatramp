/**
 * Unit tests for Preflight Checks
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolve } from 'node:path';
import type { StateFile, VMState } from '../../../src/state/types.js';
import type { HyperVVM } from '../../../src/hyperv/types.js';
import {
  verifyOwnership,
  verifyOwnershipByMachineName,
} from '../../../src/core/preflight.js';
import { generateVMName, generateVMNotes } from '../../../src/core/naming.js';

// Test fixtures
const CONFIG_PATH = '/path/to/config.yaml';
const PROJECT_NAME = 'testproject';

function createVMState(machineName: string): VMState {
  const vmName = generateVMName(PROJECT_NAME, machineName, CONFIG_PATH);
  return {
    id: `guid-${machineName}`,
    name: vmName,
    machineName,
    diskPath: `C:/VMs/testproject/${machineName}.vhdx`,
    createdAt: new Date().toISOString(),
    checkpoints: [],
  };
}

function createState(vms: VMState[]): StateFile {
  const vmsRecord: Record<string, VMState> = {};
  for (const vm of vms) {
    vmsRecord[vm.machineName] = vm;
  }
  return {
    version: 1,
    configHash: 'a1b2c3d4',
    configPath: resolve(CONFIG_PATH),
    project: PROJECT_NAME,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    vms: vmsRecord,
  };
}

function createHyperVVM(
  vmState: VMState,
  state: 'Running' | 'Off' = 'Running',
  notes?: string | null
): HyperVVM {
  return {
    Id: vmState.id,
    Name: vmState.name,
    State: state,
    Notes: notes === undefined ? generateVMNotes(CONFIG_PATH) : notes,
    MemoryMB: 2048,
    CPUCount: 2,
  };
}

describe('verifyOwnership', () => {
  describe('when all checks pass', () => {
    it('should return owned=true', () => {
      const vmState = createVMState('web');
      const state = createState([vmState]);
      const actualVM = createHyperVVM(vmState);

      const result = verifyOwnership(vmState.name, state, actualVM, CONFIG_PATH);

      assert.ok(result.owned);
      assert.ok(result.checks.inStateFile);
      assert.ok(result.checks.hasMarkerInNotes);
      assert.ok(result.checks.nameMatchesPattern);
    });
  });

  describe('when VM is not in state file', () => {
    it('should return owned=false', () => {
      const vmState = createVMState('web');
      const state = createState([]); // Empty state
      const actualVM = createHyperVVM(vmState);

      const result = verifyOwnership(vmState.name, state, actualVM, CONFIG_PATH);

      assert.ok(!result.owned);
      assert.ok(!result.checks.inStateFile);
      assert.ok(result.reason?.includes('not in state file'));
    });

    it('should fail when state is null', () => {
      const vmState = createVMState('web');
      const actualVM = createHyperVVM(vmState);

      const result = verifyOwnership(vmState.name, null, actualVM, CONFIG_PATH);

      assert.ok(!result.owned);
      assert.ok(!result.checks.inStateFile);
    });
  });

  describe('when VM Notes marker is missing', () => {
    it('should return owned=false for missing Notes', () => {
      const vmState = createVMState('web');
      const state = createState([vmState]);
      const actualVM = createHyperVVM(vmState, 'Running', null);

      const result = verifyOwnership(vmState.name, state, actualVM, CONFIG_PATH);

      assert.ok(!result.owned);
      assert.ok(!result.checks.hasMarkerInNotes);
      assert.ok(result.reason?.includes('marker'));
    });

    it('should return owned=false for wrong Notes content', () => {
      const vmState = createVMState('web');
      const state = createState([vmState]);
      const actualVM = createHyperVVM(vmState, 'Running', 'Some other notes');

      const result = verifyOwnership(vmState.name, state, actualVM, CONFIG_PATH);

      assert.ok(!result.owned);
      assert.ok(!result.checks.hasMarkerInNotes);
    });

    it('should return owned=false when Notes point to different config', () => {
      const vmState = createVMState('web');
      const state = createState([vmState]);
      const actualVM = createHyperVVM(
        vmState,
        'Running',
        generateVMNotes('/different/config.yaml')
      );

      const result = verifyOwnership(vmState.name, state, actualVM, CONFIG_PATH);

      assert.ok(!result.owned);
      assert.ok(!result.checks.hasMarkerInNotes);
    });
  });

  describe('when VM name does not match pattern', () => {
    it('should return owned=false', () => {
      const vmState = createVMState('web');
      const state = createState([vmState]);
      const actualVM = createHyperVVM(vmState);

      // Verify with wrong config path (which changes expected name)
      const result = verifyOwnership(
        vmState.name,
        state,
        actualVM,
        '/different/config.yaml'
      );

      assert.ok(!result.owned);
      assert.ok(!result.checks.nameMatchesPattern);
    });
  });

  describe('when actual VM is null', () => {
    it('should fail Notes check but pass state check', () => {
      const vmState = createVMState('web');
      const state = createState([vmState]);

      const result = verifyOwnership(vmState.name, state, null, CONFIG_PATH);

      assert.ok(!result.owned);
      assert.ok(result.checks.inStateFile);
      assert.ok(!result.checks.hasMarkerInNotes);
    });
  });

  describe('with multiple failure reasons', () => {
    it('should list all failures in reason', () => {
      const vmState = createVMState('web');
      const state = createState([]); // Not in state
      const actualVM = createHyperVVM(vmState, 'Running', 'wrong notes');

      const result = verifyOwnership(vmState.name, state, actualVM, CONFIG_PATH);

      assert.ok(!result.owned);
      assert.ok(result.reason?.includes('not in state file'));
      assert.ok(result.reason?.includes('marker'));
    });
  });
});

describe('verifyOwnershipByMachineName', () => {
  it('should verify ownership using machine name', () => {
    const vmState = createVMState('web');
    const state = createState([vmState]);
    const actualVM = createHyperVVM(vmState);

    const actualVMs = new Map<string, HyperVVM>();
    actualVMs.set(vmState.name, actualVM);

    const result = verifyOwnershipByMachineName(
      'web',
      state,
      actualVMs,
      CONFIG_PATH,
      PROJECT_NAME
    );

    assert.ok(result.owned);
  });

  it('should return not owned when machine not in VMs map', () => {
    const vmState = createVMState('web');
    const state = createState([vmState]);

    const actualVMs = new Map<string, HyperVVM>(); // Empty

    const result = verifyOwnershipByMachineName(
      'web',
      state,
      actualVMs,
      CONFIG_PATH,
      PROJECT_NAME
    );

    assert.ok(!result.owned);
  });

  it('should generate expected VM name correctly', () => {
    const vmState = createVMState('web');
    const state = createState([vmState]);
    const actualVM = createHyperVVM(vmState);

    const actualVMs = new Map<string, HyperVVM>();
    actualVMs.set(vmState.name, actualVM);

    const result = verifyOwnershipByMachineName(
      'web',
      state,
      actualVMs,
      CONFIG_PATH,
      PROJECT_NAME
    );

    // The verification should find the VM using the generated name
    assert.ok(result.owned);
    assert.ok(result.checks.nameMatchesPattern);
  });
});
