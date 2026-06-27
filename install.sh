#!/bin/sh
#
# install.sh — one-command remote bootstrap for petzko-dotfiles.
#
#   curl -fsSL https://raw.githubusercontent.com/petzkod5/dotfiles/main/install.sh | sh
#
# Ensures git, clones the repo, runs bootstrap.sh (git/python/ansible + Galaxy
# collections), then applies the playbook to this host with `dotfiles sync`.
# Override DOTFILES_REPO_URL / DOTFILES_DIR / DOTFILES_BRANCH to change targets.
set -eu

DOTFILES_REPO_URL="${DOTFILES_REPO_URL:-https://github.com/petzkod5/dotfiles.git}"
DOTFILES_DIR="${DOTFILES_DIR:-$HOME/petzko-dotfiles}"
DOTFILES_BRANCH="${DOTFILES_BRANCH:-main}"

if [ -t 1 ]; then
  g=$(printf '\033[1;32m'); r=$(printf '\033[1;31m'); b=$(printf '\033[1m'); n=$(printf '\033[0m')
else
  g=; r=; b=; n=
fi
log() { printf '%s[install]%s %s\n' "$g" "$n" "$*"; }
die() { printf '%s[install] ERROR:%s %s\n' "$r" "$n" "$*" >&2; exit 1; }

# Reconnect stdin to the terminal so sudo / ansible password prompts work when
# this script is piped from curl (its stdin is otherwise the pipe itself).
if [ ! -t 0 ] && (exec < /dev/tty) 2>/dev/null; then exec < /dev/tty; fi

# Privilege escalation for package installs.
if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
elif command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  die "run as root or install sudo first."
fi

# Ensure git (needed for the clone). bootstrap.sh installs python/ansible after.
if ! command -v git >/dev/null 2>&1; then
  log "Installing git"
  if command -v pacman >/dev/null 2>&1; then
    $SUDO pacman -Sy --needed --noconfirm git
  elif command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update
    $SUDO apt-get install -y git
  elif command -v dnf >/dev/null 2>&1; then
    $SUDO dnf install -y git
  else
    die "no supported package manager (pacman/apt/dnf); install git manually."
  fi
fi

# Clone, or fast-forward an existing checkout.
if [ ! -e "$DOTFILES_DIR" ]; then
  log "Cloning $DOTFILES_REPO_URL -> $DOTFILES_DIR ($DOTFILES_BRANCH)"
  git clone --branch "$DOTFILES_BRANCH" "$DOTFILES_REPO_URL" "$DOTFILES_DIR"
elif [ -d "$DOTFILES_DIR/.git" ]; then
  log "Updating existing checkout at $DOTFILES_DIR"
  git -C "$DOTFILES_DIR" pull --ff-only
else
  die "$DOTFILES_DIR exists but is not a git checkout; move it aside or set DOTFILES_DIR."
fi

cd "$DOTFILES_DIR"

log "Running bootstrap.sh (git/python/ansible + Galaxy collections)"
./bootstrap.sh

# Apply the playbook only when this host is in the inventory; otherwise a
# `--limit $(hostname)` run would silently match nothing.
host=$(hostname)
if ansible-inventory -i inventory/hosts.yml --host "$host" >/dev/null 2>&1; then
  log "Applying the playbook to $host (you will be prompted for the sudo password)"
  ./bin/dotfiles sync
  log "Done. Run 'exec \$SHELL' to put the dotfiles command on your PATH."
else
  log "Host '$host' is not in the inventory yet — skipping sync. To finish:"
  printf '  %s%s/bin/dotfiles add-host%s\n' "$b" "$DOTFILES_DIR" "$n"
  printf '  %s%s/bin/dotfiles sync%s\n' "$b" "$DOTFILES_DIR" "$n"
fi
