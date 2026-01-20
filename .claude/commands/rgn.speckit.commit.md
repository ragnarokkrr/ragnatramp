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

3. **Determine the scope** from staged file paths:
   - If ANY staged file path matches `specs/<id>/*` (e.g., `specs/001-hyperv-vm-orchestration/...`), use that `<id>` as scope
   - Otherwise, use `ragnatramp` as scope

4. **Determine the commit type** based on the nature of changes:
   | Type | Use when |
   |------|----------|
   | `docs` | Changes to spec files, markdown docs, README, comments only |
   | `feat` | New functionality, features, commands, user-facing behavior |
   | `fix` | Bug fixes, error corrections |
   | `refactor` | Code restructuring without behavior change |
   | `test` | Adding or modifying tests |
   | `chore` | Tooling, CI, dependencies, config files, build scripts |

5. **Format the commit message** following Conventional Commits:

   ```
   <type>(<scope>): <subject>

   - <bullet 1: what changed and why>
   - <bullet 2: impact or context>
   - <bullet 3+: additional details if needed>
   ```

   **Subject rules**:
   - Use imperative mood ("add", "fix", "update", not "added", "fixes", "updates")
   - Maximum 72 characters
   - No period at the end
   - Lowercase after the colon

   **Body rules**:
   - Include 2-5 bullets explaining WHY and IMPACT
   - Each bullet starts with `- `
   - Focus on intent, not just listing files

6. **Output the commit message** in a code block for review. Do NOT add explanatory text before or after the code block.

7. **Ask for confirmation** using the AskUserQuestion tool:
   - Question: "Proceed with this commit message?"
   - Options:
     - "Yes, commit" - Run the commit
     - "Edit message" - Let user provide a modified message
     - "Cancel" - Abort without committing

8. **If confirmed**, run the commit using a HEREDOC:
   ```bash
   git commit -m "$(cat <<'EOF'
   <commit message here>
   EOF
   )"
   ```

9. **If user wants to edit**, ask them to provide the corrected message, then commit with their version.

10. **If cancelled**, respond with "Commit cancelled." and stop.

## Examples

**Example 1: Spec change**
```
docs(001-hyperv-vm-orchestration): add VM naming convention to data model

- Define deterministic naming pattern {project}-{machine}-{hash8}
- Document state file schema for tracking managed VMs
- Clarify ownership verification strategy
```

**Example 2: Feature implementation**
```
feat(ragnatramp): implement YAML config loader and validator

- Add js-yaml parsing with safe load mode
- Integrate ajv for JSON Schema validation with detailed errors
- Support defaults merging and per-machine overrides
```

**Example 3: Tooling change**
```
chore(ragnatramp): configure TypeScript and project scaffolding

- Set up tsconfig.json with strict mode and ES2022 target
- Add npm scripts for build, dev, test, and lint
- Install commander, js-yaml, ajv dependencies
```
