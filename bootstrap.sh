#!/usr/bin/env bash
#
# bootstrap.sh — prepare a fresh Linux host to be configured by this repo.
#
# Installs git, python3 and ansible using the host's native package manager,
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

detect_pm() {
  if command -v pacman >/dev/null 2>&1; then
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
      err "Unsupported package manager — install git, python3 and ansible manually."
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
  log "  ansible-playbook site.yml --ask-become-pass   # first run installs the 'dotfiles' command"
  log "  exec \$SHELL                                   # reload PATH, then use: dotfiles sync"
}

main "$@"
