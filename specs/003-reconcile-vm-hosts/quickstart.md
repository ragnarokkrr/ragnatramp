# Quickstart: Reconcile VM IPs + Sync /etc/hosts

**Branch**: `003-reconcile-vm-hosts` | **Date**: 2026-02-02

## What this feature does

The `reconcile` command discovers IPv4 addresses for your managed VMs and updates `/etc/hosts` inside each VM so they can reach each other by hostname.

## Prerequisites

### Host (Windows)
- Existing ragnatramp setup (Hyper-V, Default Switch, VMs created via `ragnatramp up`)
- OpenSSH client installed (ships with Windows 10+)

### Guest (Linux VMs)
- **Required**: SSH server (`sshd`) running, key-based auth, passwordless sudo for SSH user
- **Recommended**: `hv_kvp_daemon` for faster IP discovery (Ubuntu: `sudo apt install linux-cloud-tools-$(uname -r)`)

## Configuration

Add an `ssh` block to your `ragnatramp.yaml`:

```yaml
project:
  name: myproject

defaults:
  cpu: 2
  memory: 2048
  base_image: "C:/HyperV/Golden/ubuntu.vhdx"
  ssh:
    user: kadmin
    private_key: "~/.ssh/id_rsa"

machines:
  - name: web
  - name: db
```

## Usage

### Discover IPs and sync hosts

```bash
ragnatramp reconcile ragnatramp.yaml
```

### Preview without making changes

```bash
ragnatramp reconcile ragnatramp.yaml --dry-run
```

### Verbose output (see PowerShell scripts and SSH commands)

```bash
ragnatramp reconcile ragnatramp.yaml --verbose
```

### Machine-readable JSON

```bash
ragnatramp reconcile ragnatramp.yaml --json
```

### Automatic reconcile via `up`

```bash
ragnatramp up ragnatramp.yaml
# Reconcile runs automatically after VMs are created/started
```

## What happens

1. Ragnatramp queries Hyper-V for each VM's network adapter
2. For each running VM, it discovers the IPv4 address:
   - First tries KVP (Hyper-V integration services reporting)
   - Falls back to ARP table lookup if KVP is unavailable
3. Saves discovered IPs to the state file (`.ragnatramp/state.json`)
4. Renders a managed hosts block and writes it into each VM's `/etc/hosts` via SSH

After reconcile, VMs can reach each other by name:

```bash
# From the 'web' VM:
ping db    # resolves to db's discovered IP
```

## Verifying it worked

```bash
# Check state file for IPs
ragnatramp status ragnatramp.yaml

# SSH into a VM and check /etc/hosts
ssh kadmin@<web-ip> cat /etc/hosts
# Should contain:
# # BEGIN RAGNATRAMP
# # Managed by ragnatramp - do not edit this block
# 172.18.186.136 db
# # END RAGNATRAMP
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `KVP daemon not running` warning | Guest missing `hv_kvp_daemon` | `sudo apt install linux-cloud-tools-$(uname -r)` in guest, then reboot |
| IP discovery times out (60s) | VM has no DHCP lease or both KVP and ARP fail | Check VM is connected to Default Switch; check VM has network inside guest |
| SSH unreachable warning | `sshd` not running or firewall blocking port 22 | Start `sshd` in guest; check `ufw` or `iptables` |
| Permission denied on `/etc/hosts` | SSH user lacks passwordless sudo | Add `<user> ALL=(ALL) NOPASSWD: ALL` to guest sudoers |
| Hosts sync skipped (duplicate IP) | Two VMs got same DHCP address | Restart one VM to get a new lease; check Default Switch DHCP |
