# herdr must not run inside tmux: detach first, then run it in the outer terminal
if command -v herdr >/dev/null 2>&1; then
    herdr() {
        if [[ -n $TMUX ]]; then
            tmux detach-client -E "herdr ${(j: :)${(q)@}}"
        else
            command herdr "$@"
        fi
    }

    # Install missing plugins from plugins.list, and refresh installed ones
    # once the update stamp is older than 24h, in the background
    # (pure-zsh checks, no subprocess unless a sync is actually needed)
    if [[ -o interactive && -f ~/.config/herdr/plugins.list ]]; then
        local _entry _repo _need_sync=0
        for _entry in ${(f)"$(<~/.config/herdr/plugins.list)"}; do
            [[ -z $_entry || $_entry == \#* ]] && continue
            _repo=${${_entry#*/}%%/*}
            if [[ -z $(echo ~/.config/herdr/plugins/github/${_repo}-*(N/)) ]]; then
                _need_sync=1
                break
            fi
        done

        # Stamp is touched by herdr-plugins-sync after a successful update;
        # no match = missing or older than 24h (keep in sync with
        # HERDR_PLUGINS_UPDATE_HOURS in the script)
        if (( ! _need_sync )); then
            local -a _fresh=(~/.config/herdr/.plugins-update.stamp(N.mh-24))
            (( ${#_fresh} )) || _need_sync=1
        fi

        (( _need_sync )) && herdr-plugins-sync >>~/.config/herdr/plugins-sync.log 2>&1 &!
    fi
fi
