/**
 * CLI Output Layer
 *
 * Provides consistent output formatting for CLI commands in both
 * human-readable and JSON modes.
 */

import type { Action, ActionType, CreateActionDetails } from '../core/types.js';
import type { ErrorCode, RagnatrampError } from '../core/errors.js';
import type { HyperVVM } from '../hyperv/types.js';

// =============================================================================
// Output Types (T066)
// =============================================================================

/**
 * Standard output format for --json mode
 */
export interface CommandResult {
  success: boolean;
  command: string;
  actions?: ActionResult[];
  vms?: VMInfo[];
  error?: ErrorOutput;
  summary?: Record<string, number>;
}

/**
 * Result of a single action execution
 */
export interface ActionResult {
  type: ActionType;
  vm: string;
  status: 'completed' | 'failed' | 'skipped';
  error?: string;
}

/**
 * VM information for status output
 */
export interface VMInfo {
  name: string;
  state: string;
  cpu: number;
  memoryMB: number;
}

/**
 * Error output format for JSON mode
 */
export interface ErrorOutput {
  code: ErrorCode | string;
  message: string;
  suggestion?: string;
  details?: Record<string, unknown>;
}

/**
 * Validation result for validate command
 */
export interface ValidationOutput {
  valid: boolean;
  project?: string;
  machines?: number;
  machineNames?: string[];
  baseImage?: string;
  errors?: Array<{
    path: string;
    message: string;
  }>;
}

/**
 * Plan output for plan command
 */
export interface PlanOutput {
  changes: number;
  actions: PlanAction[];
}

/**
 * Planned action for display
 */
export interface PlanAction {
  type: ActionType;
  vm: string;
  details: {
    cpu?: number;
    memoryMB?: number;
    diskPath?: string;
    diskType?: string;
  };
}

// =============================================================================
// OutputFormatter Class (T064, T065)
// =============================================================================

/**
 * Output mode for the formatter
 */
export type OutputMode = 'human' | 'json';

/**
 * CLI-specific output formatter.
 *
 * Provides high-level methods for formatting command output in both
 * human-readable and JSON modes. In JSON mode, output is collected
 * and emitted as a single JSON object at flush.
 */
export class OutputFormatter {
  private mode: OutputMode;
  private command: string;
  private result: CommandResult;
  private indentLevel: number = 0;

  constructor(command: string, options: { json?: boolean } = {}) {
    this.mode = options.json ? 'json' : 'human';
    this.command = command;
    this.result = {
      success: true,
      command,
    };
  }

  /**
   * Get the output mode.
   */
  getMode(): OutputMode {
    return this.mode;
  }

  /**
   * Check if in JSON mode.
   */
  isJson(): boolean {
    return this.mode === 'json';
  }

  // ===========================================================================
  // Indentation
  // ===========================================================================

  /**
   * Increase indent level.
   */
  indent(): void {
    this.indentLevel++;
  }

  /**
   * Decrease indent level.
   */
  dedent(): void {
    if (this.indentLevel > 0) {
      this.indentLevel--;
    }
  }

  /**
   * Get indent string for current level.
   */
  private getIndent(): string {
    return '  '.repeat(this.indentLevel);
  }

  // ===========================================================================
  // Basic Output Methods
  // ===========================================================================

  /**
   * Print a success message.
   */
  success(message: string): void {
    if (this.mode === 'human') {
      console.log(`${this.getIndent()}✓ ${message}`);
    }
  }

  /**
   * Print an error message.
   */
  error(message: string, error?: RagnatrampError): void {
    this.result.success = false;

    if (this.mode === 'human') {
      console.error(`${this.getIndent()}✗ ${message}`);
      if (error?.suggestion) {
        console.error(`${this.getIndent()}  Fix: ${error.suggestion}`);
      }
    }

    this.result.error = {
      code: error?.code ?? 'UNKNOWN',
      message,
      suggestion: error?.suggestion,
    };
  }

  /**
   * Print an info message.
   */
  info(message: string): void {
    if (this.mode === 'human') {
      console.log(`${this.getIndent()}${message}`);
    }
  }

  /**
   * Print a warning message.
   */
  warning(message: string): void {
    if (this.mode === 'human') {
      console.warn(`${this.getIndent()}⚠ ${message}`);
    }
  }

  /**
   * Print a blank line.
   */
  newline(): void {
    if (this.mode === 'human') {
      console.log();
    }
  }

  // ===========================================================================
  // Action Output Methods
  // ===========================================================================

  /**
   * Report an action starting.
   *
   * In human mode: prints "Creating VM: name"
   * In JSON mode: no immediate output (collected at end)
   */
  actionStart(action: Action): void {
    if (this.mode === 'human') {
      const verb = this.getActionVerb(action.type);
      console.log(`${this.getIndent()}${verb} VM: ${action.vmName}`);
      this.indent();

      // Print details for create actions
      if (action.type === 'create') {
        const details = action.details as CreateActionDetails;
        console.log(`${this.getIndent()}CPU: ${details.cpu}, Memory: ${details.memoryMB} MB`);
        console.log(`${this.getIndent()}Disk: ${details.diskPath} (${details.differencing ? 'differencing' : 'copy'})`);
      }
    }
  }

  /**
   * Report an action completed.
   */
  actionComplete(action: Action): void {
    if (this.mode === 'human') {
      const pastTense = this.getActionPastTense(action.type);
      console.log(`${this.getIndent()}✓ VM ${pastTense}`);
      if (action.type === 'create') {
        console.log(`${this.getIndent()}✓ VM started`);
      }
      this.dedent();
    }

    this.addActionResult({
      type: action.type,
      vm: action.vmName,
      status: 'completed',
    });
  }

  /**
   * Get the past tense form of an action type.
   */
  private getActionPastTense(type: ActionType): string {
    switch (type) {
      case 'create':
        return 'created';
      case 'start':
        return 'started';
      case 'stop':
        return 'stopped';
      case 'destroy':
        return 'destroyed';
      case 'checkpoint':
        return 'checkpointed';
      case 'restore':
        return 'restored';
    }
  }

  /**
   * Report an action failed.
   */
  actionFailed(action: Action, errorMessage: string): void {
    if (this.mode === 'human') {
      console.error(`${this.getIndent()}✗ ${action.type} failed: ${errorMessage}`);
      this.dedent();
    }

    this.addActionResult({
      type: action.type,
      vm: action.vmName,
      status: 'failed',
      error: errorMessage,
    });
  }

  /**
   * Add an action result to the JSON output.
   */
  private addActionResult(actionResult: ActionResult): void {
    if (!this.result.actions) {
      this.result.actions = [];
    }
    this.result.actions.push(actionResult);
  }

  /**
   * Get the human-readable verb for an action type.
   */
  private getActionVerb(type: ActionType): string {
    switch (type) {
      case 'create':
        return '✓ Creating';
      case 'start':
        return '▶ Starting';
      case 'stop':
        return '⏹ Stopping';
      case 'destroy':
        return '- Destroying';
      case 'checkpoint':
        return '📸 Checkpointing';
      case 'restore':
        return '↩ Restoring';
    }
  }

  // ===========================================================================
  // Table Output
  // ===========================================================================

  /**
   * Print a table of data.
   *
   * @param headers - Column headers
   * @param rows - Row data
   */
  table(headers: string[], rows: string[][]): void {
    if (this.mode === 'human') {
      // Calculate column widths
      const widths = headers.map((h, i) => {
        const maxRowWidth = Math.max(...rows.map((r) => (r[i] ?? '').length));
        return Math.max(h.length, maxRowWidth);
      });

      // Print header
      const headerLine = headers.map((h, i) => h.padEnd(widths[i] ?? 0)).join('  ');
      console.log(`${this.getIndent()}${headerLine}`);

      // Print rows
      for (const row of rows) {
        const rowLine = row.map((cell, i) => (cell ?? '').padEnd(widths[i] ?? 0)).join('  ');
        console.log(`${this.getIndent()}${rowLine}`);
      }
    }
  }

  // ===========================================================================
  // Status Output
  // ===========================================================================

  /**
   * Print VM status table.
   */
  statusTable(projectName: string, vms: HyperVVM[]): void {
    const vmInfos: VMInfo[] = vms.map((vm) => ({
      name: vm.Name,
      state: vm.State,
      cpu: vm.CPUCount,
      memoryMB: vm.MemoryMB,
    }));

    if (this.mode === 'human') {
      this.info(`Project: ${projectName}`);
      this.newline();

      const headers = ['NAME', 'STATE', 'CPU', 'MEMORY'];
      const rows = vmInfos.map((vm) => [
        vm.name,
        vm.state,
        String(vm.cpu),
        `${vm.memoryMB} MB`,
      ]);

      this.indent();
      this.table(headers, rows);
      this.dedent();

      this.newline();
      this.info(`${vms.length} VM${vms.length === 1 ? '' : 's'} managed by this configuration.`);
    }

    this.result.vms = vmInfos;
  }

  // ===========================================================================
  // Validate Output
  // ===========================================================================

  /**
   * Print validation success.
   */
  validationSuccess(
    projectName: string,
    machineCount: number,
    machineNames: string[],
    baseImage: string
  ): void {
    if (this.mode === 'human') {
      this.success('Configuration valid');
      this.indent();
      this.info(`Project: ${projectName}`);
      this.info(`Machines: ${machineCount} (${machineNames.join(', ')})`);
      this.info(`Base image: ${baseImage}`);
      this.dedent();
    }

    this.result.summary = {
      machines: machineCount,
    };
  }

  /**
   * Print validation errors.
   */
  validationError(errors: Array<{ path: string; message: string }>): void {
    this.result.success = false;

    if (this.mode === 'human') {
      this.error('Configuration invalid');
      this.newline();
      for (const err of errors) {
        console.log(`  - ${err.path}: ${err.message}`);
      }
    }

    this.result.error = {
      code: 'CONFIG_VALIDATION_FAILED',
      message: 'Configuration validation failed',
      details: { errors },
    };
  }

  // ===========================================================================
  // Plan Output
  // ===========================================================================

  /**
   * Print plan summary.
   */
  planSummary(actions: Action[]): void {
    const planActions: PlanAction[] = actions.map((a) => {
      const planAction: PlanAction = {
        type: a.type,
        vm: a.vmName,
        details: {},
      };

      if (a.type === 'create') {
        const details = a.details as CreateActionDetails;
        planAction.details = {
          cpu: details.cpu,
          memoryMB: details.memoryMB,
          diskPath: details.diskPath,
          diskType: details.differencing ? 'differencing' : 'copy',
        };
      }

      return planAction;
    });

    if (this.mode === 'human') {
      if (actions.length === 0) {
        this.info('No changes needed. All VMs are in sync.');
      } else {
        this.info(`Plan: ${actions.length} VM${actions.length === 1 ? '' : 's'} to ${this.getPlanVerb(actions)}`);
        this.newline();

        for (const action of planActions) {
          const symbol = action.type === 'create' ? '+' : action.type === 'destroy' ? '-' : '~';
          console.log(`  ${symbol} ${action.vm}`);
          if (action.details.cpu !== undefined) {
            console.log(`    CPU: ${action.details.cpu}, Memory: ${action.details.memoryMB} MB`);
            console.log(`    Disk: ${action.details.diskPath} (${action.details.diskType})`);
          }
        }

        this.newline();
        this.info(`Run \`ragnatramp up <file>\` to apply.`);
      }
    }

    this.result.summary = {
      changes: actions.length,
    };
  }

  /**
   * Get the plan verb based on action types.
   */
  private getPlanVerb(actions: Action[]): string {
    const types = new Set(actions.map((a) => a.type));
    if (types.has('create')) return 'create';
    if (types.has('start')) return 'start';
    if (types.has('stop')) return 'stop';
    if (types.has('destroy')) return 'destroy';
    return 'modify';
  }

  // ===========================================================================
  // Summary Output
  // ===========================================================================

  /**
   * Print final summary.
   */
  summary(stats: { created?: number; started?: number; stopped?: number; destroyed?: number; checkpointed?: number; restored?: number }): void {
    const parts: string[] = [];
    if (stats.created) parts.push(`${stats.created} created`);
    if (stats.started) parts.push(`${stats.started} started`);
    if (stats.stopped) parts.push(`${stats.stopped} stopped`);
    if (stats.destroyed) parts.push(`${stats.destroyed} destroyed`);
    if (stats.checkpointed) parts.push(`${stats.checkpointed} checkpointed`);
    if (stats.restored) parts.push(`${stats.restored} restored`);

    if (this.mode === 'human') {
      this.newline();
      if (parts.length > 0) {
        this.info(`Done. ${parts.join(', ')}.`);
      } else {
        this.info('Done. No changes made.');
      }
    }

    this.result.summary = {
      ...this.result.summary,
      ...stats,
    };
  }

  /**
   * Print "Done. X VMs running." message.
   */
  done(runningCount: number): void {
    if (this.mode === 'human') {
      this.newline();
      this.info(`Done. ${runningCount} VM${runningCount === 1 ? '' : 's'} running.`);
    }

    this.result.summary = {
      ...this.result.summary,
      running: runningCount,
    };
  }

  // ===========================================================================
  // JSON Output
  // ===========================================================================

  /**
   * Set additional data for JSON output.
   */
  setData(key: string, value: unknown): void {
    (this.result as unknown as Record<string, unknown>)[key] = value;
  }

  /**
   * Set success status explicitly.
   */
  setSuccess(success: boolean): void {
    this.result.success = success;
  }

  /**
   * Get the command result object.
   */
  getResult(): CommandResult {
    return this.result;
  }

  /**
   * Flush output.
   *
   * In JSON mode, prints the collected JSON.
   * In human mode, does nothing (output was printed inline).
   */
  flush(): void {
    if (this.mode === 'json') {
      console.log(JSON.stringify(this.result, null, 2));
    }
  }

  /**
   * Get the exit code based on success status.
   */
  getExitCode(): number {
    return this.result.success ? 0 : 1;
  }
}

/**
 * Create an OutputFormatter from CLI options.
 */
export function createOutput(
  command: string,
  options: { json?: boolean }
): OutputFormatter {
  return new OutputFormatter(command, options);
}
