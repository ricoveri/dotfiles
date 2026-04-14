## dotfiles

Opinionated macOS/Linux dotfiles for a fast terminal workflow: **zsh**, **tmux**, and a handful of small quality-of-life defaults.

This repo is managed with a **deny-by-default** approach: only a small allowlisted subset of files are intended to be tracked (see `.gitignore`). Treat it as a curated config set, not a dumping ground.

## What’s included

- **Zsh**: `.zshrc`, `.zshenv`, plus modular snippets in `.zsh/profile.d/` and custom plugins in `.zsh/custom/`
- **Tmux**: `.tmux.conf` with modular config in `.tmux/conf.d/`
- **Karabiner-Elements**: config under `.config/karabiner/` (when present)
- **Utilities**: a small `.local/bin/dotenv` helper (when present)

## Install this repo

This repo is structured like a `$HOME` overlay. Avoid copying blindly unless you know exactly what you’re doing.

```bash
cd /tmp
git clone git@github.com:axltxl/dotfiles.git
cd dotfiles

# Safer: copy only the tracked files into $HOME.
# (The repo is deny-by-default; `git ls-files` is the intended surface area.)
git ls-files -z | xargs -0 -I{} rsync -a --mkpath "{}" "$HOME/{}"
```

## Install dependencies

### Essentials

Get these sorted out first ...

- [zsh](https://www.zsh.org/)
- [oh-my-zsh](https://ohmyz.sh/#install)
- [tmux](https://github.com/tmux/tmux)
- [tmux plugin manager](https://github.com/tmux-plugins/tpm)
- [fzf](https://github.com/junegunn/fzf)

## Copyright and Licensing

Copyright (c) 2025 Alejandro Ricoveri

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
