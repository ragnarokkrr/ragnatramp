/**
 * Verbose Output Helpers
 *
 * Formats PowerShell commands for --verbose CLI output.
 * Used exclusively by HyperVExecutor to print commands to stderr
 * before execution.
 */

/**
 * Prefix for verbose command output lines.
 */
const PREFIX = '[PS] ';

/**
 * Indent for continuation lines (matches PREFIX width).
 */
const CONTINUATION_INDENT = '     ';

/**
 * ANSI SGR 90 — bright black (gray) foreground.
 */
const ANSI_GRAY = '\x1b[90m';

/**
 * ANSI SGR 0 — reset all attributes.
 */
const ANSI_RESET = '\x1b[0m';

/**
 * Check whether stderr supports ANSI escape codes.
 *
 * Returns true when stderr is a TTY (interactive terminal).
 * Returns false when stderr is piped, redirected, or non-interactive.
 */
export function supportsAnsi(): boolean {
  return Boolean(process.stderr.isTTY);
}

/**
 * Format a PowerShell script for verbose output.
 *
 * Produces a fenced block suitable for writing to stderr:
 * - Blank line before and after the command block
 * - First line prefixed with `[PS] `
 * - Continuation lines indented with 5 spaces (matching prefix width)
 * - Optionally wrapped in ANSI gray (SGR 90) when `ansi` is true
 *
 * @param script - The PowerShell script to format
 * @param ansi - Whether to wrap output in ANSI gray escape codes
 * @returns Formatted string ready for `process.stderr.write()`
 */
export function formatCommand(script: string, ansi: boolean): string {
  const lines = script.split('\n');

  let body = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (i === 0) {
      body += `${PREFIX}${line}\n`;
    } else {
      body += `${CONTINUATION_INDENT}${line}\n`;
    }
  }

  // Fence with blank lines
  const plain = `\n${body}\n`;

  if (ansi) {
    return `${ANSI_GRAY}${plain}${ANSI_RESET}`;
  }

  return plain;
}
