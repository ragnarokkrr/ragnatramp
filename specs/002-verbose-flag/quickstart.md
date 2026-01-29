# Quickstart: Global --verbose Flag

**Branch**: `002-verbose-flag` | **Date**: 2026-01-29

## Usage

Add `--verbose` to any ragnatramp command to see the exact PowerShell
commands being executed:

```powershell
ragnatramp up ragnatramp.yaml --verbose
```

### Example Output

```
Loading configuration: ragnatramp.yaml
✓ Configuration validated
Running preflight checks...

[PS] $svc = Get-Service VMMS -ErrorAction SilentlyContinue;
     if ($svc -and $svc.Status -eq 'Running') {
       @{ available = $true } | ConvertTo-Json
     } else {
       @{ available = $false; message = 'VMMS not running' } | ConvertTo-Json
     }

✓ Preflight checks passed
✓ Creating VM: myproject-web-a1b2c3d4
  CPU: 2, Memory: 2048 MB
  Disk: C:\...\web.vhdx (differencing)

[PS] $vm = New-VM -Name 'myproject-web-a1b2c3d4' ...
     ...

  ✓ VM created
  ✓ VM started
```

The `[PS]` lines are printed to **stderr** in subdued gray. Normal output
goes to stdout as usual.

### Combine with --json

```powershell
ragnatramp status ragnatramp.yaml --json --verbose
```

JSON goes to stdout; verbose commands go to stderr. They do not interfere.

### Capture verbose output to a file

```powershell
ragnatramp up ragnatramp.yaml --verbose 2>verbose.log
```

When stderr is redirected, ANSI colors are automatically omitted. The log
file contains plain text.

### Copy-paste commands

Every printed command is copy-paste runnable. To reproduce a failing
operation, copy the `[PS]` block and paste it into a PowerShell terminal.

## Validation

1. Run with `--verbose` — confirm `[PS]` lines appear before each operation.
2. Run without `--verbose` — confirm no `[PS]` lines appear.
3. Run `--verbose 2>log.txt` — confirm `log.txt` has no ANSI escape codes.
4. Copy a `[PS]` block and paste into PowerShell — confirm it runs.
