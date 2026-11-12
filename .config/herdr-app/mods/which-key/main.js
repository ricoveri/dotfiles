// Generic which-key strip. Opened with openOverlay({ mod: "which-key", props: { title, bindings } }).
// `bindings` is a tree: key name → { label, command, args? } to run and close, or { label, group: {...} }
// to open a sub-menu. Esc or any unmapped key cancels, Backspace goes up one level.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, theme } from "herdr";

const norm = (k) => (k === " " ? "space" : k === "\\" ? "backslash" : k === "-" ? "minus" : k);
const SHOW = { backslash: "\\", minus: "-" }; // how a key is drawn in the popup

export default class WhichKey extends View {
  init(_props, cx) {
    this.path = []; // keys of the groups we're inside
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  level() {
    let m = props()?.bindings ?? {};
    for (const k of this.path) m = m[k].group;
    return m;
  }

  render(cx) {
    const t = theme(), level = this.level(), title = props()?.title ?? "Keys";
    // Spacemacs-style which-key: a full-width strip along the bottom edge, entries flowing in columns.
    return v_flex().id("which-key").track_focus(this.handle).size_full().min_h(0).px(18).py(12).gap(8).bg(t.popover).border_t(1).border_color(t.border).text_size(13)
      .on_key_down((e, cx) => {
        const k = norm(e.key);
        if (["control", "shift", "alt", "meta", "cmd"].includes(k)) return; // bare modifiers: keep waiting
        cx.stop_propagation();
        if (k === "backspace" && this.path.length) { this.path.pop(); cx.notify(); return; }
        const b = e.modifiers?.control ? null : level[k];
        if (b?.group) { this.path.push(k); cx.notify(); return; }
        closeOverlay(props()?.overlay);
        if (b) run(b.command, b.args ?? {});
      })
      .child(h_flex().items_center().gap(8)
        .child(div().font_semibold().text_color(t.foreground).child([title, ...this.path.map((k) => SHOW[k] ?? k)].join(" ")))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child(this.path.length ? "Backspace up · Esc cancel" : "Esc to cancel")))
      .child(h_flex().flex_wrap().gap_x(24).gap_y(6).children(Object.entries(level).map(([k, b]) => h_flex().w(300).gap(10).items_center()
        .child(div().min_w(52).px(6).py(1).rounded(4).border_1().border_color(t.border).text_size(11).text_color(t.accent).text_center().child(SHOW[k] ?? k))
        .child(div().text_color(b.group ? t.accent : t.muted).truncate().child(b.label)))));
  }
}
