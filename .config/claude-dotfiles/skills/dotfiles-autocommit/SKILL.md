---
name: dotfiles-autocommit
description: Commit and push to main after every change to tracked files in the dotfiles repo whose root is $HOME. Use whenever you finish editing, creating, renaming or deleting a versioned config file (.zsh, .tmux, .config/*, .gitignore, etc.) in that repo, without waiting to be asked. Does not apply in any other repository.
---

# Dotfiles auto commit and push

The user gave standing permission to commit and push every change made in the dotfiles repo at `$HOME`, directly to `main`. This overrides the "do not commit or push unless asked" note in CLAUDE.md, for this repo only.

## Scope check first

Run `git rev-parse --show-toplevel`. Continue only if it prints `$HOME` (`/home/ricoveri`). In any other repo, stop: ask before committing.

## After each change

1. `git status --short`, then stage only files you changed this turn, by explicit path. The user often has unrelated unstaged edits (e.g. `.config/hypr/bindings.lua`); committing them would ship work they did not ask about.
2. If a new file is ignored (deny-by-default `.gitignore`), un-ignore it first as CLAUDE.md describes, and stage `.gitignore` too.
3. Never stage forbidden paths from CLAUDE.md (`.ssh/`, `.gnupg/`, `.aws/`, `.sensitive/`, history files, caches).
4. Commit with a signed conventional message (`feat(scope): ...`, `fix(scope): ...`, `chore(scope): ...`), one logical change per commit, ending with the attribution lines from the session's system reminder.
5. `git push` to `main`. If the push is rejected, `git pull --rebase` and retry once; if that conflicts, stop and tell the user.
6. If GPG signing fails (agent unavailable), report it. Do not retry with `--no-gpg-sign`.

Report the short hash and what was pushed in one line.

## Why

Dotfiles are only useful if the remote matches the machine. Small atomic pushes keep each tweak revertable and avoid drift between machines.
