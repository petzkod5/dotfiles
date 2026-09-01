# petzko-dotfiles

Ansible-managed configuration for Linux and macOS machines: one shared baseline
with per-distribution and per-host overrides — all driven by a small `dotfiles`
command.

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

### macOS prerequisites

Darwin hosts use [Homebrew](https://brew.sh) for formulae and casks. On a fresh
machine, `bootstrap.sh` installs Homebrew as the login user when needed, then
loads `/opt/homebrew/bin/brew shellenv` on Apple Silicon or
`/usr/local/bin/brew shellenv` on Intel before installing Git, Python, and
Ansible. The `macos` inventory family disables Linux-only Flatpak, locale, and
`/etc/hosts` management.

## Install remotely (one command)

On a fresh machine, bootstrap everything in one shot:

```bash
curl -fsSL https://raw.githubusercontent.com/petzkod5/dotfiles/main/install.sh | sh
```

It ensures `git`, clones the repo to `~/petzko-dotfiles`, runs `bootstrap.sh`
(git/python/ansible + Galaxy collections), then `dotfiles sync`. Package setup
uses sudo normally. The playbook asks for a sudo password only when neither an
active sudo ticket nor a saved credential exists; Bitwarden asks only when its
master-password environment variable and encrypted cache are both absent. Run
`exec $SHELL` afterward to put the `dotfiles` command on your PATH.

Override via env vars: `DOTFILES_DIR` (clone path), `DOTFILES_BRANCH`,
`DOTFILES_REPO_URL`. The machine must already exist in the inventory (its
hostname matching an entry); if not, the script prints the `dotfiles add-host`
step to run first.

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
`$(hostname)`), `DOTFILES_FAMILY` (`archlinux`, `debian`, `redhat`, or `macos`
for `add-host` detection), `DOTFILES_BECOME_PASSWORD` (the sudo password) and
`DOTFILES_BITWARDEN_MASTER_PASSWORD`. Password environment variables take
precedence for that invocation and are never persisted.

When no password environment variable is set, `dotfiles` uses
`$XDG_STATE_HOME/dotfiles/credentials/` (default
`~/.local/state/dotfiles/credentials/`) as a mode-`0700` local cache. Each value
is SOPS-encrypted to the age identity at `$SOPS_AGE_KEY_FILE` or
`~/.config/sops/age/keys.txt`, and is only placed in the `dotfiles`/Ansible
process environment. Credential caching requires `sops`, `age-keygen`, and a
readable identity. A prompted sudo password is cached after a successful
playbook run. A prompted Bitwarden master password is cached after the role
successfully retrieves the configured files — including the age identity on a
new host. Neither cache nor plaintext credential belongs in the repository or
the tracked `~/.config/dotfiles/config.toml`.

The encrypted cache protects disk-at-rest data, not a compromised login account:
an attacker able to read the local age identity can decrypt it. Delete the
corresponding file from the cache after rotating either password.

Prefer a file? `dotfiles config` scaffolds `~/.config/dotfiles/config.toml`
(TOML), where the non-secret settings live more comfortably — `commit.model`,
`commit.prompt`, `commit.url` and `commit.api_key` (the multi-line prompt
especially). Precedence: env var > config file > default. The `cli` role
symlinks it to a repo-tracked file, so your settings are committed too.

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

Use `dotfiles sync` or `dotfiles check` for encrypted credential reuse. Direct
Ansible invocations intentionally do not read the local cache; export
`DOTFILES_BECOME_PASSWORD` in the calling environment when sudo needs a
password:

```bash
ansible-playbook site.yml --limit "$(hostname)"
ansible-playbook site.yml --limit "$(hostname)" --check --diff
ansible-inventory --host "$(hostname)"          # show this host's merged vars
```

Lint and syntax-check the repo with `yamllint . && ansible-lint` and
`ansible-playbook site.yml --syntax-check`.

## Customising it for yourself

Variables resolve in four layers — highest wins for scalars, while package lists
accumulate across layers:

| Layer    | File                                  | Scope                              |
|----------|---------------------------------------|------------------------------------|
| defaults | `roles/common/defaults/main.yml`      | baseline for everything            |
| common   | `inventory/group_vars/all.yml`        | every host                         |
| family   | `inventory/group_vars/<family>.yml`   | one OS family (`archlinux`, `debian`, `redhat`, `macos`) |

The most common edits:

- **Git identity** — edit `roles/git/files/gitconfig` (it is symlinked to
  `~/.gitconfig`, so it *is* your live config; `dotfiles commit` tracks it).
- **A package on every host** — add to `common_packages_all` in `group_vars/all.yml`.
- **A package on one host** — add to `common_packages_host` in its host file.
- **A package only on one distro** — `group_vars/<family>.yml`.
- **Which extras a host runs** — the `additional_roles` list in its host file.

### Opt-in roles (`additional_roles`)

| Role             | Does                                                       |
|------------------|------------------------------------------------------------|
| `zsh`            | oh-my-zsh + a symlinked `~/.zshrc`                         |
| `cli`            | symlinks the `dotfiles` command onto PATH + its config     |
| `git`            | a symlinked `~/.gitconfig`                                 |
| `neovim`         | Neovim + AstroNvim; aliases `vim`/`vi` → nvim, `$EDITOR=nvim` |
| `herdr`         | Herdr agent multiplexer binary + standard default config   |
| `libreoffice`    | LibreOffice from distro packages on Linux; Homebrew cask on macOS |
| `bitwarden`      | pulls vault material; Homebrew formula on macOS |
| `k8s-tools`      | Kubernetes CLIs from pinned upstream releases on Linux; Homebrew formulae on macOS |
| `upstream-tools` | dev CLIs from Linux upstream archives; Homebrew formulae on macOS |
| `docker`         | Docker Engine + systemd on Linux; Docker Desktop cask on macOS |
| `tailscale`      | `tailscaled` on Linux; Tailscale.app cask on macOS |
| `petzko.omp.omp_full` | external `petzko.omp` collection role: OMP binary + copied config, RULES.md, AGENTS.md, `/commit` extension |

The file-symlinking roles (`zsh`, `cli`, `git`, `neovim`) mean editing the live
file edits the tracked repo file — customise once, then `dotfiles commit`. The
external `petzko.omp` collection copies OMP files into `~/.omp/agent` instead of
linking back to this repo.

On macOS, Docker Desktop and Tailscale.app are installed but not launched,
approved, or authenticated by Ansible. Launch both after sync, accept their
first-run prompts, and authenticate Tailscale to the intended tailnet.

## Secrets (Bitwarden)

The `bitwarden` role pulls SSH keys, secure notes and attachments from your
vault. Declare what to fetch in your host file (`bitwarden_ssh_keys`,
`bitwarden_notes`, `bitwarden_files`), then:

```bash
dotfiles secrets
```

`dotfiles secrets` first uses `DOTFILES_BITWARDEN_MASTER_PASSWORD`, then the
encrypted local cache, and prompts only if both are absent. A prompted value is
cached only after the role completes successfully; the `BW_SESSION` remains
in-memory and the vault is still locked at the end of the run. See
`roles/bitwarden/` for the full security model.

**Environment variables from Bitwarden.** Keep each secret env var as a Secure
Note in a vault folder named `environment-variables` (note **name** = variable
name, note **body** = value). `dotfiles secrets` writes them to
`~/.config/zsh/secrets.env` (mode `0600`, never committed) and your shell
exports them on startup. Change the folder with `bitwarden_env_folder`, or set
it to `""` to disable.

## Layout

```
bin/dotfiles              the dotfiles command (symlinked onto PATH by the cli role)
bin/dotfiles-credentials  SOPS/age-encrypted, per-user credential cache helper
bootstrap.sh              install prerequisites on a fresh host
site.yml                  the playbook — common baseline, then per-host additional_roles
inventory/                hosts.yml, group_vars/ (common + per-family), host_vars/
roles/                    common, zsh, cli, git, neovim, herdr, libreoffice, bitwarden, k8s-tools, upstream-tools, docker, tailscale
```
