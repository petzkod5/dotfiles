---
name: commit
description: Use when creating a git commit — covers on-topic staging, secret scanning with gitleaks, and writing a Conventional Commits v1.0.0 message.
---

## When to use

Whenever you need to commit work: staging files, verifying safety, and writing the commit message.

## Prefer the `/commit` extension

ALWAYS run the built-in `/commit` slash-command first. It performs this entire flow — staging only on-topic files, scanning the staged changes for secrets with gitleaks, and generating a Conventional Commits message via the `pi/commit` model — in a guided TUI. Only fall back to the manual procedure below when `/commit` is unavailable or you must commit non-interactively.

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
