# fnm (Fast Node Manager) shell integration — managed by Ansible
# (roles/zsh/files/fnm.zsh), symlinked into ~/.config/zsh/rc.d/ and sourced by
# ~/.zshrc. Puts the active Node on PATH and switches versions automatically on
# `cd` into a directory with a .node-version / .nvmrc. No-op until fnm exists.
command -v fnm >/dev/null 2>&1 && eval "$(fnm env --use-on-cd)"
