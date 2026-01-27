/**
 * PowerShell Command Builders
 *
 * Builds PowerShell script strings for Hyper-V cmdlet execution.
 * All scripts return JSON output via ConvertTo-Json.
 */

import type { CreateVMParams, CreateCheckpointParams } from './types.js';

/**
 * Escape a string for safe use in PowerShell single-quoted strings.
 * Single quotes in PowerShell are escaped by doubling them.
 */
export function escapePowerShellString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Build script to get all VMs with relevant properties.
 *
 * Returns: HyperVVM[]
 */
export function buildGetVMsScript(): string {
  return `
$vms = Get-VM | Select-Object Id, Name, Notes,
  @{N='State';E={$_.State.ToString()}},
  @{N='MemoryMB';E={[math]::Round($_.MemoryStartup/1MB)}},
  @{N='CPUCount';E={$_.ProcessorCount}}
if ($vms -eq $null) { '[]' } elseif ($vms -is [array]) { $vms | ConvertTo-Json -Depth 3 } else { ConvertTo-Json @($vms) -Depth 3 }
`.trim();
}

/**
 * Build script to get a specific VM by name.
 *
 * @param name - VM name to query
 * Returns: HyperVVM | null
 */
export function buildGetVMByNameScript(name: string): string {
  const safeName = escapePowerShellString(name);
  return `
$vm = Get-VM -Name '${safeName}' -ErrorAction SilentlyContinue | Select-Object Id, Name, Notes,
  @{N='State';E={$_.State.ToString()}},
  @{N='MemoryMB';E={[math]::Round($_.MemoryStartup/1MB)}},
  @{N='CPUCount';E={$_.ProcessorCount}}
if ($vm) { $vm | ConvertTo-Json -Depth 3 } else { 'null' }
`.trim();
}

/**
 * Build script to get a specific VM by ID.
 *
 * @param id - VM GUID
 * Returns: HyperVVM | null
 */
export function buildGetVMByIdScript(id: string): string {
  const safeId = escapePowerShellString(id);
  return `
$vm = Get-VM -Id '${safeId}' -ErrorAction SilentlyContinue | Select-Object Id, Name, Notes,
  @{N='State';E={$_.State.ToString()}},
  @{N='MemoryMB';E={[math]::Round($_.MemoryStartup/1MB)}},
  @{N='CPUCount';E={$_.ProcessorCount}}
if ($vm) { $vm | ConvertTo-Json -Depth 3 } else { 'null' }
`.trim();
}

/**
 * Build script to create a new VM with differencing or copied disk.
 *
 * @param params - VM creation parameters
 * Returns: CreateVMResult
 */
export function buildCreateVMScript(params: CreateVMParams): string {
  const safeName = escapePowerShellString(params.name);
  const safeBaseImage = escapePowerShellString(params.baseImage);
  const safeDiskPath = escapePowerShellString(params.diskPath);
  const safeNotes = escapePowerShellString(params.notes);
  const autoStart = params.autoStart !== false; // Default to true

  const diskCreation = params.differencing
    ? `New-VHD -Path '${safeDiskPath}' -ParentPath '${safeBaseImage}' -Differencing | Out-Null`
    : `Copy-Item -Path '${safeBaseImage}' -Destination '${safeDiskPath}' -Force`;

  const startCommand = autoStart ? `\nStart-VM -VM $vm` : '';

  return `
$ErrorActionPreference = 'Stop'
# Ensure disk directory exists
$diskDir = Split-Path -Parent '${safeDiskPath}'
if (-not (Test-Path $diskDir)) { New-Item -ItemType Directory -Path $diskDir -Force | Out-Null }
# Create disk
${diskCreation}
# Create VM (Gen1 for broader compatibility with various disk images)
$vm = New-VM -Name '${safeName}' -Generation 1 -MemoryStartupBytes ${params.memoryMB}MB -NoVHD
Set-VM -VMName $vm.Name -ProcessorCount ${params.cpu}
Add-VMHardDiskDrive -VMName $vm.Name -Path '${safeDiskPath}'
Connect-VMNetworkAdapter -VMName $vm.Name -SwitchName 'Default Switch'
Set-VM -VMName $vm.Name -Notes '${safeNotes}'${startCommand}
$vm | Select-Object Id, Name | ConvertTo-Json
`.trim();
}

/**
 * Build script to start a VM.
 *
 * @param vmId - VM GUID
 */
export function buildStartVMScript(vmId: string): string {
  const safeId = escapePowerShellString(vmId);
  return `
$ErrorActionPreference = 'Stop'
Start-VM -Id '${safeId}'
'null'
`.trim();
}

/**
 * Build script to stop a VM.
 *
 * @param vmId - VM GUID
 * @param force - If true, force shutdown without graceful attempt
 */
export function buildStopVMScript(vmId: string, force: boolean = false): string {
  const safeId = escapePowerShellString(vmId);
  const forceFlag = force ? ' -Force' : ' -Force'; // Always use -Force for reliability
  // Note: -TurnOff immediately powers off without graceful shutdown
  // For graceful: use Stop-VM without -TurnOff, then timeout and force
  return `
$ErrorActionPreference = 'Stop'
$vm = Get-VM -Id '${safeId}'
Stop-VM -VM $vm${forceFlag}
'null'
`.trim();
}

/**
 * Build script to gracefully stop a VM with fallback to force.
 *
 * @param vmId - VM GUID
 * @param timeoutSeconds - Seconds to wait before forcing (default: 30)
 */
export function buildGracefulStopVMScript(vmId: string, timeoutSeconds: number = 30): string {
  const safeId = escapePowerShellString(vmId);
  return `
$ErrorActionPreference = 'Stop'
$vm = Get-VM -Id '${safeId}'
if ($vm.State -eq 'Running') {
  Stop-VM -VM $vm -Force:$false -ErrorAction SilentlyContinue
  $waited = 0
  while ($waited -lt ${timeoutSeconds}) {
    Start-Sleep -Seconds 1
    $waited++
    $vm = Get-VM -Id '${safeId}'
    if ($vm.State -ne 'Running') { break }
  }
  if ($vm.State -eq 'Running') {
    Stop-VM -VM $vm -TurnOff
  }
}
'null'
`.trim();
}

/**
 * Build script to remove a VM (does not delete disk).
 *
 * @param vmId - VM GUID
 */
export function buildRemoveVMScript(vmId: string): string {
  const safeId = escapePowerShellString(vmId);
  return `
$ErrorActionPreference = 'Stop'
$vm = Get-VM -Id '${safeId}' -ErrorAction SilentlyContinue
if ($vm) {
  if ($vm.State -eq 'Running') { Stop-VM -VM $vm -TurnOff }
  Remove-VM -VM $vm -Force
}
'null'
`.trim();
}

/**
 * Build script to create a checkpoint for a VM.
 *
 * @param params - Checkpoint creation parameters
 * Returns: CreateCheckpointResult
 */
export function buildCheckpointVMScript(params: CreateCheckpointParams): string {
  const safeVmId = escapePowerShellString(params.vmId);
  const safeName = escapePowerShellString(params.name);
  return `
$ErrorActionPreference = 'Stop'
$checkpoint = Checkpoint-VM -Id '${safeVmId}' -SnapshotName '${safeName}' -Passthru
$checkpoint | Select-Object Id, Name, VMId | ConvertTo-Json
`.trim();
}

/**
 * Build script to restore a VM to a snapshot.
 *
 * @param vmId - VM GUID
 * @param snapshotId - Snapshot GUID
 */
export function buildRestoreVMSnapshotScript(vmId: string, snapshotId: string): string {
  const safeVmId = escapePowerShellString(vmId);
  const safeSnapshotId = escapePowerShellString(snapshotId);
  return `
$ErrorActionPreference = 'Stop'
$vm = Get-VM -Id '${safeVmId}'
if ($vm.State -eq 'Running') { Stop-VM -VM $vm -TurnOff }
$snapshot = Get-VMSnapshot -VMId '${safeVmId}' | Where-Object { $_.Id -eq '${safeSnapshotId}' }
if (-not $snapshot) { throw "Snapshot not found: ${safeSnapshotId}" }
Restore-VMSnapshot -VMSnapshot $snapshot -Confirm:$false
'null'
`.trim();
}

/**
 * Build script to get all snapshots for a VM.
 *
 * @param vmId - VM GUID
 * Returns: HyperVCheckpoint[]
 */
export function buildGetVMSnapshotsScript(vmId: string): string {
  const safeVmId = escapePowerShellString(vmId);
  return `
$snapshots = Get-VMSnapshot -VMId '${safeVmId}' -ErrorAction SilentlyContinue | Select-Object Id, Name, VMId, VMName, CreationTime
if ($snapshots -eq $null) { '[]' } elseif ($snapshots -is [array]) { $snapshots | ConvertTo-Json -Depth 3 } else { ConvertTo-Json @($snapshots) -Depth 3 }
`.trim();
}

/**
 * Build script to delete a snapshot.
 *
 * @param vmId - VM GUID
 * @param snapshotId - Snapshot GUID
 */
export function buildRemoveVMSnapshotScript(vmId: string, snapshotId: string): string {
  const safeVmId = escapePowerShellString(vmId);
  const safeSnapshotId = escapePowerShellString(snapshotId);
  return `
$ErrorActionPreference = 'Stop'
$snapshot = Get-VMSnapshot -VMId '${safeVmId}' | Where-Object { $_.Id -eq '${safeSnapshotId}' }
if ($snapshot) { Remove-VMSnapshot -VMSnapshot $snapshot -Confirm:$false }
'null'
`.trim();
}

/**
 * Build script to check if Hyper-V is available.
 *
 * Returns: { available: boolean, message?: string }
 */
export function buildCheckHyperVScript(): string {
  return `
$result = @{ available = $false }
try {
  $vmms = Get-Service vmms -ErrorAction Stop
  if ($vmms.Status -eq 'Running') {
    $result.available = $true
  } else {
    $result.message = "Hyper-V Virtual Machine Management service (vmms) is not running"
  }
} catch {
  $result.message = "Hyper-V is not installed or accessible: $($_.Exception.Message)"
}
$result | ConvertTo-Json
`.trim();
}

/**
 * Build script to check if Default Switch exists.
 *
 * Returns: { exists: boolean, name?: string }
 */
export function buildCheckDefaultSwitchScript(): string {
  return `
$result = @{ exists = $false }
$switch = Get-VMSwitch -Name 'Default Switch' -ErrorAction SilentlyContinue
if ($switch) {
  $result.exists = $true
  $result.name = $switch.Name
}
$result | ConvertTo-Json
`.trim();
}

/**
 * Build script to check if a file (base image) exists.
 *
 * @param path - File path to check
 * Returns: { exists: boolean, path: string }
 */
export function buildCheckFileExistsScript(path: string): string {
  const safePath = escapePowerShellString(path);
  return `
$result = @{ exists = (Test-Path -Path '${safePath}' -PathType Leaf); path = '${safePath}' }
$result | ConvertTo-Json
`.trim();
}

/**
 * Build script to delete a file (disk).
 *
 * @param path - File path to delete
 */
export function buildDeleteFileScript(path: string): string {
  const safePath = escapePowerShellString(path);
  return `
if (Test-Path -Path '${safePath}') { Remove-Item -Path '${safePath}' -Force }
'null'
`.trim();
}
