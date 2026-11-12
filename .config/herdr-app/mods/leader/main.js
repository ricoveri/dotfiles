// Leader launcher. keys.json binds the leader key ("ctrl-space") to "mod.open:leader";
// mod.open takes no props, so this mod only hands its BINDINGS to the generic which-key
// mod (mods/which-key) and closes itself. An entry with `group` opens a sub-menu
// (<leader>s …); one with `command` runs it and closes. Add entries to BINDINGS to grow the menu.
import { View, div } from "gpui-kit";
import { props, closeOverlay, openOverlay } from "herdr";

const BINDINGS = {
  space: { label: "Command palette", command: "mod.open", args: { name: "palette" } },
  s: { label: "+space", group: {
    s: { label: "Switch space or agent", command: "mod.open", args: { name: "switch-palette" } },
  } },
  ";": { label: "Switch agent", command: "mod.open", args: { name: "agent-select" } },
  b: { label: "Split horizontally (new pane below)", command: "pane.split", args: { direction: "down" } },
  v: { label: "Split vertically (new pane right)", command: "pane.split", args: { direction: "right" } },
  h: { label: "Focus left split", command: "pane.go", args: { direction: "left" } },
  l: { label: "Focus right split", command: "pane.go", args: { direction: "right" } },
  j: { label: "Focus lower split", command: "pane.go", args: { direction: "down" } },
  k: { label: "Focus upper split", command: "pane.go", args: { direction: "up" } },
  x: { label: "Close split (focused pane)", command: "pane.close" },
  backslash: { label: "Toggle PR panel", command: "layout.toggle", args: { id: "pr-panel" } },
};

export default class Leader extends View {
  init(_props, _cx) {
    // Close the launcher first: closing it after which-key is up can hand keyboard focus
    // back to the pane underneath and leave which-key without the keys.
    const self = props()?.overlay;
    if (self) closeOverlay(self);
    openOverlay({
      mod: "which-key", props: { title: "Leader", bindings: BINDINGS },
      kind: "popup", at: "top", offset: 5000, width: 1, height: 150, frame: "none",
    });
  }

  render(_cx) {
    return div().size_full();
  }
}
