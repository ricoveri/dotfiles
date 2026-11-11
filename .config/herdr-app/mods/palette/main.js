// Command palette. Lists every app command (`commands()`), filtered as you type.
// ↑/↓ or ctrl+n / ctrl+p move, Enter runs, Esc closes. Opened by <leader><space> (mods/leader).
// A command that needs arguments is run bare: Herdr asks for them, as it does for a key.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { commands, keys, run, theme, props, closeOverlay } from "herdr";

const ROW = 34, VISIBLE = 10;
const HIDE = new Set(["app.palette", "overlay.close"]);
const SYM = { cmd: "⌘", ctrl: "⌃", alt: "⌥", shift: "⇧" };
const pretty = (k) => k.split("-").map((p) => SYM[p] ?? (p.length === 1 ? p.toUpperCase() : p)).join("");

// Lower is better; null = no match. Every space-separated word must match.
function score(c, q) {
  if (!q) return 0;
  const name = c.name.toLowerCase(), hay = `${name} ${c.about.toLowerCase()}`;
  let total = 0;
  for (const w of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    if (name.startsWith(w)) total += 0;
    else if (name.includes(w)) total += 1;
    else if (hay.includes(w)) total += 2;
    else {
      let i = 0;
      for (const ch of name) if (ch === w[i]) i++;
      if (i < w.length) return null;
      total += 3;
    }
  }
  return total;
}

export default class Palette extends View {
  init(_props, cx) {
    this.at = 0; this.top = 0; this.filter = "";
    this.input = InputState.new({ placeholder: "Run a command…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; this.top = 0; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.go(this.items()[this.at]));
    this.input.focus();
    cx.timer.after(300, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  items() {
    const bound = new Map();
    for (const k of keys()) {
      const name = k.action.split(":")[0];
      if (typeof k.action === "string" && !bound.has(name) && k.section === "global" && (k.action === name || k.action.startsWith(name + ":"))) bound.set(name, k.keys);
    }
    return commands()
      .filter((c) => !HIDE.has(c.name))
      .map((c) => ({ ...c, key: bound.get(c.name), needs: c.args.some((a) => a.required), s: score(c, this.filter) }))
      .filter((c) => c.s !== null)
      .sort((a, b) => a.s - b.s || a.name.localeCompare(b.name));
  }

  go(c) {
    if (!c) return;
    closeOverlay(props().overlay);
    run(c.name, {});
  }

  move(d, n) {
    this.at = n ? (this.at + d + n) % n : 0;
  }

  render(cx) {
    const t = theme(), items = this.items(), n = items.length;
    this.at = Math.min(this.at, Math.max(0, n - 1));
    if (this.at < this.top) this.top = this.at;
    if (this.at >= this.top + VISIBLE) this.top = this.at - VISIBLE + 1;
    this.top = Math.max(0, Math.min(this.top, Math.max(0, n - VISIBLE)));
    const shown = items.slice(this.top, this.top + VISIBLE);
    return v_flex().id("palette").track_focus(this.handle).w_full().min_h(0).p(18).gap(10).bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        const k = e.key, ctrl = e.modifiers.control;
        if (k === "escape") { closeOverlay(props().overlay); }
        else if (k === "down" || (ctrl && k === "n")) this.move(1, n);
        else if (k === "up" || (ctrl && k === "p")) this.move(-1, n);
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Commands"))
        .child(div().text_size(11).text_color(t.dim).child(`${n} · ↑↓ ⌃n ⌃p · Esc`)))
      .child(h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(svg("mods/workspace-chrome/search.svg").size(15).text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
      .child(v_flex().id("pal-list").h(ROW * VISIBLE).min_h(0).overflow_hidden()
        .on_scroll_wheel((e, cx) => { this.at = Math.max(0, Math.min(n - 1, this.at + (e.delta.y < 0 ? 1 : -1))); cx.notify(); })
        .children(shown.length ? shown.map((c, i) => {
          const idx = this.top + i, on = idx === this.at;
          return h_flex().id(`pal-${c.name}`).h(ROW).flex_none().mx(2).px(10).gap(10).items_center().rounded(7).cursor_pointer()
            .when(on, (e) => e.bg(t.hover)).hover((s) => s.bg(t.hover))
            .on_click(() => this.go(c))
            .child(div().flex_none().text_color(t.foreground).when(on, (d) => d.font_semibold()).child(c.name))
            .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(c.about))
            .when(c.needs, (e) => e.child(div().text_size(10).text_color(t.dim).child("…")))
            .when(Boolean(c.key), (e) => e.child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(pretty(c.key))));
        }) : [div().p(10).text_color(t.dim).child("No matching command")]));
  }
}
