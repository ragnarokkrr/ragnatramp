/**
 * Unit tests for Action Planner
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { ResolvedConfig, ResolvedMachine } from '../../../src/config/types.js';
import type { StateFile, VMState } from '../../../src/state/types.js';
import type { HyperVVM } from '../../../src/hyperv/types.js';
import {
  computePlan,
  computeHaltPlan,
  computeDestroyPlan,
  hasActions,
  formatPlanSummary,
} from '../../../src/core/planner.js';
import { generateVMName } from '../../../src/core/naming.js';

// Test fixtures
const CONFIG_PATH = '/path/to/config.yaml';

function createMachine(name: string, cpu = 2, memory = 2048): ResolvedMachine {
  return {
    name,
    cpu,
    memory,
    baseImage: 'C:/HyperV/Golden/base.vhdx',
    diskStrategy: 'differencing',
  };
}

function createConfig(machines: ResolvedMachine[]): ResolvedConfig {
  return {
    project: { name: 'testproject' },
    machines,
    artifactPath: 'C:/VMs/testproject',
    autoStart: true,
    configPath: CONFIG_PATH,
    configHash: 'a1b2c3d4',
  };
}

function createVMState(machineName: string, config: ResolvedConfig): VMState {
  const vmName = generateVMName(config.project.name, machineName, config.configPath);
  return {
    id: `guid-${machineName}`,
    name: vmName,
    machineName,
    diskPath: `C:/VMs/testproject/${machineName}.vhdx`,
    createdAt: new Date().toISOString(),
    checkpoints: [],
  };
}

function createState(vms: VMState[], config: ResolvedConfig): StateFile {
  const vmsRecord: Record<string, VMState> = {};
  for (const vm of vms) {
    vmsRecord[vm.machineName] = vm;
  }
  return {
    version: 1,
    configHash: config.configHash,
    configPath: config.configPath,
    project: config.project.name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    vms: vmsRecord,
  };
}

function createHyperVVM(vmState: VMState, state: 'Running' | 'Off' = 'Running'): HyperVVM {
  return {
    Id: vmState.id,
    Name: vmState.name,
    State: state,
    Notes: `ragnatramp:v0.1.0\nconfig:${CONFIG_PATH}\nmanaged:true`,
    MemoryMB: 2048,
    CPUCount: 2,
  };
}

describe('computePlan', () => {
  describe('when VMs do not exist', () => {
    it('should create actions for new VMs', () => {
      const config = createConfig([createMachine('web'), createMachine('db')]);
      const result = computePlan(config, null, []);

      assert.strictEqual(result.actions.length, 2);
      assert.strictEqual(result.summary.create, 2);
      assert.strictEqual(result.summary.unchanged, 0);

      const createActions = result.actions.filter((a) => a.type === 'create');
      assert.strictEqual(createActions.length, 2);

      const machineNames = createActions.map((a) => a.machineName);
      assert.ok(machineNames.includes('web'));
      assert.ok(machineNames.includes('db'));
    });

    it('should set correct action details for create', () => {
      const machine = createMachine('web', 4, 4096);
      const config = createConfig([machine]);
      const result = computePlan(config, null, []);

      assert.strictEqual(result.actions.length, 1);
      const action = result.actions[0];
      assert.ok(action);
      assert.strictEqual(action.type, 'create');
      assert.strictEqual(action.machineName, 'web');

      const details = action.details;
      assert.strictEqual(details.type, 'create');
      if (details.type === 'create') {
        assert.strictEqual(details.cpu, 4);
        assert.strictEqual(details.memoryMB, 4096);
        assert.ok(details.differencing);
      }
    });
  });

  describe('when VMs exist and are running', () => {
    it('should not create any actions', () => {
      const config = createConfig([createMachine('web')]);
      const vmState = createVMState('web', config);
      const state = createState([vmState], config);
      const actualVMs = [createHyperVVM(vmState, 'Running')];

      const result = computePlan(config, state, actualVMs);

      assert.strictEqual(result.actions.length, 0);
      assert.strictEqual(result.summary.unchanged, 1);
    });
  });

  describe('when VMs exist but are stopped', () => {
    it('should create start actions when autoStart is true', () => {
      const config = createConfig([createMachine('web')]);
      const vmState = createVMState('web', config);
      const state = createState([vmState], config);
      const actualVMs = [createHyperVVM(vmState, 'Off')];

      const result = computePlan(config, state, actualVMs, { autoStart: true });

      assert.strictEqual(result.actions.length, 1);
      assert.strictEqual(result.summary.start, 1);

      const action = result.actions[0];
      assert.ok(action);
      assert.strictEqual(action.type, 'start');
    });

    it('should not create start actions when autoStart is false', () => {
      const config = createConfig([createMachine('web')]);
      config.autoStart = false;
      const vmState = createVMState('web', config);
      const state = createState([vmState], config);
      const actualVMs = [createHyperVVM(vmState, 'Off')];

      const result = computePlan(config, state, actualVMs, { autoStart: false });

      assert.strictEqual(result.actions.length, 0);
      assert.strictEqual(result.summary.unchanged, 1);
    });
  });

  describe('when state exists but VM is missing from Hyper-V', () => {
    it('should create action to recreate the VM', () => {
      const config = createConfig([createMachine('web')]);
      const vmState = createVMState('web', config);
      const state = createState([vmState], config);

      const result = computePlan(config, state, []); // No actual VMs

      assert.strictEqual(result.actions.length, 1);
      assert.strictEqual(result.summary.create, 1);
    });
  });

  describe('with machine filtering', () => {
    it('should only plan actions for filtered machines', () => {
      const config = createConfig([createMachine('web'), createMachine('db')]);

      const result = computePlan(config, null, [], { filterMachines: ['web'] });

      assert.strictEqual(result.actions.length, 1);
      assert.strictEqual(result.actions[0]?.machineName, 'web');
    });
  });
});

describe('computeHaltPlan', () => {
  it('should create stop actions for running VMs', () => {
    const config = createConfig([createMachine('web'), createMachine('db')]);
    const webState = createVMState('web', config);
    const dbState = createVMState('db', config);
    const state = createState([webState, dbState], config);
    const actualVMs = [
      createHyperVVM(webState, 'Running'),
      createHyperVVM(dbState, 'Running'),
    ];

    const result = computeHaltPlan(config, state, actualVMs);

    assert.strictEqual(result.actions.length, 2);
    assert.strictEqual(result.summary.stop, 2);
  });

  it('should not create stop actions for already stopped VMs', () => {
    const config = createConfig([createMachine('web')]);
    const vmState = createVMState('web', config);
    const state = createState([vmState], config);
    const actualVMs = [createHyperVVM(vmState, 'Off')];

    const result = computeHaltPlan(config, state, actualVMs);

    assert.strictEqual(result.actions.length, 0);
    assert.strictEqual(result.summary.unchanged, 1);
  });

  it('should support force option', () => {
    const config = createConfig([createMachine('web')]);
    const vmState = createVMState('web', config);
    const state = createState([vmState], config);
    const actualVMs = [createHyperVVM(vmState, 'Running')];

    const result = computeHaltPlan(config, state, actualVMs, { force: true });

    assert.strictEqual(result.actions.length, 1);
    const action = result.actions[0];
    assert.ok(action);
    if (action.details.type === 'stop') {
      assert.ok(action.details.force);
    }
  });
});

describe('computeDestroyPlan', () => {
  it('should create destroy actions for VMs in state', () => {
    const config = createConfig([createMachine('web'), createMachine('db')]);
    const webState = createVMState('web', config);
    const dbState = createVMState('db', config);
    const state = createState([webState, dbState], config);
    const actualVMs = [
      createHyperVVM(webState, 'Running'),
      createHyperVVM(dbState, 'Off'),
    ];

    const result = computeDestroyPlan(config, state, actualVMs);

    assert.strictEqual(result.actions.length, 2);
    assert.strictEqual(result.summary.destroy, 2);
  });

  it('should not create destroy actions without state', () => {
    const config = createConfig([createMachine('web')]);

    const result = computeDestroyPlan(config, null, []);

    assert.strictEqual(result.actions.length, 0);
  });

  it('should not destroy VMs that exist in state but not in Hyper-V', () => {
    const config = createConfig([createMachine('web')]);
    const vmState = createVMState('web', config);
    const state = createState([vmState], config);

    const result = computeDestroyPlan(config, state, []);

    assert.strictEqual(result.actions.length, 0);
    assert.strictEqual(result.summary.unchanged, 1);
  });

  it('should include disk path in destroy action', () => {
    const config = createConfig([createMachine('web')]);
    const vmState = createVMState('web', config);
    const state = createState([vmState], config);
    const actualVMs = [createHyperVVM(vmState)];

    const result = computeDestroyPlan(config, state, actualVMs);

    assert.strictEqual(result.actions.length, 1);
    const action = result.actions[0];
    assert.ok(action);
    if (action.details.type === 'destroy') {
      assert.strictEqual(action.details.diskPath, vmState.diskPath);
    }
  });
});

describe('hasActions', () => {
  it('should return true when plan has actions', () => {
    const config = createConfig([createMachine('web')]);
    const result = computePlan(config, null, []);

    assert.ok(hasActions(result));
  });

  it('should return false when plan has no actions', () => {
    const config = createConfig([createMachine('web')]);
    const vmState = createVMState('web', config);
    const state = createState([vmState], config);
    const actualVMs = [createHyperVVM(vmState)];

    const result = computePlan(config, state, actualVMs);

    assert.ok(!hasActions(result));
  });
});

describe('formatPlanSummary', () => {
  it('should return "No changes needed" when no actions', () => {
    const config = createConfig([createMachine('web')]);
    const vmState = createVMState('web', config);
    const state = createState([vmState], config);
    const actualVMs = [createHyperVVM(vmState)];

    const result = computePlan(config, state, actualVMs);
    const summary = formatPlanSummary(result);

    assert.strictEqual(summary, 'No changes needed');
  });

  it('should list action counts', () => {
    const config = createConfig([createMachine('web'), createMachine('db')]);
    const result = computePlan(config, null, []);
    const summary = formatPlanSummary(result);

    assert.ok(summary.includes('2 to create'));
  });
});
