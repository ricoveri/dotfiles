// Switch agent. Fuzzy filter by program, title, space, tab or status. ↑/↓ or ctrl+n / ctrl+p move,
// Enter jumps to the agent's pane (switching space and tab), Esc closes. Opened by <leader>; (mods/leader).
// With no filter, agents that need you come first (blocked > done > working > idle), then most recent.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, run, theme, props, closeOverlay } from "herdr";

const ROW = 40, VISIBLE = 9;
const URGENCY = { blocked: 0, done: 1, working: 2, idle: 3 };
const WORD = { blocked: "needs you", done: "finished", working: "working", idle: "idle" };

// Lower is better; null = no match. Every space-separated word must match somewhere.
function score(a, q) {
  if (!q) return 0;
  const name = (a.program?.name ?? a.app ?? "").toLowerCase();
  const hay = `${name} ${(a.title ?? "").toLowerCase()} ${a.space_name.toLowerCase()} ${a.tab_name.toLowerCase()} ${WORD[a.status] ?? a.status}`;
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

export default class AgentSelect extends View {
  init(_props, cx) {
    this.at = 0; this.top = 0; this.filter = "";
    this.input = InputState.new({ placeholder: "Switch to an agent…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; this.top = 0; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.go(this.items()[this.at]));
    this.input.focus();
    cx.timer.after(300, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  items() {
    return agents().map((a) => ({ ...a, s: score(a, this.filter) })).filter((a) => a.s !== null)
      .sort((a, b) => a.s - b.s || (this.filter ? 0 : (URGENCY[a.status] ?? 4) - (URGENCY[b.status] ?? 4)) || b.seq - a.seq);
  }

  go(a) {
    if (!a) return;
    closeOverlay(props().overlay);
    run("pane.focus", { pane: a.pane });
  }

  glyph(t, st) {
    if (st === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900);
    return div().w(12).flex_none().text_color(t[st] ?? t.dim).child(st === "idle" ? "○" : "●");
  }

  render(cx) {
    const t = theme(), items = this.items(), n = items.length;
    this.at = Math.min(this.at, Math.max(0, n - 1));
    if (this.at < this.top) this.top = this.at;
    if (this.at >= this.top + VISIBLE) this.top = this.at - VISIBLE + 1;
    this.top = Math.max(0, Math.min(this.top, Math.max(0, n - VISIBLE)));
    const shown = items.slice(this.top, this.top + VISIBLE);
    const move = (d) => { this.at = n ? (this.at + d + n) % n : 0; };
    return v_flex().id("agent-select").track_focus(this.handle).w_full().min_h(0).p(18).gap(10).bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        const k = e.key, ctrl = e.modifiers.control;
        if (k === "escape") closeOverlay(props().overlay);
        else if (k === "down" || (ctrl && k === "n")) move(1);
        else if (k === "up" || (ctrl && k === "p")) move(-1);
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Agents"))
        .child(div().text_size(11).text_color(t.dim).child(`${n} · ↑↓ ⌃n ⌃p · Esc`)))
      .child(h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(svg("mods/workspace-chrome/search.svg").size(15).text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
      .child(v_flex().id("ag-list").h(ROW * VISIBLE).min_h(0).overflow_hidden()
        .on_scroll_wheel((e, cx) => { this.at = Math.max(0, Math.min(n - 1, this.at + (e.delta.y < 0 ? 1 : -1))); cx.notify(); })
        .children(shown.length ? shown.map((a, i) => {
          const on = this.top + i === this.at;
          return h_flex().id(`ag-${a.address}`).h(ROW).flex_none().mx(2).px(10).gap(10).items_center().rounded(7).cursor_pointer()
            .when(on, (e) => e.bg(t.hover)).hover((x) => x.bg(t.hover))
            .on_click(() => this.go(a))
            .child(this.glyph(t, a.status))
            .child(v_flex().flex_1().min_w(0)
              .child(h_flex().gap(8).items_center()
                .child(div().flex_none().text_color(t.foreground).when(on || a.focused, (d) => d.font_semibold()).child(a.program?.name ?? a.app ?? "agent"))
                .when(a.focused, (e) => e.child(div().text_size(10).text_color(t.accent).child("current")))
                .when(a.pinned, (e) => e.child(div().text_size(10).text_color(t.dim).child("pinned"))))
              .child(div().truncate().text_size(11).text_color(t.dim).child(a.title || "")))
            .child(div().flex_none().text_size(11).text_color(t.muted).child(`${a.space_name} · ${a.tab_name}`))
            .child(div().w(62).flex_none().text_size(11).text_right().text_color(a.status === "blocked" ? t.blocked : a.status === "done" ? t.done : t.dim).child(WORD[a.status] ?? a.status));
        }) : [div().p(10).text_color(t.dim).child("No matching agent")]));
  }
}
