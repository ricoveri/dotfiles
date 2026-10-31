# herdr must not run inside tmux: detach first, then run it in the outer terminal
if command -v herdr >/dev/null 2>&1; then
    herdr() {
        if [[ -n $TMUX ]]; then
            tmux detach-client -E "herdr ${(j: :)${(q)@}}"
        else
            command herdr "$@"
        fi
    }
fi
