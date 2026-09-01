#!/usr/bin/env bash
#
# bootstrap.sh — prepare a fresh Linux or macOS host to be configured by this repo.
#
# Installs git, Python, and Ansible using the host's native package manager,
# then pulls the Ansible collections declared in requirements.yml.
#
# Usage: ./bootstrap.sh
set -euo pipefail

log() { printf '\033[1;34m[bootstrap]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[bootstrap] ERROR:\033[0m %s\n' "$*" >&2; }

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

bootstrap_homebrew() {
  if ! command -v brew >/dev/null 2>&1; then
    if [ "$(id -u)" -eq 0 ]; then
      err "Homebrew must be installed by the non-root login user."
      exit 1
    fi
    log "Installing Homebrew"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi

  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  else
    err "Homebrew installation did not provide brew."
    exit 1
  fi
}

detect_pm() {
  if [ "$(uname -s)" = "Darwin" ]; then
    echo homebrew
  elif command -v pacman >/dev/null 2>&1; then
    echo pacman
  elif command -v apt-get >/dev/null 2>&1; then
    echo apt
  elif command -v dnf >/dev/null 2>&1; then
    echo dnf
  else
    echo unknown
  fi
}

install_prereqs() {
  case "$1" in
    homebrew)
      bootstrap_homebrew
      brew install git python ansible
      ;;
    pacman)
      $SUDO pacman -Sy --needed --noconfirm git python ansible
      ;;
    apt)
      $SUDO apt-get update
      $SUDO apt-get install -y git python3 python3-pip ansible
      ;;
    dnf)
      $SUDO dnf install -y git python3 python3-pip ansible
      ;;
    *)
      err "Unsupported package manager — install git, Python, and Ansible manually."
      exit 1
      ;;
  esac
}

main() {
  local pm
  pm="$(detect_pm)"
  log "Detected package manager: ${pm}"
  install_prereqs "$pm"

  if [ -f requirements.yml ]; then
    log "Installing Ansible collections from requirements.yml"
    ansible-galaxy collection install -r requirements.yml
  fi

  log "Done. Next:"
  log "  ./bin/dotfiles sync                    # prompts only when a credential is unavailable"
  log "  exec \$SHELL                            # reload PATH, then use: dotfiles sync"
}

main "$@"
