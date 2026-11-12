// Vim/spacemacs-style leader. keys.json binds the leader key ("ctrl-space") to
// "mod.open:leader"; this strip then waits for keys. An entry with `group` opens a
// sub-menu (<leader>s …); one with `command` runs it and closes. Esc or any unmapped
// key cancels, Backspace goes up one level. Add entries to BINDINGS to grow the menu.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, theme } from "herdr";

// key name (as the key event reports it) → label shown + command to run, or a group
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
const norm = (k) => (k === " " ? "space" : k === "\\" ? "backslash" : k === "-" ? "minus" : k);
const SHOW = { backslash: "\\", minus: "-" }; // how a key is drawn in the popup

export default class Leader extends View {
  init(_props, cx) {
    this.path = []; // keys of the groups we're inside
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  level() {
    let m = BINDINGS;
    for (const k of this.path) m = m[k].group;
    return m;
  }

  render(cx) {
    const t = theme(), level = this.level();
    // Spacemacs-style which-key: a full-width strip along the bottom edge, entries flowing in columns.
    return v_flex().id("leader").track_focus(this.handle).size_full().min_h(0).px(18).py(12).gap(8).bg(t.popover).border_t(1).border_color(t.border).text_size(13)
      .on_key_down((e, cx) => {
        const k = norm(e.key);
        if (["control", "shift", "alt", "meta", "cmd"].includes(k)) return; // bare modifiers: keep waiting
        cx.stop_propagation();
        if (k === "backspace" && this.path.length) { this.path.pop(); cx.notify(); return; }
        const b = e.modifiers?.control ? null : level[k];
        if (b?.group) { this.path.push(k); cx.notify(); return; }
        closeOverlay(props().overlay);
        if (b) run(b.command, b.args ?? {});
      })
      .child(h_flex().items_center().gap(8)
        .child(div().font_semibold().text_color(t.foreground).child(["Leader", ...this.path.map((k) => SHOW[k] ?? k)].join(" ")))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child(this.path.length ? "Backspace up · Esc cancel" : "Esc to cancel")))
      .child(h_flex().flex_wrap().gap_x(24).gap_y(6).children(Object.entries(level).map(([k, b]) => h_flex().w(300).gap(10).items_center()
        .child(div().min_w(52).px(6).py(1).rounded(4).border_1().border_color(t.border).text_size(11).text_color(t.accent).text_center().child(SHOW[k] ?? k))
        .child(div().text_color(b.group ? t.accent : t.muted).truncate().child(b.label)))));
  }
}
