# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

The working directory **is `$HOME`**. This is a dotfiles repo using a **deny-by-default** `.gitignore`: everything is ignored unless explicitly un-ignored. Only a curated subset of config files is versioned.

## Adding new files to tracking

Before creating any new file intended to be versioned, un-ignore it in `.gitignore` first:

```gitignore
!path/to/new/file
!path/to/new/dir/
!path/to/new/dir/**
```

## Where to put changes

| Area | Preferred location |
|------|--------------------|
| New env var / PATH entry | New file in `.zsh/profile.d/` (single-purpose) |
| Zsh plugin / alias / function | `.zsh/custom/plugins/` or `.zsh/custom/` |
| Tmux setting | New file in `.tmux/conf.d/` rather than growing `.tmux.conf` |
| Karabiner binding | `.config/karabiner/` |

## Forbidden paths — never touch

`.ssh/`, `.gnupg/`, `.aws/`, `.pypirc`, `.sensitive/`, shell history files (`.histfile`, `.zsh_history`), caches (`.cache/`, `.npm/`), and large personal folders (`Desktop/`, `Documents/`, `Downloads/`, `Library/`, `Movies/`, `Music/`, `Pictures/`).

## Git notes

- **GPG signing is enabled** for all commits and tags (key `17BF540D60DA2F3E`, uses `/opt/homebrew/bin/gpg`). Commits will fail if the GPG agent is unavailable.
- `main` and `master` have `pushRemote = no_push` — direct pushes to those branches are blocked by git config.
- Do not commit or push unless explicitly asked.
