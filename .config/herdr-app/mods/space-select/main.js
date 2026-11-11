// Switch space. Fuzzy filter by name, folder, branch or machine. ↑/↓ or ctrl+n / ctrl+p move,
// Enter switches, Esc closes. Opened by <leader>ss (mods/leader).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, run, theme, props, closeOverlay } from "herdr";

const ROW = 38, VISIBLE = 9;
const home = (p) => (p ?? "").replace(/^\/(Users|home)\/[^/]+/, "~");

// Lower is better; null = no match. Every space-separated word must match somewhere.
function score(s, q) {
  if (!q) return 0;
  const name = s.name.toLowerCase(), hay = `${name} ${(s.folder ?? "").toLowerCase()} ${(s.branch ?? "").toLowerCase()} ${(s.machine ?? "").toLowerCase()}`;
  let total = 0;
  for (const w of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    if (name.startsWith(w)) total += 0;
    else if (name.includes(w)) total += 1;
    else if (hay.includes(w)) total += 2;
    else {
      let i = 0;
      for (const ch of hay) if (ch === w[i]) i++;
      if (i < w.length) return null;
      total += 3;
    }
  }
  return total;
}

export default class SpaceSelect extends View {
  init(_props, cx) {
    this.at = 0; this.top = 0; this.filter = "";
    this.input = InputState.new({ placeholder: "Switch to a space…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; this.top = 0; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.go(this.items()[this.at]));
    this.input.focus();
    cx.timer.after(300, () => this.input.focus());
    this.handle = cx.focus_handle();
    // Open on the shown space, so ctrl+n / ctrl+p are relative to where you are.
    const i = this.items().findIndex((s) => s.active);
    this.at = Math.max(0, i);
  }

  items() {
    return spaces().map((s) => ({ ...s, s: score(s, this.filter) })).filter((s) => s.s !== null)
      .sort((a, b) => a.s - b.s || a.index - b.index);
  }

  go(s) {
    if (!s) return;
    closeOverlay(props().overlay);
    run("space.select", { id: s.id });
  }

  render(cx) {
    const t = theme(), items = this.items(), n = items.length;
    this.at = Math.min(this.at, Math.max(0, n - 1));
    if (this.at < this.top) this.top = this.at;
    if (this.at >= this.top + VISIBLE) this.top = this.at - VISIBLE + 1;
    this.top = Math.max(0, Math.min(this.top, Math.max(0, n - VISIBLE)));
    const shown = items.slice(this.top, this.top + VISIBLE);
    const move = (d) => { this.at = n ? (this.at + d + n) % n : 0; };
    return v_flex().id("space-select").track_focus(this.handle).w_full().min_h(0).p(18).gap(10).bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        const k = e.key, ctrl = e.modifiers.control;
        if (k === "escape") closeOverlay(props().overlay);
        else if (k === "down" || (ctrl && k === "n")) move(1);
        else if (k === "up" || (ctrl && k === "p")) move(-1);
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Spaces"))
        .child(div().text_size(11).text_color(t.dim).child(`${n} · ↑↓ ⌃n ⌃p · Esc`)))
      .child(h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(svg("mods/workspace-chrome/search.svg").size(15).text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
      .child(v_flex().id("ss-list").h(ROW * VISIBLE).min_h(0).overflow_hidden()
        .on_scroll_wheel((e, cx) => { this.at = Math.max(0, Math.min(n - 1, this.at + (e.delta.y < 0 ? 1 : -1))); cx.notify(); })
        .children(shown.length ? shown.map((s, i) => {
          const on = this.top + i === this.at;
          return h_flex().id(`ss-${s.id}`).h(ROW).flex_none().mx(2).px(10).gap(10).items_center().rounded(7).cursor_pointer()
            .when(on, (e) => e.bg(t.hover)).hover((x) => x.bg(t.hover))
            .on_click(() => this.go(s))
            .child(div().w(10).flex_none().text_color(s.status ? (t[s.status] ?? t.dim) : t.dim).child(s.status ? "●" : "○"))
            .child(div().flex_none().text_color(t.foreground).when(s.active || on, (d) => d.font_semibold()).child(s.name))
            .when(s.active, (e) => e.child(div().text_size(10).text_color(t.accent).child("current")))
            .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(home(s.folder)))
            .when(Boolean(s.branch), (e) => e.child(div().text_size(11).text_color(t.muted).child(`⎇ ${s.branch}`)))
            .when(Boolean(s.machine), (e) => e.child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(s.machine)))
            .child(div().w(18).flex_none().text_size(10).text_color(t.dim).text_right().child(String(s.index + 1)));
        }) : [div().p(10).text_color(t.dim).child("No matching space")]));
  }
}
