/**
 * Configuration Validator
 *
 * Validates configuration data against the JSON Schema using Ajv.
 */

import Ajv, { type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import type { RagnatrampConfig } from './types.js';
import configSchema from './schema.json' with { type: 'json' };

/**
 * Validation error details
 */
export interface ValidationError {
  /** JSON path to the invalid field */
  path: string;
  /** Human-readable error message */
  message: string;
  /** Additional error parameters from Ajv */
  params: Record<string, unknown>;
}

/**
 * Validation result - either success with config or failure with errors
 */
export type ValidationResult =
  | { valid: true; config: RagnatrampConfig }
  | { valid: false; errors: ValidationError[] };

// Create Ajv instance with options for detailed error reporting
// Note: strict mode is disabled for schema-level strictness because the conditional
// allOf logic for base_image validation uses a pattern that Ajv strict mode doesn't allow
const ajv = new Ajv.default({
  allErrors: true,
  verbose: true,
  strict: false,
});
addFormats.default(ajv);

// Compile the schema once
const validate = ajv.compile<RagnatrampConfig>(configSchema);

/**
 * Validate configuration data against the JSON Schema.
 *
 * @param data - Parsed YAML/JSON data to validate
 * @returns Validation result with either the typed config or detailed errors
 */
export function validateConfig(data: unknown): ValidationResult {
  const valid = validate(data);

  if (!valid) {
    const errors: ValidationError[] = (validate.errors ?? []).map(
      (error: ErrorObject) => ({
        path: error.instancePath || '/',
        message: error.message ?? 'Unknown validation error',
        params: error.params as Record<string, unknown>,
      })
    );

    return { valid: false, errors };
  }

  return { valid: true, config: data as RagnatrampConfig };
}

/**
 * Format validation errors into human-readable messages.
 *
 * @param errors - Array of validation errors
 * @returns Formatted error string with one error per line
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  return errors
    .map((error) => {
      const path = error.path || '/';
      return `  - ${path}: ${error.message}`;
    })
    .join('\n');
}
