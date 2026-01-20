# Research: Ragna Tramp MVP

**Feature**: 001-hyperv-vm-orchestration
**Date**: 2026-01-19

## Technology Decisions

### CLI Framework: Commander.js

**Decision**: Use `commander` for CLI parsing and command routing.

**Rationale**:
- Most popular Node.js CLI framework (10M+ weekly downloads)
- First-class TypeScript support with `@types/commander` or built-in types
- Declarative subcommand definition with automatic help generation
- Supports required/optional arguments, options, and flags
- No native dependencies

**Alternatives Considered**:
| Alternative | Rejected Because |
|------------|-----------------|
| yargs | More complex API, heavier bundle |
| oclif | Overkill for MVP; better for plugin ecosystems |
| cac | Less mature, smaller community |
| Node.js parseArgs | Too low-level, no subcommand support |

---

### YAML Parsing: js-yaml

**Decision**: Use `js-yaml` for parsing YAML configuration files.

**Rationale**:
- De facto standard for YAML in Node.js
- Fast, well-tested, actively maintained
- Supports YAML 1.1 and 1.2
- Safe loading mode prevents code execution
- No native dependencies

**Alternatives Considered**:
| Alternative | Rejected Because |
|------------|-----------------|
| yaml | Slightly smaller, but js-yaml has better ecosystem |
| Built-in JSON | YAML preferred for human-edited configs |

---

### Schema Validation: Ajv

**Decision**: Use `ajv` with `ajv-formats` for JSON Schema validation.

**Rationale**:
- Industry standard JSON Schema validator
- Detailed, customizable error messages
- Supports JSON Schema draft-07 (sufficient for our needs)
- `allErrors` mode collects all validation errors, not just first
- `verbose` mode provides context for better error messages
- Compiles schema once, validates many times (performance)

**Alternatives Considered**:
| Alternative | Rejected Because |
|------------|-----------------|
| joi | Different schema format, not JSON Schema |
| zod | TypeScript-first but runtime overhead, different syntax |
| yup | Focused on form validation, not config validation |

---

### Testing: Node.js Built-in Test Runner

**Decision**: Use `node --test` with `tsx` for TypeScript support.

**Rationale**:
- Zero additional dependencies for test runner
- Built into Node.js 20+ (LTS)
- Supports mocking via `node:test/mock`
- Supports code coverage via `--experimental-test-coverage`
- `tsx` provides seamless TypeScript execution without precompilation

**Alternatives Considered**:
| Alternative | Rejected Because |
|------------|-----------------|
| Jest | Heavy, slow startup, complex configuration |
| Vitest | Extra dependency, more suited for frontend |
| Mocha | Requires additional assertion library |

---

### PowerShell Invocation Strategy

**Decision**: Spawn `powershell.exe` with `-NoProfile -NonInteractive -Command` and parse JSON output.

**Rationale**:
- `-NoProfile`: Faster startup, predictable environment
- `-NonInteractive`: No prompts that would hang the process
- `-Command`: Execute inline script
- `ConvertTo-Json`: Machine-readable output for Node.js parsing
- `spawn` over `exec`: Better for large outputs, streaming

**Key Patterns**:

1. **JSON Output**: All queries end with `| ConvertTo-Json -Depth 3`
2. **Error Handling**: Check exit code, parse stderr for error classification
3. **Script Composition**: Build scripts as template strings, semicolon-separate commands
4. **Escaping**: Single quotes for string literals in PowerShell (no variable expansion)

**PowerShell Cmdlets Used**:
| Cmdlet | Purpose |
|--------|---------|
| Get-VM | Query existing VMs |
| New-VM | Create new VM |
| Remove-VM | Delete VM |
| Start-VM | Start VM |
| Stop-VM | Stop VM (graceful) |
| Set-VM | Configure VM (cpu, memory, notes) |
| New-VHD | Create differencing disk |
| Add-VMHardDiskDrive | Attach disk to VM |
| Connect-VMNetworkAdapter | Connect VM to switch |
| Checkpoint-VM | Create checkpoint |
| Restore-VMSnapshot | Restore checkpoint |
| Get-VMSnapshot | List checkpoints |
| Remove-VMSnapshot | Delete checkpoint |

---

### State Management: Local JSON File

**Decision**: Store state in `.ragnatramp/state.json` relative to config file.

**Rationale**:
- Human-readable for debugging
- No external dependencies (just `fs`)
- Atomic writes via temp file + rename
- Project-local state enables multiple independent projects
- Can be `.gitignore`d or version-controlled per user preference

**Alternatives Considered**:
| Alternative | Rejected Because |
|------------|-----------------|
| SQLite | Overkill, adds native dependency |
| LevelDB | Native dependency |
| Global state | Conflicts between projects |
| Hyper-V as source of truth | Can't track "managed by ragnatramp" reliably |

---

### VM Identification Strategy

**Decision**: Triple verification (state file + VM Notes + naming pattern).

**Rationale**:
1. **State file** is authoritative for "what ragnatramp created"
2. **VM Notes** provide out-of-band verification (survives state file deletion)
3. **Naming pattern** enables visual identification in Hyper-V Manager

**VM Notes Format**:
```
ragnatramp:v0.1.0
config:C:/projects/myapp/ragnatramp.yaml
managed:true
```

---

## Hyper-V Considerations

### Differencing Disks

Differencing disks (child VHDs) link to a parent (golden image):
- Parent must not be modified after children are created
- Children store only delta from parent
- Deletion of parent corrupts all children

**Mitigation**: Warn user in documentation; consider optional `copy` strategy.

### Default Switch Behavior

The "Default Switch" provides:
- NAT networking with internet access
- DHCP for guest VMs
- DNS forwarding

**Limitation**: No inbound connections from host to guest by default (would require explicit port forwarding in guest or Hyper-V NAT rules, which is out of MVP scope).

### Generation 2 VMs

Gen2 VMs:
- UEFI boot (not BIOS)
- Secure Boot enabled by default
- Better performance, modern features

**Requirement**: Golden images must be Gen2-compatible (UEFI-bootable).

---

## Risk Mitigations

| Risk | Mitigation |
|------|------------|
| Golden image moved/deleted | Pre-flight check verifies base image exists |
| State file corruption | JSON parse with recovery option; atomic writes |
| Partial failure during `up` | State updated after each VM; re-run converges |
| User not in Hyper-V Administrators | Pre-flight check with clear error message |
| Hyper-V service not running | Pre-flight check before any operations |
