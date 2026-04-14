# AGENTS.md

This repository is your **home directory** (`$HOME`). Treat it as a dotfiles repo with a **deny-by-default** versioning model.

## Scope (what this repo is)

- Keep changes **small, targeted, and reversible**.
- Avoid “cleanup” or broad refactors unless explicitly requested.

## Allowed paths to edit

Only make changes inside paths that are intentionally versioned (as implied by the top-level `.gitignore` allowlist):

- Repo meta: `.gitignore`, `.gitconfig`, `README.md`, and this file `AGENTS.md`
- Zsh:
  - `.zshrc`, `.zshenv`
  - `.zsh/profile.d/**` (preferred for new environment setup snippets)
  - `.zsh/custom/**` (plugins/customizations)
- Tmux:
  - `.tmux.conf`
  - `.tmux/conf.d/**` (preferred for modular tmux config)
- Karabiner-Elements:
  - `.config/karabiner/**`
- `.local` (restricted):
  - `.local/bin/dotenv.py`
  - `.local/bin/dotenv/**`

If you need to start managing a new file/tree, update `.gitignore` intentionally by un-ignoring only the minimum required paths.

## Forbidden paths (never touch)

Do **not** edit, create, or commit anything in these areas (they are sensitive, personal, or out of scope for this repo):

- Secrets/keys/credentials: `.ssh/`, `.gnupg/`, `.aws/`, `.pypirc`, `.sensitive/`
- Shell history / app state: `.histfile`, `.zsh_history`, `.psql_history`, `.lesshst`, `.viminfo`, caches under `.cache/`, `.npm/`, etc.
- Large personal folders: `Desktop/`, `Documents/`, `Downloads/`, `Library/`, `Movies/`, `Music/`, `Pictures/`, cloud mounts (e.g. `Google Drive/`), and similar

If a change request would require touching any forbidden area, stop and ask for a different approach.

## Change workflow expectations

- Prefer **minimal diffs**; don’t reorder lines or reformat files without a clear reason.
- When adding new dotfiles to be managed, also update `.gitignore` so the file is actually tracked.
- Do not introduce interactive-only steps as the only install path; when possible, document non-interactive equivalents.

## Git hygiene

- No force pushes, history rewrites, or destructive git commands unless explicitly requested.
- Do not commit or push unless the user explicitly asks.

## Where to put common changes

- Zsh environment additions: add a new file in `.zsh/profile.d/` (keep it single-purpose).
- Zsh custom behavior/plugins: add/adjust under `.zsh/custom/`.
- Tmux changes: prefer adding/editing a focused file under `.tmux/conf.d/` rather than growing `.tmux.conf`.
- Karabiner changes: keep them under `.config/karabiner/` and avoid unrelated `.config` churn.
