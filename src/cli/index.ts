#!/usr/bin/env node
import { program } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { upCommand } from './commands/up.js';
import { validateCommand } from './commands/validate.js';
import { planCommand } from './commands/plan.js';

// Get version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packagePath = join(__dirname, '..', '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8')) as { version: string };

program
  .name('ragnatramp')
  .description('Vagrant-like VM orchestration for Hyper-V on Windows 11 Pro')
  .version(packageJson.version);

// Commands will be added in subsequent phases
// For now, provide a placeholder to verify CLI works

program
  .command('validate <file>')
  .description('Validate YAML configuration against schema')
  .option('--json', 'Output as JSON')
  .action(validateCommand);

program
  .command('plan <file>')
  .description('Show intended actions without executing')
  .option('--json', 'Output as JSON')
  .action(planCommand);

program
  .command('up <file>')
  .description('Create/start VMs to match configuration')
  .option('--json', 'Output as JSON')
  .action(upCommand);

program
  .command('status <file>')
  .description('Show status of managed VMs')
  .option('--json', 'Output as JSON')
  .action((_file: string, _options: { json?: boolean }) => {
    console.log('status command not yet implemented');
    process.exit(1);
  });

program
  .command('halt <file> [machine]')
  .description('Stop managed VMs')
  .option('--all', 'Stop all managed VMs')
  .option('--json', 'Output as JSON')
  .action((_file: string, _machine: string | undefined, _options: { all?: boolean; json?: boolean }) => {
    console.log('halt command not yet implemented');
    process.exit(1);
  });

program
  .command('destroy <file> [machine]')
  .description('Remove managed VMs and their disks')
  .option('--all', 'Destroy all managed VMs')
  .option('--json', 'Output as JSON')
  .action((_file: string, _machine: string | undefined, _options: { all?: boolean; json?: boolean }) => {
    console.log('destroy command not yet implemented');
    process.exit(1);
  });

program
  .command('checkpoint <file>')
  .description('Create checkpoint for managed VMs')
  .requiredOption('--name <name>', 'Checkpoint name')
  .option('--json', 'Output as JSON')
  .action((_file: string, _options: { name: string; json?: boolean }) => {
    console.log('checkpoint command not yet implemented');
    process.exit(1);
  });

program
  .command('restore <file>')
  .description('Restore managed VMs from checkpoint')
  .requiredOption('--name <name>', 'Checkpoint name')
  .option('--json', 'Output as JSON')
  .action((_file: string, _options: { name: string; json?: boolean }) => {
    console.log('restore command not yet implemented');
    process.exit(1);
  });

program.parse();
