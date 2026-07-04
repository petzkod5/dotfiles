---
name: commit
description: Use when creating a git commit — covers on-topic staging, secret scanning with gitleaks, and writing a Conventional Commits v1.0.0 message.
---

## When to use

Whenever you need to commit work: staging files, verifying safety, and writing the commit message.

## Prefer the built-in commit flow

If you are an agent, ALWAYS call the `commit` tool first. It runs this entire flow — staging only on-topic files, scanning the staged changes for secrets with gitleaks, and generating a Conventional Commits message via the `pi/commit` model — autonomously in one pass, while showing the user the same live status overlay. Pass an optional `hint` describing the change to guide file selection.

The `/commit` slash-command is the human's interactive equivalent (it adds a review gate). Only fall back to the manual git procedure below if the `commit` tool is unavailable.

## Manual procedure (fallback)

1. **Stage only on-topic files.** Determine the logical unit of change; add only the files that belong to it. Never `git add -A` or include unrelated edits.

2. **Scan for secrets before committing.**
   ```
   gitleaks git --staged
   ```
   If anything is flagged, STOP. Do not commit until the secret is removed or confirmed a false positive by the user.

3. **Write a one-line Conventional Commits subject.**
   Format: `type(scope): description`
   - `type` (lowercase, pick one): `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
   - `scope`: affected component or path segment (omit if not useful)
   - `description`: imperative mood, no trailing period, <=72 chars total

4. **Commit.**
   ```
   git commit -m "type(scope): description"
   ```

## Conventions

- Atomic commits: one logical change per commit.
- Never commit secrets.
- Do NOT add AI/co-author trailers or `Generated with` lines unless the user explicitly asks.
- Match the tense and style of the repo's existing commit history.

## Good example

```
refactor(omp): extract skill wiring into dedicated task block
```
