# petzko-dotfiles

Ansible-managed configuration for my Linux machines: one shared baseline for any
Linux host, with per-distribution and per-host overrides — all driven by a small
`dotfiles` command.

## Quick start (new machine)

```bash
git clone <this-repo> ~/petzko-dotfiles && cd ~/petzko-dotfiles

./bootstrap.sh             # install git, python, ansible + Galaxy collections
./bin/dotfiles add-host    # register THIS machine in the inventory + host_vars
$EDITOR inventory/host_vars/$(hostname).yml   # customise it (optional, see below)
./bin/dotfiles sync        # apply the configuration to this machine

exec $SHELL                # reload PATH — `dotfiles` is now available everywhere
```

The first `sync` symlinks the command to `~/.local/bin/dotfiles`, so from then on
you just run `dotfiles sync` from any directory.

## The `dotfiles` command

`dotfiles <command>` wraps the common Ansible invocations and always targets the
current machine. Any extra arguments pass straight through to `ansible-playbook`.

| Command             | What it does                                              |
|---------------------|----------------------------------------------------------|
| `dotfiles sync`     | Apply the full configuration to this host (main command) |
| `dotfiles check`    | Preview changes without applying (`--check --diff`)      |
| `dotfiles add-host` | Register this machine in the inventory + a host_vars file|
| `dotfiles commit`   | Secret-scan, then commit all changes with a dated message|
| `dotfiles review`   | Dry-run, then summarise pending changes with an LLM (needs key) |
| `dotfiles doctor`   | Health-check deps/symlinks/config; LLM suggests fixes (key opt.)|
| `dotfiles secrets`  | Pull secrets from Bitwarden (the `bitwarden` role only)  |
| `dotfiles update`   | Install / refresh Galaxy collections                     |
| `dotfiles edit`     | Open the repo in `$EDITOR`                               |
| `dotfiles config`  | Edit ~/.config/dotfiles/config.toml (settings)           |
| `dotfiles status`   | Show repo path, host and git working-tree status         |
| `dotfiles help`     | Full help                                                |

```bash
dotfiles sync --skip-tags bitwarden   # config only, skip secret-pulling
dotfiles sync --tags packages         # only the package tasks
dotfiles check                        # dry-run everything
```

Optional environment overrides: `DOTFILES_HOST` (target host, default
`$(hostname)`), `DOTFILES_FAMILY` (override OS detection for `add-host`),
`DOTFILES_BECOME=none` (skip the sudo prompt on NOPASSWD / headless sudo).

Prefer a file? `dotfiles config` scaffolds `~/.config/dotfiles/config.toml`
(TOML), where the same settings live more comfortably — `commit.model`,
`commit.prompt`, `commit.url`, `commit.api_key` and `sync.become` (the
multi-line prompt especially). Precedence: env var > config file > default. The
`cli` role symlinks it to a repo-tracked file, so your settings are committed too.

`dotfiles commit` stages everything, runs a secret scanner first when one is
installed (`gitleaks`, else `git-secrets`) and aborts if it flags anything, then
commits with a generic `Update <date>` message. Set `OPENROUTER_API_KEY` (e.g.
from a Bitwarden env note) to instead generate a Conventional-Commits message
with an LLM — tune `OPENROUTER_MODEL` (default `openai/gpt-4o-mini`) and the
instructions in `DOTFILES_COMMIT_PROMPT`; if the call fails it falls back to the
dated message.

`dotfiles review` runs the same `--check --diff` dry-run as `dotfiles check`, then
asks the LLM to summarise in plain English what a `sync` would change — grouped by
role/task, with destructive operations flagged. It requires `OPENROUTER_API_KEY`
(without one it would be identical to `dotfiles check`).

`dotfiles doctor` health-checks this setup: core dependencies, the CLI symlink and
PATH, config validity, managed/broken symlinks, host registration and playbook
syntax — printing an `[OK]`/`[WARN]`/`[FAIL]` report (non-zero exit on any
`[FAIL]`). With `OPENROUTER_API_KEY` set it also asks the LLM for concrete fixes;
without a key it still runs every check and just skips that step.

## Running the playbook directly

The CLI is just a convenience wrapper around Ansible; these are the equivalents:

```bash
ansible-playbook site.yml --limit "$(hostname)" --ask-become-pass     # = sync
ansible-playbook site.yml --limit "$(hostname)" --check --diff -K     # = check
ansible-inventory --host "$(hostname)"          # show this host's merged vars
```

`make deps | syntax | lint | check | run` are thin wrappers too (see `Makefile`).

## Customising it for yourself

Variables resolve in four layers — highest wins for scalars, while package lists
accumulate across layers:

| Layer    | File                                  | Scope                              |
|----------|---------------------------------------|------------------------------------|
| defaults | `roles/common/defaults/main.yml`      | baseline for everything            |
| common   | `inventory/group_vars/all.yml`        | every host                         |
| family   | `inventory/group_vars/<family>.yml`   | one OS family (arch/debian/redhat) |
| host     | `inventory/host_vars/<hostname>.yml`  | a single machine                   |

The most common edits:

- **Git identity** — edit `roles/git/files/gitconfig` (it is symlinked to
  `~/.gitconfig`, so it *is* your live config; `dotfiles commit` tracks it).
- **A package on every host** — add to `common_packages_all` in `group_vars/all.yml`.
- **A package on one host** — add to `common_packages_host` in its host file.
- **A package only on one distro** — `group_vars/<family>.yml`.
- **Which extras a host runs** — the `additional_roles` list in its host file.

### Opt-in roles (`additional_roles`)

| Role        | Does                                                       |
|-------------|------------------------------------------------------------|
| `zsh`       | oh-my-zsh + a symlinked `~/.zshrc`                         |
| `cli`       | symlinks the `dotfiles` command onto PATH + its config     |
| `git`       | a symlinked `~/.gitconfig`                                 |
| `neovim`    | Neovim + AstroNvim; aliases `vim`/`vi` → nvim, `$EDITOR=nvim` |
| `bitwarden` | pulls SSH keys / notes / files from your Bitwarden vault   |

The file-symlinking roles (`zsh`, `cli`, `git`, `neovim`) mean editing the live
file edits the tracked repo file — customise once, then `dotfiles commit`.

## Secrets (Bitwarden)

The `bitwarden` role pulls SSH keys, secure notes and attachments from your
vault. Declare what to fetch in your host file (`bitwarden_ssh_keys`,
`bitwarden_notes`, `bitwarden_files`), then:

```bash
dotfiles secrets        # prompts for your Bitwarden master password
```

Credentials are prompted at runtime and never written to disk. See
`roles/bitwarden/` for the full security model.

**Environment variables from Bitwarden.** Keep each secret env var as a Secure
Note in a vault folder named `environment-variables` (note **name** = variable
name, note **body** = value). `dotfiles secrets` writes them to
`~/.config/zsh/secrets.env` (mode `0600`, never committed) and your shell
exports them on startup. Change the folder with `bitwarden_env_folder`, or set
it to `""` to disable.

## Layout

```
bin/dotfiles    the dotfiles command (symlinked onto PATH by the cli role)
bootstrap.sh    install prerequisites on a fresh host
site.yml        the playbook — common baseline, then per-host additional_roles
inventory/      hosts.yml, group_vars/ (common + per-family), host_vars/
roles/          common, zsh, cli, git, neovim, bitwarden
```
