# herdr must not run inside tmux: detach first, then run it in the outer terminal
if command -v herdr >/dev/null 2>&1; then
    herdr() {
        if [[ -n $TMUX ]]; then
            tmux detach-client -E "herdr ${(j: :)${(q)@}}"
        else
            command herdr "$@"
        fi
    }

    # Install missing plugins from plugins.list in the background
    # (pure-zsh check, no subprocess when all are present)
    if [[ -o interactive && -f ~/.config/herdr/plugins.list ]]; then
        local _entry _repo
        for _entry in ${(f)"$(<~/.config/herdr/plugins.list)"}; do
            [[ -z $_entry || $_entry == \#* ]] && continue
            _repo=${${_entry#*/}%%/*}
            if [[ -z $(echo ~/.config/herdr/plugins/github/${_repo}-*(N/)) ]]; then
                herdr-plugins-sync >>~/.config/herdr/plugins-sync.log 2>&1 &!
                break
            fi
        done
    fi
fi
