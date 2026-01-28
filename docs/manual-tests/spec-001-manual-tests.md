Spec-001 - Manual Tests Runbook
=================================

### What your `package.json` says (and what your runbook must obey)

* **Node >= 20** (non-negotiable)
* Build is **`tsc` → `dist/…`**
* CLI entry is **`dist/cli/index.js`** (`main` + `bin`)
* Dev mode runs **`tsx src/cli/index.ts`**
* Tests are **Node’s built-in test runner** with tsx loader

So the runbook should be centered around:

* `npm run dev` (fast feedback)
* `npm run build` + `npx ragnatramp …` (real distribution path)
* `npm test` (sanity)

And yes: using `node dist/cli/index.js` works, but it’s **not** the best contract now that you have `bin`.

---

## Updated Manual MVP Test Runbook (branch 001-hyperv-vm-orchestration)

### 0) Pre-flight: environment and permissions

Run **non-admin** PowerShell:

```powershell
node -v
npm -v
whoami /groups | findstr /i "Hyper-V Administrators"
```

Expected:

* Node `v20+`
* Hyper-V Administrators group present

If Node < 20 → fix before continuing.

---

## 1) Install, lint, build

From repo root:

```powershell
npm ci
npm run lint
npm run build
```

Verify build artifact exists:

```powershell
dir dist\cli
```

Expected: `index.js`

---

## 2) Run the CLI the *right* way (via bin)

Because you have `bin`, you can run the CLI as a package:

### Option A (recommended): `npx` runs the local package bin

```powershell
npx ragnatramp --help
```

### Option B: direct node (still fine, but less “product-like”)

```powershell
node .\dist\cli\index.js --help
```

**Record the `--help` output** into a log file:

```powershell
mkdir .\tmp\manual-test -Force | Out-Null
npx ragnatramp --help | Tee-Object -FilePath .\tmp\manual-test\help.txt
```

✅ **TODO rule:** if `--help` is unclear / missing commands / no examples → P0.

---

## 3) Dev loop (fast iteration)

Before touching Hyper-V resources, confirm the dev entrypoint works:

```powershell
npm run dev -- --help
```

If dev works but dist doesn’t: that’s a build/ESM/paths issue. If dist works but dev doesn’t: tsx/tsconfig issue.

---

## 4) Config discovery (don’t invent the schema)

Your deps show **`js-yaml` + `ajv` + `ajv-formats`**, so config is likely YAML validated by JSON Schema.

Find the schema and example(s):

```powershell
Get-ChildItem -Recurse -Path src -File |
  Select-String -Pattern "schema|ajv|compile|js-yaml|load\(|Ragnatramp|ragnatramp" |
  Format-Table Path, LineNumber, Line -AutoSize

rg -n "\.ya?ml|Ragnatrampfile|config" .
```

Expected outcomes:

* A schema file (ex: `src/config/schema.json`)
* A default config filename expectation
* Possibly an `examples/` folder

✅ If there is no example config in repo → **P0 TODO** (“Provide minimal example config”).

---

## 5) Minimal MVP test config (2 VMs, Default Switch)

Create a test workspace:

```powershell
mkdir .\tmp\manual-test\rt -Force | Out-Null
```

Put your config in there using whatever filename the CLI expects.

If the CLI supports a `--config` flag, we’ll use it. If it expects a default filename, use that.

---

## 6) Execute MVP lifecycle tests (command names must match `--help`)

### A) Validate / Parse

Run the validate-equivalent command shown in help, e.g.:

```powershell
npx ragnatramp validate --config .\tmp\manual-test\rt\<yourfile>
echo $LASTEXITCODE
```

Expected:

* Exit code `0`
* Clear validation output

### B) Plan (if present)

```powershell
npx ragnatramp plan --config .\tmp\manual-test\rt\<yourfile>
```

Expected: shows actions, creates nothing.

If there’s no plan command → add TODO (P1): “Implement plan/dry-run”.

### C) Up / Apply

```powershell
npx ragnatramp up --config .\tmp\manual-test\rt\<yourfile>
```

Expected:

* Creates 2 VMs
* Attaches to **Default Switch**
* Uses the golden image strategy defined by config (clone/copy/diff)

### D) Verify with Hyper-V as the truth source

```powershell
Get-VM | ? Name -like "test-*" | Format-Table Name, State, CPUUsage, MemoryAssigned
Get-VMNetworkAdapter -VMName rt-mvp-01 | Format-Table VMName, SwitchName, Status
```

Expect SwitchName = `Default Switch`.

### E) Status

```powershell
npx ragnatramp status --config .\tmp\manual-test\rt\<yourfile>
```

Expected: matches `Get-VM` reality.

### F) Idempotency (non-negotiable MVP)

Run `up` again:

```powershell
npx ragnatramp up --config .\tmp\manual-test\rt\<yourfile>
```

Expected:

* No duplicates
* Output explicitly says “no changes” / “already exists”

### G) Down / Destroy

```powershell
npx ragnatramp down --config .\tmp\manual-test\rt\<yourfile>
```

Verify cleanup:

```powershell
Get-VM | ? Name -like "rt-*" 
```

If `down` only stops and doesn’t delete, fine — but then you need a separate `destroy` command and the contract must say so.

---

## 7) Run tests (sanity, not a replacement for manual)

```powershell
npm test
```

If tests exist but don’t cover Hyper-V boundary calls, add a TODO: “Add mocked unit tests for Hyper-V wrapper + schema validation”.

---

# TODO List (now aligned to your repo contract)

Create `docs/manual-test/TODO.md`:

### P0 (MVP blockers)

* [ ] CLI `--help` lists commands + flags + examples
* [ ] Config example exists in repo (YAML) + matches Ajv schema
* [ ] `npm run build` produces runnable CLI via `npx ragnatramp`
* [ ] `up` creates 2 VMs on Default Switch
* [ ] `up` is idempotent (no duplicate VMs)
* [ ] `down/destroy` semantics are explicit and verified

### P1 (enterprise usability)

* [ ] `--log-level` or `--debug` exists and prints PowerShell/WMI failures clearly
* [ ] Non-admin runtime verified (user-space)
* [ ] Structured output mode (`--json`) for automation
* [ ] Safe resource naming and collision handling

---

## Next action (no fluff)

Paste the output of:

```powershell
npx ragnatramp --help
```

…and I’ll map the lifecycle section **exactly** to your real command names/flags (validate/plan/up/status/down/etc.), plus I’ll give you a tight “test matrix” for 2–3 VMs, missing VHDX, wrong switch, name collisions, and permission failures.

