-- Keep only your personal keybinding overrides here. Add new bindings or
-- unbind defaults before replacing them.

-- See current bindings and descriptions:
--   omarchy menu keybindings --print

-- To disable every Omarchy default binding, set this in
-- ~/.config/hypr/hyprland.lua before require("default.hypr.omarchy"), then add
-- only the bindings you want below:
--   omarchy_default_bindings = false

-- To disable all preinstalled app/webapp bindings, set:
--   omarchy_preinstalled_bindings = false

-- Add a new binding.
-- o.bind("SUPER + SHIFT + R", "SSH", "alacritty -e ssh your-server")

-- Change an existing binding by unbinding it first, then binding the key again.
-- This example changes SUPER+SPACE from the launcher to the Omarchy root menu.
-- hl.unbind("SUPER + SPACE")
-- o.bind("SUPER + SPACE", "Omarchy menu", "omarchy-menu toggle root")

-- Disable a default binding without replacing it.
-- hl.unbind("SUPER + SHIFT + B")

-- Logitech MX Keys examples:
-- o.bind("SUPER + SHIFT + S", nil, "omarchy-capture-screenshot")
-- o.bind("SUPER + H", nil, "voxtype record toggle")
-- o.bind("SUPER + PERIOD", nil, "omarchy-shell shell toggle omarchy.emojis")

-- Vim-style: SUPER + h/j/k/l swaps the window left/down/up/right.
-- Replaces SUPER+J (was: toggle window split), SUPER+K (was: keybindings menu)
-- and SUPER+L (was: toggle workspace layout); those stay reachable from the Omarchy menu.
hl.unbind("SUPER + J")
hl.unbind("SUPER + K")
hl.unbind("SUPER + L")
o.bind("SUPER + H", "Swap window to the left", hl.dsp.window.swap({ direction = "l" }))
o.bind("SUPER + J", "Swap window down", hl.dsp.window.swap({ direction = "d" }))
o.bind("SUPER + K", "Swap window up", hl.dsp.window.swap({ direction = "u" }))
o.bind("SUPER + L", "Swap window to the right", hl.dsp.window.swap({ direction = "r" }))

-- Vim-style: SUPER + ALT + h/j/k/l moves focus left/down/up/right.
-- Replaces SUPER+ALT+K (was: tmux keybindings menu); that stays reachable from the Omarchy menu.
hl.unbind("SUPER + ALT + K")
o.bind("SUPER + ALT + H", "Focus left", hl.dsp.focus({ direction = "l" }))
o.bind("SUPER + ALT + J", "Focus down", hl.dsp.focus({ direction = "d" }))
o.bind("SUPER + ALT + K", "Focus up", hl.dsp.focus({ direction = "u" }))
o.bind("SUPER + ALT + L", "Focus right", hl.dsp.focus({ direction = "r" }))

-- SUPER + U maximizes the window (keeps gaps and bar, unlike SUPER+F fullscreen).
o.bind("SUPER + U", "Maximize window", hl.dsp.window.fullscreen({ mode = "maximized" }))

-- Mnemonics: SUPER + W, release, then a letter. W is for "web" and "window".
-- Replaces SUPER+W (was: close window), which moves to SUPER+W, D.
hl.unbind("SUPER + W")
o.bind("SUPER + W", "Web/window mnemonics", hl.dsp.submap("web"))
hl.define_submap("web", "reset", function()
  o.bind("B", "Browser (Chrome): focus or open", { focus = "google-chrome", launch = "google-chrome-stable" })
  o.bind("T", "Terminal (foot): focus or open", "omarchy-launch-or-focus foot omarchy-launch-terminal")
  o.bind("D", "Close window", hl.dsp.window.close())
  hl.bind("escape", hl.dsp.submap("reset"))
end)
