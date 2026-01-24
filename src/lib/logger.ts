/**
 * Logger for Ragnatramp
 *
 * Supports human-readable and JSON output modes.
 */

import type { Action } from '../core/types.js';
import type { RagnatrampError } from '../core/errors.js';

/**
 * Output mode for the logger
 */
export type OutputMode = 'human' | 'json';

/**
 * Log level for messages
 */
export type LogLevel = 'info' | 'success' | 'warning' | 'error';

/**
 * JSON output structure for commands
 */
export interface JsonOutput {
  success: boolean;
  command?: string;
  data?: unknown;
  error?: {
    code: string;
    message: string;
    suggestion?: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Logger class supporting human-readable and JSON output modes.
 *
 * Human mode outputs colored text with symbols.
 * JSON mode collects all output and emits a single JSON object at the end.
 */
export class Logger {
  private mode: OutputMode;
  private jsonBuffer: JsonOutput;
  private indentLevel: number = 0;

  constructor(mode: OutputMode = 'human') {
    this.mode = mode;
    this.jsonBuffer = { success: true };
  }

  /**
   * Set the output mode.
   */
  setMode(mode: OutputMode): void {
    this.mode = mode;
  }

  /**
   * Get the current output mode.
   */
  getMode(): OutputMode {
    return this.mode;
  }

  /**
   * Increase indent level for nested output.
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
   * Get the current indent string.
   */
  private getIndent(): string {
    return '  '.repeat(this.indentLevel);
  }

  /**
   * Log a success message.
   */
  success(message: string): void {
    if (this.mode === 'human') {
      console.log(`${this.getIndent()}✓ ${message}`);
    }
  }

  /**
   * Log an error message.
   */
  error(message: string, error?: RagnatrampError): void {
    if (this.mode === 'human') {
      console.error(`${this.getIndent()}✗ ${message}`);
      if (error?.suggestion) {
        console.error(`${this.getIndent()}  Fix: ${error.suggestion}`);
      }
    } else {
      this.jsonBuffer.success = false;
      this.jsonBuffer.error = {
        code: error?.code ?? 'UNKNOWN',
        message,
        suggestion: error?.suggestion,
      };
    }
  }

  /**
   * Log an info message.
   */
  info(message: string): void {
    if (this.mode === 'human') {
      console.log(`${this.getIndent()}${message}`);
    }
  }

  /**
   * Log a warning message.
   */
  warning(message: string): void {
    if (this.mode === 'human') {
      console.warn(`${this.getIndent()}⚠ ${message}`);
    }
  }

  /**
   * Log an action being performed.
   */
  action(description: string, symbol: string = '→'): void {
    if (this.mode === 'human') {
      console.log(`${this.getIndent()}${symbol} ${description}`);
    }
  }

  /**
   * Log an action starting.
   */
  actionStart(action: Action): void {
    if (this.mode === 'human') {
      const symbols: Record<string, string> = {
        create: '+',
        start: '▶',
        stop: '⏹',
        destroy: '-',
        checkpoint: '📸',
        restore: '↩',
      };
      const symbol = symbols[action.type] ?? '→';
      console.log(`${this.getIndent()}${symbol} ${action.type}: ${action.vmName}`);
    }
  }

  /**
   * Log an action completed.
   */
  actionComplete(action: Action): void {
    if (this.mode === 'human') {
      this.indent();
      console.log(`${this.getIndent()}✓ ${action.type} completed`);
      this.dedent();
    }
  }

  /**
   * Log an action failed.
   */
  actionFailed(action: Action, error: string): void {
    if (this.mode === 'human') {
      this.indent();
      console.error(`${this.getIndent()}✗ ${action.type} failed: ${error}`);
      this.dedent();
    }
  }

  /**
   * Log a table of data.
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

  /**
   * Print a blank line.
   */
  newline(): void {
    if (this.mode === 'human') {
      console.log();
    }
  }

  /**
   * Set the command name for JSON output.
   */
  setCommand(command: string): void {
    this.jsonBuffer.command = command;
  }

  /**
   * Set data for JSON output.
   */
  setData(data: unknown): void {
    this.jsonBuffer.data = data;
  }

  /**
   * Add data to the JSON output (merges with existing data).
   */
  addData(key: string, value: unknown): void {
    if (!this.jsonBuffer.data) {
      this.jsonBuffer.data = {};
    }
    (this.jsonBuffer.data as Record<string, unknown>)[key] = value;
  }

  /**
   * Set success status for JSON output.
   */
  setSuccess(success: boolean): void {
    this.jsonBuffer.success = success;
  }

  /**
   * Flush JSON output to stdout.
   *
   * Only does something in JSON mode.
   */
  flush(): void {
    if (this.mode === 'json') {
      console.log(JSON.stringify(this.jsonBuffer, null, 2));
    }
  }

  /**
   * Get the JSON buffer (for testing).
   */
  getJsonBuffer(): JsonOutput {
    return this.jsonBuffer;
  }

  /**
   * Create a logger from CLI options.
   */
  static fromOptions(options: { json?: boolean }): Logger {
    return new Logger(options.json ? 'json' : 'human');
  }
}

/**
 * Global logger instance.
 *
 * Can be replaced with a configured instance for different output modes.
 */
export let logger = new Logger();

/**
 * Set the global logger instance.
 */
export function setLogger(newLogger: Logger): void {
  logger = newLogger;
}

/**
 * Create and set a new logger with the specified mode.
 */
export function configureLogger(mode: OutputMode): Logger {
  logger = new Logger(mode);
  return logger;
}
