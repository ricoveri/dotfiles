// tmux-style copy mode. Opened by the leader (<leader> [): snapshots the focused terminal's
// screen + history with `hc read`, shows it in a dialog and lets you move, select and yank
// with vi keys. Plain text only (hc read drops colors); `r` re-snapshots.
//
// Keys: h j k l / arrows, w b e, 0 ^ $, gg G, H M L, ctrl-u/d/b/f, counts, v V ctrl-v, o,
//       / ? n N, y or Enter (yank), r (refresh), Esc (clear selection, then quit), q (quit).
import { View, div } from "gpui-kit";
import { v_flex, h_flex, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { hc, focused, props, closeOverlay, notify, theme, settings } from "herdr";

const HISTORY = 10000;

export default class TermCopy extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.scroll = VirtualListScrollHandle.new();
    this.addr = props()?.terminal ?? focused()?.terminal ?? null;
    this.rows = [];        // { chars: string[], line, wrapped }
    this.lineStart = [];   // first row index of each logical line
    this.lines = [];       // logical lines as strings
    this.cols = 80;
    this.cur = { r: 0, c: 0 };
    this.want = 0;
    this.anchor = null;
    this.mode = null;      // null | "char" | "line" | "block"
    this.count = "";
    this.pendingG = false;
    this.prompt = null;    // { dir: "/" | "?", text }
    this.search = null;    // { q, dir }
    this.vis = 30;         // rows that fit
    this.loaded = false;
    this.error = null;
    this.rowH = 18;
    if (!this.addr) {
      notify({ title: "Copy mode", body: "No terminal focused", level: "warning" });
      this.quit();
      return;
    }
    this.load(cx, true);
  }

  quit() { const id = props()?.overlay; if (id) closeOverlay(id); }

  load(cx, toBottom) {
    cx.spawn(async (cx) => {
      const [g, r] = await Promise.all([
        hc(["get", this.addr, "--json"]),
        hc(["read", this.addr, "--lines", String(HISTORY), "--json"]),
      ]);
      try {
        this.cols = Math.max(10, JSON.parse(g.stdout).cols || 80);
        const text = JSON.parse(r.stdout).text ?? "";
        this.lines = text.replace(/\s+$/, "").split("\n");
      } catch (e) {
        this.error = String(r.stderr || g.stderr || e).slice(0, 200);
        this.lines = [];
      }
      this.build();
      this.loaded = true;
      if (toBottom) {
        this.cur = { r: this.rows.length - 1, c: 0 };
        this.want = 0;
        this.scroll.scroll_to_bottom();
      } else this.clamp();
      cx.notify();
    });
  }

  build() {
    this.rows = [];
    this.lineStart = [];
    this.lines.forEach((ln, i) => {
      this.lineStart.push(this.rows.length);
      const cs = Array.from(ln);
      const n = Math.max(1, Math.ceil(cs.length / this.cols));
      for (let k = 0; k < n; k++)
        this.rows.push({ chars: cs.slice(k * this.cols, (k + 1) * this.cols), line: i, wrapped: k < n - 1 });
    });
    if (!this.rows.length) { this.rows.push({ chars: [], line: 0, wrapped: false }); this.lineStart.push(0); this.lines = [""]; }
  }

  // ---- geometry helpers ----
  rowLen(r) { return Math.max(1, this.rows[r].chars.length); }
  clamp() {
    this.cur.r = Math.min(Math.max(0, this.cur.r), this.rows.length - 1);
    this.cur.c = Math.min(Math.max(0, this.cur.c), this.rowLen(this.cur.r) - 1);
  }
  ch(r, c) { return this.rows[r].chars[c] ?? " "; }
  next(p) { return p.c + 1 < this.rowLen(p.r) ? { r: p.r, c: p.c + 1 } : p.r + 1 < this.rows.length ? { r: p.r + 1, c: 0 } : null; }
  prev(p) { return p.c > 0 ? { r: p.r, c: p.c - 1 } : p.r > 0 ? { r: p.r - 1, c: this.rowLen(p.r - 1) - 1 } : null; }
  isSp(p) { return /\s/.test(this.ch(p.r, p.c)); }

  wordFwd(p) {
    let q = p;
    while (q && !this.isSp(q)) q = this.next(q) && (this.rows[q.r].wrapped || q.c + 1 < this.rowLen(q.r)) ? this.next(q) : null;
    // (crossing a hard row break ends the word)
    let s = this.next(p) ? p : null;
    if (!s) return p;
    let a = p;
    while (a && !this.isSp(a)) { const n = this.next(a); if (!n) return a; if (n.r !== a.r && !this.rows[a.r].wrapped) { a = n; break; } a = n; }
    while (a && this.isSp(a)) { const n = this.next(a); if (!n) return a; a = n; }
    return a;
  }
  wordBack(p) {
    let a = this.prev(p);
    if (!a) return p;
    while (this.isSp(a)) { const n = this.prev(a); if (!n) return a; a = n; }
    for (;;) {
      const n = this.prev(a);
      if (!n || this.isSp(n) || (n.r !== a.r && !this.rows[n.r].wrapped)) return a;
      a = n;
    }
  }
  wordEnd(p) {
    let a = this.next(p);
    if (!a) return p;
    while (this.isSp(a)) { const n = this.next(a); if (!n) return a; a = n; }
    for (;;) {
      const n = this.next(a);
      if (!n || this.isSp(n) || (n.r !== a.r && !this.rows[a.r].wrapped)) return a;
      a = n;
    }
  }

  move(r, c, keepWant) {
    this.cur = { r, c };
    this.clamp();
    if (!keepWant) this.want = this.cur.c;
    this.scroll.scroll_to_item(this.cur.r);
  }
  vert(dr) {
    const r = Math.min(Math.max(0, this.cur.r + dr), this.rows.length - 1);
    this.cur = { r, c: Math.min(this.want, this.rowLen(r) - 1) };
    this.scroll.scroll_to_item(r);
  }

  // ---- selection ----
  range() {
    if (!this.mode) return null;
    let a = this.anchor, b = this.cur;
    if (a.r > b.r || (a.r === b.r && a.c > b.c)) [a, b] = [b, a];
    return { a, b };
  }
  // Selected [from, to) columns on row r, or null.
  selCols(r, rg) {
    if (!rg || r < rg.a.r || r > rg.b.r) return null;
    const len = this.rowLen(r);
    if (this.mode === "line") return [0, len];
    if (this.mode === "block") {
      const c1 = Math.min(this.anchor.c, this.cur.c), c2 = Math.max(this.anchor.c, this.cur.c);
      return [c1, c2 + 1];
    }
    return [r === rg.a.r ? rg.a.c : 0, r === rg.b.r ? rg.b.c + 1 : len];
  }
  selectedText() {
    const rg = this.range();
    if (!rg) return "";
    let r1 = rg.a.r, r2 = rg.b.r;
    if (this.mode === "line") { r1 = this.lineStart[this.rows[r1].line]; while (r2 + 1 < this.rows.length && this.rows[r2].wrapped) r2++; }
    let out = "";
    for (let r = r1; r <= r2; r++) {
      const sc = this.mode === "line" ? [0, this.rowLen(r)] : this.selCols(r, rg);
      let s = this.rows[r].chars.slice(sc[0], sc[1]).join("");
      const soft = this.mode !== "block" && this.rows[r].wrapped;
      if (!soft) s = s.replace(/\s+$/, "");
      out += s + (r < r2 ? (soft ? "" : "\n") : this.mode === "line" ? "\n" : "");
    }
    return out;
  }
  yank(cx) {
    const text = this.mode ? this.selectedText() : this.rows[this.cur.r].chars.join("").replace(/\s+$/, "");
    if (!text) return;
    cx.write_to_clipboard(text);
    notify({ title: "Copied", body: `${Array.from(text).length} chars`, level: "success", timeout: 1500 });
    this.quit();
  }

  // ---- search ----
  find(q, dir, from) {
    if (!q) return;
    const needle = q.toLowerCase();
    const n = this.lines.length;
    const li = this.rows[from.r].line;
    const off = from.r === this.lineStart[li] + 0 ? from.c : (from.r - this.lineStart[li]) * this.cols + from.c;
    for (let k = 0; k <= n; k++) {
      const i = ((dir > 0 ? li + k : li - k) % n + n) % n;
      const hay = Array.from(this.lines[i].toLowerCase());
      const text = hay.join("");
      let hit = -1;
      if (dir > 0) {
        const start = k === 0 ? off + 1 : 0;
        const idx = text.indexOf(needle, start);
        hit = idx;
      } else {
        const idx = k === 0 ? (off > 0 ? text.lastIndexOf(needle, off - 1) : -1) : text.lastIndexOf(needle);
        hit = idx;
      }
      if (hit >= 0) {
        // text is UTF-16 index; convert to code-point column
        const cp = Array.from(text.slice(0, hit)).length;
        this.move(this.lineStart[i] + Math.floor(cp / this.cols), cp % this.cols);
        return;
      }
    }
    notify({ title: "Copy mode", body: `Not found: ${q}`, level: "info", timeout: 1500 });
  }
  matchCols(r) {
    const q = this.search?.q?.toLowerCase();
    if (!q) return null;
    const row = this.rows[r];
    const text = row.chars.join("").toLowerCase();
    const out = [];
    for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + 1)) {
      const a = Array.from(text.slice(0, i)).length;
      out.push([a, a + Array.from(q).length]);
    }
    return out.length ? out : null;
  }

  // ---- keys ----
  key(e, cx) {
    cx.stop_propagation();
    const k = e.key;
    if (["control", "shift", "alt", "meta", "cmd"].includes(k)) return;
    const m = e.modifiers ?? {};
    let ch = e.key_char ?? (k.length === 1 ? (m.shift ? k.toUpperCase() : k) : null);

    if (this.prompt) {
      if (k === "escape") this.prompt = null;
      else if (k === "enter") {
        const q = this.prompt.text, dir = this.prompt.dir === "/" ? 1 : -1;
        this.prompt = null;
        if (q) { this.search = { q, dir }; this.find(q, dir, this.cur); }
      } else if (k === "backspace") this.prompt.text = Array.from(this.prompt.text).slice(0, -1).join("");
      else if (ch && !m.control && !m.alt && !m.meta && !m.cmd) this.prompt.text += ch;
      cx.notify();
      return;
    }

    const half = Math.max(1, Math.floor(this.vis / 2));
    const n = this.count ? parseInt(this.count, 10) : 1;
    const hadCount = this.count !== "";
    const done = () => { this.count = ""; this.pendingG = false; cx.notify(); };

    if (m.control) {
      if (k === "u") this.vert(-half * n);
      else if (k === "d") this.vert(half * n);
      else if (k === "b") this.vert(-this.vis * n);
      else if (k === "f") this.vert(this.vis * n);
      else if (k === "v") this.toggle("block");
      else if (k === "c") return this.quit();
      return done();
    }

    if (/^[0-9]$/.test(k) && !(k === "0" && !hadCount) && !m.shift) { this.count += k; cx.notify(); return; }

    if (this.pendingG) {
      this.pendingG = false;
      if (ch === "g") { this.move(hadCount ? Math.min(n, this.rows.length) - 1 : 0, 0); return done(); }
    }

    switch (k === "escape" || k === "enter" || k.length > 1 ? k : ch) {
      case "h": case "left": this.move(this.cur.r, this.cur.c - n); break;
      case "l": case "right": this.move(this.cur.r, this.cur.c + n); break;
      case "j": case "down": this.vert(n); break;
      case "k": case "up": this.vert(-n); break;
      case "pageup": this.vert(-this.vis); break;
      case "pagedown": this.vert(this.vis); break;
      case "0": case "home": this.move(this.cur.r, 0); break;
      case "^": { const i = this.rows[this.cur.r].chars.findIndex((c) => /\S/.test(c)); this.move(this.cur.r, Math.max(0, i)); break; }
      case "$": case "end": this.move(this.cur.r, this.rowLen(this.cur.r) - 1); this.want = 1e9; break;
      case "w": { let p = this.cur; for (let i = 0; i < n; i++) p = this.wordFwd(p); this.move(p.r, p.c); break; }
      case "b": { let p = this.cur; for (let i = 0; i < n; i++) p = this.wordBack(p); this.move(p.r, p.c); break; }
      case "e": { let p = this.cur; for (let i = 0; i < n; i++) p = this.wordEnd(p); this.move(p.r, p.c); break; }
      case "g": this.pendingG = true; cx.notify(); return;
      case "G": this.move(hadCount ? Math.min(n, this.rows.length) - 1 : this.rows.length - 1, 0); break;
      case "H": case "M": case "L": {
        this.vert(0); // viewport top is unknown to script; approximate relative to cursor page
        const top = Math.max(0, this.cur.r - (this.cur.r % this.vis));
        const r = ch === "H" ? top : ch === "M" ? top + Math.floor(this.vis / 2) : top + this.vis - 1;
        this.move(r, 0);
        break;
      }
      case "v": this.toggle("char"); break;
      case "V": this.toggle("line"); break;
      case "o": if (this.mode) { const a = this.anchor; this.anchor = this.cur; this.cur = a; this.scroll.scroll_to_item(a.r); } break;
      case "/": case "?": this.prompt = { dir: ch, text: "" }; break;
      case "n": if (this.search) this.find(this.search.q, this.search.dir, this.cur); break;
      case "N": if (this.search) this.find(this.search.q, -this.search.dir, this.cur); break;
      case "y": case "enter": return this.yank(cx);
      case "r": this.load(cx, false); break;
      case "escape": if (this.mode) { this.mode = null; this.anchor = null; break; } return this.quit();
      case "q": return this.quit();
      default: break;
    }
    done();
  }
  toggle(mode) {
    if (this.mode === mode) { this.mode = null; this.anchor = null; }
    else { if (!this.mode) this.anchor = { ...this.cur }; this.mode = mode; }
  }

  // ---- render ----
  rowEl(r, t, rg, font, fs) {
    const row = this.rows[r];
    const sel = this.selCols(r, rg);
    const ms = this.matchCols(r);
    const isCur = r === this.cur.r;
    const len = Math.max(row.chars.length, isCur ? this.cur.c + 1 : 0, 1);
    // classify each column: 2 = cursor, 1 = selected, 3 = match, 0 = plain
    const cls = (c) => (isCur && c === this.cur.c ? 2 : sel && c >= sel[0] && c < sel[1] ? 1 : ms && ms.some(([a, b]) => c >= a && c < b) ? 3 : 0);
    const runs = [];
    for (let c = 0; c < len; c++) {
      const k = cls(c), ch = row.chars[c] ?? " ";
      const last = runs[runs.length - 1];
      if (last && last.k === k && k !== 2) last.s += ch; else runs.push({ k, s: ch });
    }
    const el = h_flex().h(this.rowH).items_center().px(10).font_family(font).text_size(fs).text_color(t.foreground).whitespace_nowrap();
    return el.children(runs.map((x) => {
      const d = div().child(x.s);
      if (x.k === 2) return d.bg(t.accent).text_color(t.surface);
      if (x.k === 1) return d.bg(t.selection);
      if (x.k === 3) return d.bg(t.raised).text_color(t.accent);
      return d;
    }));
  }

  render(cx) {
    const t = theme(), st = settings();
    const font = st.font_family || "monospace", fs = Number(st.font_size) || 13;
    this.rowH = Math.round(fs * 1.4);
    const rg = this.range();
    const label = this.mode === "line" ? "V-LINE" : this.mode === "block" ? "V-BLOCK" : this.mode === "char" ? "VISUAL" : "COPY";
    const status = this.prompt ? `${this.prompt.dir}${this.prompt.text}▏`
      : `${this.count ? this.count + " " : ""}${this.pendingG ? "g " : ""}${this.search ? `${this.search.dir > 0 ? "/" : "?"}${this.search.q}  ` : ""}`;
    return v_flex().id("term-copy").track_focus(this.handle).size_full().min_h(0).bg(t.surface)
      .border_1().border_color(t.border).rounded(8).overflow_hidden()
      .on_key_down((e, cx) => this.key(e, cx))
      .on_size_change((s, cx) => { this.vis = Math.max(1, Math.floor((s.height - 28) / this.rowH)); })
      .child(div().flex_1().min_h(0).relative().child(
        this.error ? div().p(12).text_color(t.dim).child(this.error)
        : !this.loaded ? div().p(12).text_color(t.dim).child("reading…")
        : v_virtual_list("tc-rows", this.rows.length, this.rowH, (i) => `r${i}`,
            (range) => { const out = []; for (let i = range.start; i < range.end; i++) out.push(this.rowEl(i, t, rg, font, fs)); return out; })
          .track_scroll(this.scroll).size_full()))
      .child(h_flex().h(28).flex_none().px(10).gap(12).items_center().bg(t.popover).border_t(1).border_color(t.border).text_size(12)
        .child(div().px(6).rounded(4).bg(t.accent).text_color(t.surface).font_semibold().child(label))
        .child(div().text_color(t.muted).child(this.addr ?? ""))
        .child(div().text_color(t.foreground).child(status))
        .child(div().flex_1())
        .child(div().text_color(t.dim).child(`${this.cur.r + 1}/${this.rows.length}`))
        .child(div().text_color(t.dim).child("v select · y yank · / search · q quit")));
  }
}
