################################
# dotfiles aliases and utilities
################################

# dot-reload
alias dot-reload="echo 'Reloading zsh environment ...'; . ~/.zshenv; . ~/.zshrc"

# dot-env-edit
alias dot-env-edit="$EDITOR $DOT_ENV_CFG && dot-reload"
alias dot-env-reload="dot-env > $DOT_ENV_OUT; dot-reload"

# commodity aliases
alias dee=dot-env-edit
alias der=dot-env-reload
alias dr=dot-reload

# dot-update: pull latest dotfiles (rebase local commits, autostash edits), then reload
dot-update() {
    git -C ~ pull --rebase --autostash origin main || {
        echo "dot-update: pull failed. Resolve in ~ (git status), then run 'dr'." >&2
        return 1
    }
    dot-reload
}

# Startup check: warn if origin/main is ahead. Local-only compare; fetch runs
# detached and throttled (1h) so the next shell sees fresh data.
_dot_check_upstream() {
    [[ -o interactive ]] || return 0
    (( $+commands[git] )) || return 0
    git -C ~ rev-parse --verify -q origin/main &>/dev/null || return 0

    local behind ahead
    read -r ahead behind <<< "$(git -C ~ rev-list --left-right --count main...origin/main 2>/dev/null)"
    if (( ${behind:-0} > 0 )); then
        local msg="dotfiles: main is ${behind} commit(s) behind origin/main."
        (( ${ahead:-0} > 0 )) && msg+=" ${ahead} local unpushed (will be rebased)."
        [[ -n "$(git -C ~ status --porcelain --untracked-files=no 2>/dev/null)" ]] \
            && msg+=" Uncommitted changes will be autostashed."
        print -P "%F{yellow}${msg} Run 'dot-update'.%f"
    fi

    local -a fresh
    fresh=(~/.git/FETCH_HEAD(Nmh-1))
    if (( ! ${#fresh} )); then
        ( GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND='ssh -o BatchMode=yes' \
            git -C ~ fetch --quiet origin main &>/dev/null & )
    fi
}
_dot_check_upstream
unfunction _dot_check_upstream
