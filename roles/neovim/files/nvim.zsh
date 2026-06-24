# Neovim shell integration — managed by Ansible (roles/neovim/files/nvim.zsh),
# symlinked into ~/.config/zsh/rc.d/ and sourced by ~/.zshrc. Edit + commit to
# track it. Makes Neovim the default editor and maps the classic vim/vi commands.
export EDITOR=nvim
export VISUAL=nvim
alias vim=nvim
alias vi=nvim
