# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ragna Tramp is a confined-environment, user-space CLI that emulates the core of Vagrant multi-machine orchestration for Hyper-V on Windows 11 Pro. It targets enterprise environments where users have "Hyper-V Administrators" group membership but limited system access.

## Build & Development Commands

```bash
npm run build    # Compile TypeScript (tsc) to dist/
npm run dev      # Run CLI directly via tsx (src/cli.ts)
npm test         # Run tests (not yet configured)
```

After building, the CLI is available as `ragnatramp` via the bin entry in package.json.

## Architecture Notes

- **Runtime**: Node.js (nvm-managed), ES modules (`"type": "module"`)
- **Entry point**: `src/cli.ts` → compiled to `dist/cli.js`
- **Hyper-V interaction**: All VM operations via `powershell.exe` cmdlet invocation (New-VM, Remove-VM, Start-VM, Stop-VM, Get-VM, Set-VM, checkpoint operations)
- **Config format**: Single YAML file (ragnatramp.yaml) - no scripting in YAML
- **State tracking**: `.ragnatramp/state.json` tracks managed VMs to prevent accidental deletion of unmanaged VMs
- **Networking**: Uses existing Hyper-V "Default Switch" only (MVP constraint)

## TypeScript Configuration

Strict mode enabled with additional strictness:
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `verbatimModuleSyntax: true`

## Speckit Workflow

This project uses speckit for specification-driven development. Key files:
- `.specify/memory/constitution.md` - Project principles (template, needs customization)
- Specs and plans are generated via `/speckit.*` slash commands
