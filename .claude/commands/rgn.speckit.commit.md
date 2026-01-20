# Generate Commit Message

Generate a high-quality git commit message based on staged changes.

## Instructions

1. **Check for staged changes** by running these commands:
   ```bash
   git status --porcelain
   git diff --cached --name-only
   git diff --cached
   ```

2. **If no staged changes exist**, respond with exactly:
   ```
   No staged changes.
   ```
   Then stop.

3. **Determine the scope** using this priority order:
   - **First**: If ANY staged file path matches `specs/<id>/*` (e.g., `specs/001-hyperv-vm-orchestration/...`), use that `<id>` as scope
   - **Second**: If the current branch name matches the pattern `<id>-*` where `<id>` is a numeric prefix (e.g., `001-hyperv-vm-orchestration`), extract and use that `<id>` as scope
   - **Fallback**: Use `ragnatramp` as scope

   To check the branch name, run: `git branch --show-current`

4. **Find completed tasks** for the current feature:
   - If scope is a feature ID (e.g., `001-hyperv-vm-orchestration`), look for `specs/<scope>/tasks.md`
   - Extract all completed tasks (lines matching `- [x] ...`)
   - These will be included in the commit message body

5. **Determine the commit type** based on the nature of changes:
   | Type | Use when |
   |------|----------|
   | `docs` | Changes to spec files, markdown docs, README, comments only |
   | `feat` | New functionality, features, commands, user-facing behavior |
   | `fix` | Bug fixes, error corrections |
   | `refactor` | Code restructuring without behavior change |
   | `test` | Adding or modifying tests |
   | `chore` | Tooling, CI, dependencies, config files, build scripts |

6. **Format the commit message** following Conventional Commits:

   ```
   <type>(<scope>): <subject>

   - <bullet 1: what changed and why>
   - <bullet 2: impact or context>
   - <bullet 3+: additional details if needed>

   Completed tasks:
   - T001 [P] Task description here
   - T002 Another completed task
   ```

   **Subject rules**:
   - Use imperative mood ("add", "fix", "update", not "added", "fixes", "updates")
   - Maximum 72 characters
   - No period at the end
   - Lowercase after the colon

   **Body rules**:
   - Include 4-7 bullets explaining WHY and IMPACT
   - Each bullet starts with `- `
   - Focus on intent, not just listing files

   **Completed tasks section** (if applicable):
   - Only include if feature tasks.md exists and has completed tasks
   - Add a blank line, then `Completed tasks:` header
   - List each completed task from tasks.md (preserve task ID and description)
   - Only include tasks that were NOT already marked complete in previous commits

7. **Output the commit message** in a code block for review. Do NOT add explanatory text before or after the code block.

8. **Ask for confirmation** using the AskUserQuestion tool:
   - Question: "Proceed with this commit message?"
   - Options:
     - "Yes, commit" - Run the commit
     - "Edit message" - Let user provide a modified message
     - "Cancel" - Abort without committing

9. **If confirmed**, run the commit using a HEREDOC:
   ```bash
   git commit -m "$(cat <<'EOF'
   <commit message here>
   EOF
   )"
   ```

10. **If user wants to edit**, ask them to provide the corrected message, then commit with their version.

11. **If cancelled**, respond with "Commit cancelled." and stop.

## Examples

**Example 1: Spec change**
```
docs(001-hyperv-vm-orchestration): add VM naming convention to data model

- Define deterministic naming pattern {project}-{machine}-{hash8}
- Document state file schema for tracking managed VMs
- Clarify ownership verification strategy
- Add examples for multi-machine configurations
```

**Example 2: Feature implementation with completed tasks**
```
feat(001-hyperv-vm-orchestration): implement YAML config loader and validator

- Add js-yaml parsing with safe load mode
- Integrate ajv for JSON Schema validation with detailed errors
- Support defaults merging and per-machine overrides
- Enable detailed error messages for schema violations

Completed tasks:
- T003 [P] Create YAML schema definition in src/schema/config.schema.json
- T004 [P] Implement config loader in src/config/loader.ts
- T005 Implement schema validator in src/config/validator.ts
```

**Example 3: Tooling change**
```
chore(ragnatramp): configure TypeScript and project scaffolding

- Set up tsconfig.json with strict mode and ES2022 target
- Add npm scripts for build, dev, test, and lint
- Install commander, js-yaml, ajv dependencies
- Configure ESLint with flat config for ES modules
```
