/**
 * Error Types for Ragnatramp
 *
 * Custom error classes with error codes for structured error handling.
 */

/**
 * Error codes for all ragnatramp errors
 */
export type ErrorCode =
  | 'CONFIG_NOT_FOUND'
  | 'CONFIG_INVALID_YAML'
  | 'CONFIG_VALIDATION_FAILED'
  | 'BASE_IMAGE_NOT_FOUND'
  | 'DEFAULT_SWITCH_NOT_FOUND'
  | 'HYPERV_NOT_AVAILABLE'
  | 'PERMISSION_DENIED'
  | 'VM_NOT_FOUND'
  | 'CHECKPOINT_NOT_FOUND'
  | 'STATE_CORRUPTED'
  | 'STATE_NOT_FOUND'
  | 'OWNERSHIP_VERIFICATION_FAILED'
  | 'HYPERV_ERROR'
  | 'OPERATION_FAILED';

/**
 * Mapping of error codes to exit codes
 */
export const EXIT_CODES: Record<ErrorCode, number> = {
  CONFIG_NOT_FOUND: 1,
  CONFIG_INVALID_YAML: 1,
  CONFIG_VALIDATION_FAILED: 1,
  BASE_IMAGE_NOT_FOUND: 1,
  DEFAULT_SWITCH_NOT_FOUND: 2,
  HYPERV_NOT_AVAILABLE: 2,
  PERMISSION_DENIED: 2,
  VM_NOT_FOUND: 1,
  CHECKPOINT_NOT_FOUND: 1,
  STATE_CORRUPTED: 2,
  STATE_NOT_FOUND: 1,
  OWNERSHIP_VERIFICATION_FAILED: 1,
  HYPERV_ERROR: 2,
  OPERATION_FAILED: 2,
};

/**
 * Base error class for all ragnatramp errors.
 *
 * Provides structured error information with codes and suggestions.
 */
export class RagnatrampError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly suggestion?: string
  ) {
    super(message);
    this.name = 'RagnatrampError';
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, RagnatrampError.prototype);
  }

  /**
   * Get the exit code for this error.
   */
  get exitCode(): number {
    return EXIT_CODES[this.code];
  }

  /**
   * Format the error for display.
   */
  format(): string {
    let output = `Error: ${this.message}`;
    if (this.suggestion) {
      output += `\n\nFix: ${this.suggestion}`;
    }
    return output;
  }
}

/**
 * Error for configuration-related issues.
 */
export class ConfigError extends RagnatrampError {
  constructor(
    message: string,
    code: 'CONFIG_NOT_FOUND' | 'CONFIG_INVALID_YAML' | 'CONFIG_VALIDATION_FAILED',
    suggestion?: string,
    public readonly path?: string,
    public readonly validationErrors?: Array<{
      path: string;
      message: string;
    }>
  ) {
    super(message, code, suggestion);
    this.name = 'ConfigError';
    Object.setPrototypeOf(this, ConfigError.prototype);
  }

  override format(): string {
    let output = super.format();
    if (this.validationErrors && this.validationErrors.length > 0) {
      output += '\n\nValidation errors:';
      for (const error of this.validationErrors) {
        output += `\n  - ${error.path}: ${error.message}`;
      }
    }
    return output;
  }
}

/**
 * Error for state-related issues.
 */
export class StateError extends RagnatrampError {
  constructor(
    message: string,
    code: 'STATE_CORRUPTED' | 'STATE_NOT_FOUND',
    suggestion?: string,
    public readonly statePath?: string
  ) {
    super(message, code, suggestion);
    this.name = 'StateError';
    Object.setPrototypeOf(this, StateError.prototype);
  }
}

/**
 * Error for preflight check failures.
 */
export class PreflightError extends RagnatrampError {
  constructor(
    message: string,
    code: 'HYPERV_NOT_AVAILABLE' | 'DEFAULT_SWITCH_NOT_FOUND' | 'BASE_IMAGE_NOT_FOUND' | 'PERMISSION_DENIED',
    suggestion?: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message, code, suggestion);
    this.name = 'PreflightError';
    Object.setPrototypeOf(this, PreflightError.prototype);
  }
}

/**
 * Error for ownership verification failures.
 */
export class OwnershipError extends RagnatrampError {
  constructor(
    message: string,
    public readonly vmName: string,
    public readonly checks: {
      inStateFile: boolean;
      hasMarkerInNotes: boolean;
      nameMatchesPattern: boolean;
    }
  ) {
    super(
      message,
      'OWNERSHIP_VERIFICATION_FAILED',
      'This VM was not created by ragnatramp or belongs to a different configuration. Manual deletion via Hyper-V Manager may be required.'
    );
    this.name = 'OwnershipError';
    Object.setPrototypeOf(this, OwnershipError.prototype);
  }
}

/**
 * Error for Hyper-V operation failures.
 *
 * Re-exported from hyperv/executor.ts for convenience, but also
 * provides a standalone implementation for cases where the executor
 * error needs to be wrapped.
 */
export class HyperVOperationError extends RagnatrampError {
  public readonly psExitCode: number | null;

  constructor(
    message: string,
    psExitCode: number | null,
    public readonly stderr: string,
    public readonly script?: string
  ) {
    super(message, 'HYPERV_ERROR');
    this.name = 'HyperVOperationError';
    this.psExitCode = psExitCode;
    Object.setPrototypeOf(this, HyperVOperationError.prototype);
  }
}

/**
 * Check if an error is a RagnatrampError.
 */
export function isRagnatrampError(error: unknown): error is RagnatrampError {
  return error instanceof RagnatrampError;
}

/**
 * Get the exit code for any error.
 */
export function getExitCode(error: unknown): number {
  if (isRagnatrampError(error)) {
    return error.exitCode;
  }
  // Default to system error for unknown errors
  return 2;
}
