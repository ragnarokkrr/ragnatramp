# Spec-001 - Manual Tests: Checkpoints and Restore

This runbook tests the checkpoint and restore functionality (User Story 7).

## Prerequisites

- Completed basic lifecycle tests (VMs can be created/destroyed)
- Working config file at `tmp\manual-test\rt\two-vms.yaml`
- No existing VMs from previous test runs

---

## 1) Setup: Create Fresh VMs

Start with a clean slate:

```powershell
# Destroy any existing VMs
npx ragnatramp destroy "tmp\manual-test\rt\two-vms.yaml" --all

# Create fresh VMs
npx ragnatramp up "tmp\manual-test\rt\two-vms.yaml"

# Verify VMs are running
npx ragnatramp status "tmp\manual-test\rt\two-vms.yaml"
```

Expected:
- 2 VMs created and running
- State file exists at `tmp\manual-test\rt\.ragnatramp\state.json`

---

## 2) Create First Checkpoint

```powershell
npx ragnatramp checkpoint "tmp\manual-test\rt\two-vms.yaml" --name "baseline"
echo "Exit code: $LASTEXITCODE"
```

Expected:
- Exit code `0`
- Output shows checkpoint created for both VMs
- State file updated with checkpoint info

Verify in Hyper-V:

```powershell
Get-VMSnapshot -VMName "testproject2-*" | Format-Table VMName, Name, CreationTime
```

Expected:
- 2 snapshots named "baseline" (one per VM)

---

## 3) Verify Checkpoint in State File

```powershell
Get-Content "tmp\manual-test\rt\.ragnatramp\state.json" | ConvertFrom-Json | ConvertTo-Json -Depth 5
```

Expected:
- Each VM entry has `checkpoints` array with one entry
- Checkpoint has `id`, `name` ("baseline"), and `createdAt`

---

## 4) Create Second Checkpoint

```powershell
npx ragnatramp checkpoint "tmp\manual-test\rt\two-vms.yaml" --name "after-changes"
```

Expected:
- Exit code `0`
- 2 more snapshots created

Verify:

```powershell
Get-VMSnapshot -VMName "testproject2-*" | Format-Table VMName, Name, CreationTime
```

Expected:
- 4 total snapshots (2 VMs x 2 checkpoints each)

---

## 5) Restore to First Checkpoint

```powershell
npx ragnatramp restore "tmp\manual-test\rt\two-vms.yaml" --name "baseline"
echo "Exit code: $LASTEXITCODE"
```

Expected:
- Exit code `0`
- VMs restored to "baseline" checkpoint
- VMs may be stopped after restore (this is normal Hyper-V behavior)

Verify VM state:

```powershell
Get-VM -Name "testproject2-*" | Format-Table Name, State
```

---

## 6) Restore Non-Existent Checkpoint (Error Case)

```powershell
npx ragnatramp restore "tmp\manual-test\rt\two-vms.yaml" --name "does-not-exist"
echo "Exit code: $LASTEXITCODE"
```

Expected:
- Exit code `1` (user error)
- Clear error message indicating checkpoint not found
- No changes made to VMs

---

## 7) Checkpoint Without --name Flag (Error Case)

```powershell
npx ragnatramp checkpoint "tmp\manual-test\rt\two-vms.yaml"
echo "Exit code: $LASTEXITCODE"
```

Expected:
- Exit code `1`
- Error message: `--name` is required

---

## 8) Checkpoint with No VMs (Error Case)

```powershell
# First destroy all VMs
npx ragnatramp destroy "tmp\manual-test\rt\two-vms.yaml" --all

# Try to create checkpoint
npx ragnatramp checkpoint "tmp\manual-test\rt\two-vms.yaml" --name "empty"
echo "Exit code: $LASTEXITCODE"
```

Expected:
- Exit code `0` or `1` with message "No VMs to checkpoint"

---

## 9) JSON Output Mode

```powershell
# Recreate VMs
npx ragnatramp up "tmp\manual-test\rt\two-vms.yaml"

# Checkpoint with JSON output
npx ragnatramp checkpoint "tmp\manual-test\rt\two-vms.yaml" --name "json-test" --json
```

Expected:
- Valid JSON output
- Contains `success: true`, `command: "checkpoint"`, and checkpoint details

```powershell
# Restore with JSON output
npx ragnatramp restore "tmp\manual-test\rt\two-vms.yaml" --name "json-test" --json
```

Expected:
- Valid JSON output with restore status

---

## 10) Cleanup

```powershell
npx ragnatramp destroy "tmp\manual-test\rt\two-vms.yaml" --all

# Verify cleanup
Get-VM -Name "testproject2-*"
Get-VMSnapshot -VMName "testproject2-*"
Test-Path "tmp\manual-test\rt\.ragnatramp"
```

Expected:
- No VMs found
- No snapshots found
- `.ragnatramp` directory deleted

---

## Test Matrix Summary

| Test | Command | Expected Exit Code | Notes |
|------|---------|-------------------|-------|
| Create checkpoint | `checkpoint --name X` | 0 | Creates snapshot for all VMs |
| Multiple checkpoints | `checkpoint --name Y` | 0 | Can have multiple checkpoints |
| Restore checkpoint | `restore --name X` | 0 | Restores all VMs to checkpoint |
| Restore non-existent | `restore --name Z` | 1 | Error: checkpoint not found |
| Missing --name | `checkpoint` | 1 | Error: --name required |
| No VMs | `checkpoint --name X` | 0/1 | Graceful handling |
| JSON output | `--json` flag | 0 | Valid JSON structure |

---

## Known Behaviors

1. **VMs may stop after restore** - Hyper-V stops VMs when restoring snapshots. Run `up` again to restart them.

2. **Checkpoints are per-VM** - Each VM gets its own snapshot with the same name.

3. **Restore requires ALL VMs to have the checkpoint** - If any VM is missing the named checkpoint, restore fails for safety.

4. **Checkpoints persist in Hyper-V** - Destroying a VM also removes its Hyper-V snapshots.
