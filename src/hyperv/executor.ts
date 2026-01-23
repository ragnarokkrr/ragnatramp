/**
 * PowerShell Executor for Hyper-V Operations
 *
 * Spawns powershell.exe to execute Hyper-V cmdlets and parses JSON responses.
 */

import { spawn } from 'node:child_process';

/**
 * Error codes for Hyper-V operations
 */
export type HyperVErrorCode =
  | 'ACCESS_DENIED'
  | 'NOT_FOUND'
  | 'INVALID_RESPONSE'
  | 'EXECUTION_FAILED'
  | 'HYPERV_NOT_AVAILABLE';

/**
 * Error thrown when a Hyper-V operation fails
 */
export class HyperVError extends Error {
  constructor(
    message: string,
    public readonly code: HyperVErrorCode,
    public readonly exitCode: number | null,
    public readonly stderr: string,
    public readonly script: string
  ) {
    super(message);
    this.name = 'HyperVError';
  }
}

/**
 * Options for executing PowerShell scripts
 */
export interface ExecuteOptions {
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/**
 * Executes Hyper-V cmdlets via PowerShell and parses JSON responses.
 */
export class HyperVExecutor {
  private readonly powershellPath: string;

  constructor(powershellPath: string = 'powershell.exe') {
    this.powershellPath = powershellPath;
  }

  /**
   * Execute a PowerShell script and return parsed JSON result.
   *
   * @param script - PowerShell script to execute
   * @param options - Execution options
   * @returns Parsed JSON result
   * @throws HyperVError if execution fails
   */
  async execute<T>(script: string, options: ExecuteOptions = {}): Promise<T> {
    const { timeout = 30000 } = options;

    return new Promise<T>((resolve, reject) => {
      const ps = spawn(this.powershellPath, [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        script,
      ]);

      let stdout = '';
      let stderr = '';
      let killed = false;

      const timeoutId = setTimeout(() => {
        killed = true;
        ps.kill('SIGTERM');
        reject(
          new HyperVError(
            `PowerShell execution timed out after ${timeout}ms`,
            'EXECUTION_FAILED',
            null,
            stderr,
            script
          )
        );
      }, timeout);

      ps.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      ps.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      ps.on('error', (error: Error) => {
        clearTimeout(timeoutId);
        if (!killed) {
          reject(
            new HyperVError(
              `Failed to spawn PowerShell: ${error.message}`,
              'HYPERV_NOT_AVAILABLE',
              null,
              stderr,
              script
            )
          );
        }
      });

      ps.on('close', (code: number | null) => {
        clearTimeout(timeoutId);
        if (killed) return;

        if (code !== 0) {
          const errorCode = this.classifyError(stderr, code);
          reject(
            new HyperVError(
              this.formatErrorMessage(stderr, code),
              errorCode,
              code,
              stderr,
              script
            )
          );
          return;
        }

        // Handle empty output (e.g., from commands that don't return data)
        const trimmedOutput = stdout.trim();
        if (trimmedOutput === '' || trimmedOutput === 'null') {
          resolve(null as T);
          return;
        }

        try {
          const result = JSON.parse(trimmedOutput) as T;
          resolve(result);
        } catch {
          reject(
            new HyperVError(
              `Invalid JSON response from PowerShell: ${trimmedOutput.slice(0, 200)}`,
              'INVALID_RESPONSE',
              code,
              stderr,
              script
            )
          );
        }
      });
    });
  }

  /**
   * Execute a PowerShell script that returns no meaningful output.
   *
   * @param script - PowerShell script to execute
   * @param options - Execution options
   * @throws HyperVError if execution fails
   */
  async executeVoid(script: string, options: ExecuteOptions = {}): Promise<void> {
    await this.execute<unknown>(script, options);
  }

  /**
   * Classify the error based on stderr content and exit code.
   */
  private classifyError(stderr: string, exitCode: number | null): HyperVErrorCode {
    const lowerStderr = stderr.toLowerCase();

    // Access denied / permission issues
    if (
      lowerStderr.includes('access denied') ||
      lowerStderr.includes('access is denied') ||
      lowerStderr.includes('permission denied') ||
      lowerStderr.includes('not have permission') ||
      lowerStderr.includes('unauthorized')
    ) {
      return 'ACCESS_DENIED';
    }

    // Resource not found
    if (
      lowerStderr.includes('not found') ||
      lowerStderr.includes('does not exist') ||
      lowerStderr.includes('cannot find') ||
      lowerStderr.includes('unable to find')
    ) {
      return 'NOT_FOUND';
    }

    // Hyper-V not available
    if (
      lowerStderr.includes('hyper-v') ||
      lowerStderr.includes('vmms') ||
      lowerStderr.includes('virtualization')
    ) {
      return 'HYPERV_NOT_AVAILABLE';
    }

    return 'EXECUTION_FAILED';
  }

  /**
   * Format a user-friendly error message from stderr.
   */
  private formatErrorMessage(stderr: string, exitCode: number | null): string {
    // Extract the most relevant error line
    const lines = stderr.trim().split('\n');
    const errorLine = lines.find(
      (line) =>
        line.includes('Error') ||
        line.includes('Exception') ||
        line.includes('Cannot') ||
        line.includes('Unable')
    );

    if (errorLine) {
      return errorLine.trim();
    }

    if (stderr.trim()) {
      // Return first meaningful line
      return lines[0]?.trim() ?? `PowerShell exited with code ${exitCode}`;
    }

    return `PowerShell exited with code ${exitCode}`;
  }
}
