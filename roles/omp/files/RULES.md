# Commit policy

ALWAYS commit through the built-in commit flow — never manual git — whenever it is available:

- Agents: call the `commit` tool. Interactive sessions: run the `/commit` command.
- It stages the on-topic files, scans the staged changes for secrets with gitleaks, and writes a one-line Conventional Commits message.
- Do NOT run `git add` / `git commit` yourself while the `commit` tool is present and working. Fall back to manual `git` ONLY if the tool is missing or failing, and say so.
