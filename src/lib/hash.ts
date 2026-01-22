/**
 * Hash Utilities
 *
 * Provides SHA256 hashing for configuration files and content.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/**
 * Compute a short hash of a file's content.
 *
 * @param filePath - Path to the file to hash
 * @returns First 8 characters of SHA256 hash
 */
export async function computeConfigHash(filePath: string): Promise<string> {
  const content = await readFile(filePath, 'utf-8');
  return computeContentHash(content);
}

/**
 * Compute a short hash of string content.
 *
 * @param content - String content to hash
 * @returns First 8 characters of SHA256 hash
 */
export function computeContentHash(content: string): string {
  const hash = createHash('sha256').update(content).digest('hex');
  return hash.slice(0, 8);
}
