// Worktree dialog: { space, action: "new" | "open" | "remove" } or
// { folder, machine } for a repo without a space; optional { branch, tab, argv }.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar } from "gpui-base";
import { run, props, closeOverlay, theme, spaces, panes, exec, home, notify } from "herdr";
import { hooksFor, hookEnv, hookArgv } from "./hooks.js";
import { getCreds, saveCreds, defaultEmail, searchIssues, siteUrl, verifyCreds, fetchPool, rank } from "./jira.js";

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s, all = panes()) {
  if (!s) return null;
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return all.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

// Checkouts go to <ROOT>/<repo>/<branch, slashes as dashes>.
const ROOT = (home) => `${home}/Projects/worktrees`;
// Home as ~ (git says C:/Users/x where Windows says C:\Users\x).
const tilde = (path, userHome) => {
  const [p, h] = [path, userHome].map((s) => s.replace(/\\/g, "/"));
  return p.startsWith(h) ? `~${p.slice(h.length)}` : path;
};
const slug = (branch) => branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
const ago = (s) => {
  const d = Date.now() / 1000 - s;
  return d < 3600 ? `${Math.max(1, Math.round(d / 60))}m` : d < 86400 ? `${Math.round(d / 3600)}h` : d < 86400 * 60 ? `${Math.round(d / 86400)}d` : `${Math.round(d / 86400 / 30)}mo`;
};

// Every checkout of a repo (`git worktree list`), the main one first, then
// the most recently committed: { path, branch, main, at }.
async function checkouts(repo, on) {
  const list = await git(repo.main, ["worktree", "list", "--porcelain"], on);
  if (!list.ok) return [];
  const refs = await git(repo.main, ["for-each-ref", "--format=%(refname:short)%09%(committerdate:unix)", "refs/heads"], on);
  const when = new Map(refs.out.split("\n").map((l) => l.split("\t")).map(([b, at]) => [b, Number(at) || 0]));
  const out = [];
  for (const block of list.out.split(/\n\n+/)) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!path || lines.some((l) => l === "bare" || l.startsWith("prunable"))) continue;
    const branch = lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? null;
    out.push({ path, branch, main: out.length === 0, at: branch ? (when.get(branch) ?? 0) : 0 });
  }
  return out.sort((a, b) => b.main - a.main || b.at - a.at);
}

// The space showing a checkout: its first terminal is in it (the deepest checkout wins).
function spaceOf(path, all, on, spaceList, paneList) {
  const inside = (p, dir) => p === dir || p.startsWith(dir + "/");
  return spaceList.find((s) => (s.machine ?? null) === (on ?? null) && (() => {
    const at = place(s, paneList)?.replace(/\\/g, "/");
    if (!at || !inside(at, path)) return false;
    return !all.some((c) => c.path !== path && c.path.length > path.length && inside(at, c.path));
  })());
}

async function git(cwd, args, on, timeout) {
  const r = await exec("git", args, { cwd, on, ...(timeout === undefined ? {} : { timeout }) });
  return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? r.stdout ?? "").trim() };
}

// The submodule repos git keeps for a checkout (nested ones too, checked out
// or not): { name, dir, pinned }. `config` is the args that read its
// .gitmodules; `pinned` is the commit its parent records ("" if none).
async function modules(gitDir, config, on, out = [], parent = "") {
  const keys = await git(gitDir, ["--git-dir", gitDir, "config", ...config, "-z", "--get-regexp", "^submodule\\..*\\.path$"], on);
  if (!keys.ok) return out; // no .gitmodules, or no submodules in it
  // -z: "key\nvalue" records ended by NUL, so names and paths may hold spaces.
  for (const record of keys.out.split("\0").filter(Boolean)) {
    const at = record.indexOf("\n");
    const name = record.slice("submodule.".length, at - ".path".length);
    const dir = `${gitDir}/modules/${name}`;
    if (!(await git(gitDir, ["--git-dir", dir, "rev-parse", "--git-dir"], on)).ok) continue; // never checked out
    const pinned = await git(gitDir, ["--git-dir", gitDir, "rev-parse", `HEAD:${record.slice(at + 1)}`], on);
    // Names are only unique within their parent: nested ones carry its name.
    out.push({ name: parent + name, dir, pinned: pinned.ok ? pinned.out : "" });
    if ((await git(gitDir, ["--git-dir", dir, "cat-file", "-e", "HEAD:.gitmodules"], on)).ok) await modules(dir, ["--blob", "HEAD:.gitmodules"], on, out, `${parent + name}/`);
  }
  return out;
}

// The worktree's submodules, and the names of those with commits that exist
// nowhere else: not on a remote, and not the commit the parent pins (git
// fetches that by hash, so it is often on no remote branch here).
async function submodules(top, on) {
  const gitDir = await git(top, ["rev-parse", "--absolute-git-dir"], on);
  if (!gitDir.ok) throw new Error(gitDir.err || "git rev-parse failed.");
  const mods = await modules(gitDir.out, ["--file", `${top}/.gitmodules`], on);
  const unpushed = [];
  for (const m of mods) {
    const local = await git(gitDir.out, ["--git-dir", m.dir, "rev-list", "-n1", "--all", "--not", "--remotes", ...(m.pinned ? [m.pinned] : [])], on);
    if (!local.ok) throw new Error(local.err || `Couldn't check submodule ${m.name}.`);
    if (local.out) unpushed.push(m.name);
  }
  return { mods, unpushed };
}

// The repo a folder belongs to: its main checkout and name, and whether
// the folder is itself a linked worktree. null outside git.
async function repoOf(folder, on) {
  const top = await git(folder, ["rev-parse", "--show-toplevel"], on);
  const common = await git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"], on);
  if (!top.ok || !common.ok) return null;
  const main = common.out.endsWith("/.git") ? common.out.slice(0, -5) : common.out;
  return { top: top.out, main, name: main.split("/").pop(), linked: main !== top.out };
}

export default class Worktree extends View {
  init(_props, cx) {
    this.on = this.space()?.machine;
    this.userHome = this.on ? null : home();
    this.opening = props()?.action === "open";
    this.text = props()?.branch ?? "";
    this.list = undefined; // open: the checkouts, once read
    this.at = 0;
    this.input = InputState.new({ value: this.text, placeholder: this.opening ? "filter worktrees" : "branch name, or search tickets…" });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); this.error = ""; this.at = 0; this.tat = -1; this.queue(cx); cx.notify(); });
    this.input.on("submit", (_e, cx) => this.go(cx));
    this.inputFocused = true;
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    this.handle = cx.focus_handle();
    this.handle.focus(); // the root is mounted from the first frame: keep the keyboard here while loading
    if (props()?.action !== "remove") this.input.focus();
    this.busy = false;
    this.error = "";
    this.repo = undefined; // undefined: looking, null: not in git
    this.dirty = false;
    this.unpushed = [];
    // Jira ticket picker (new worktree only). Site, project and token live in the Keychain, never in this file.
    this.jira = !this.opening && props()?.action !== "remove" && !props()?.branch;
    this.tickets = []; // what the list shows: ranked pool hits, then Jira's
    this.pool = []; // the project's open tickets, fetched once
    this.poolReady = false;
    this.remote = []; // Jira's own hits, for tickets outside the pool
    this.searching = false;
    this.tat = -1; // selected ticket; -1 = none, Enter uses the typed branch
    this.seq = 0; // drops stale search responses
    this.creds = undefined; // undefined: reading, null: not connected
    this.form = false;
    this.jiraMsg = "";
    if (this.jira) {
      const field = (placeholder, masked) => {
        const s = InputState.new({ placeholder });
        if (masked) s.set_masked(true);
        return s;
      };
      this.fields = [field("Jira site (e.g. acme or acme.atlassian.net)"), field("Project key (e.g. ABC)"), field("Atlassian email"), field("API token", true)];
      this.fields.forEach((f, i) => f.on("submit", (_e, cx) => (i === this.fields.length - 1 ? this.saveJira(cx) : this.fields[i + 1].focus())));
      cx.spawn(async (cx) => {
        this.creds = await getCreds();
        if (this.creds) await this.loadPool(cx);
        else cx.notify();
      });
    }
    cx.spawn(async (cx) => {
      try {
        if (this.on) {
          let result;
          try { result = await exec("sh", ["-c", 'printf %s "$HOME"'], { on: this.on }); } catch {}
          if (!result || result.code !== 0 || !result.stdout.trim()) result = await exec("powershell.exe", ["-NoProfile", "-Command", "[Console]::Write($HOME)"], { on: this.on });
          if (result.code !== 0 || !result.stdout.trim()) throw new Error("Could not find the remote home folder.");
          this.userHome = result.stdout.trim().replace(/\\/g, "/");
        }
        this.folder = props()?.folder || place(this.space()) || this.userHome;
        // The repo is set last: Enter does nothing until the warnings it consents to are known.
        const repo = await repoOf(this.folder, this.on);
        if (repo && props().action === "remove") {
          this.dirty = (await git(repo.top, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], this.on)).out !== "";
          this.unpushed = (await submodules(repo.top, this.on)).unpushed;
        }
        if (repo && this.opening) this.list = await checkouts(repo, this.on);
        this.repo = repo;
        cx.notify();
        // The list (and with it the filter input) only mounts once loading is
        // done, so the keyboard must move there now — a focus call made while
        // loading lands on nothing and the dialog stays keyboard-dead.
        this.handle.focus();
        if (props().action !== "remove") cx.timer.after(100, () => this.input.focus());
        if (props().branch) await this.work(cx);
      } catch (error) { this.repo = null; this.error = String(error); cx.notify(); }
    });
  }

  space() {
    const p = props() ?? {};
    return spaces().find((s) => s.id === p.space) ?? (p.folder ? { folder: p.folder, machine: p.machine ?? null, name: "" } : undefined);
  }

  close() {
    closeOverlay(props().overlay);
  }

  go(cx) {
    if (this.busy || !this.repo) return;
    cx.spawn(async (cx) => this.work(cx));
  }

  async work(cx) {
    if (this.busy || !this.repo) return;
    this.busy = true;
    this.error = "";
    cx.notify();
    try { this.error = props().action === "remove" ? await this.remove() : await this.create(); }
    catch (error) { this.error = String(error); }
    this.busy = false;
    if (!this.error) this.close();
    cx.notify();
  }

  jiraError(e) {
    return e.message === "auth" ? "Jira auth failed · ctrl+j to fix" : `Jira unavailable (${e.message})`;
  }

  // Shown list: local fuzzy matches first, then Jira's own hits for tickets outside the pool.
  // The selection follows its ticket when results arrive late.
  refresh() {
    const sel = this.tickets[this.tat]?.key;
    const local = rank(this.pool, this.text);
    const seen = new Set(local.map((t) => t.key));
    this.tickets = [...local, ...rank(this.remote, this.text).filter((t) => !seen.has(t.key))].slice(0, 40);
    this.tat = sel ? this.tickets.findIndex((t) => t.key === sel) : -1;
  }

  async loadPool(cx) {
    this.pool = [];
    this.remote = [];
    this.poolReady = false;
    try { this.pool = await fetchPool(this.creds); this.jiraMsg = ""; }
    catch (e) { this.jiraMsg = this.jiraError(e); }
    this.poolReady = true;
    this.refresh();
    cx.notify();
  }

  // Each keystroke re-ranks the pool at once; Jira is asked (debounced) only when it has few hits.
  queue(cx) {
    if (!this.jira || !this.creds || this.form) return;
    const n = ++this.seq;
    this.refresh();
    if (!this.text.trim() || rank(this.pool, this.text).length >= 5) { this.searching = false; return; }
    this.searching = true;
    cx.timer.after(350, () => { if (n === this.seq) cx.spawn(async (c) => this.search(c, n)); });
  }

  async search(cx, n) {
    try {
      const rows = await searchIssues(this.text, this.creds);
      if (n !== this.seq) return;
      this.remote = rows;
      this.jiraMsg = "";
    } catch (e) {
      if (n !== this.seq) return;
      this.jiraMsg = this.jiraError(e);
    }
    this.searching = false;
    this.refresh();
    cx.notify();
  }

  openForm(cx) {
    this.form = true;
    this.jiraMsg = "";
    cx.notify();
    cx.spawn(async (cx) => {
      const c = this.creds;
      const values = [c?.site ?? "", c?.project ?? "", c?.email || (await defaultEmail()), ""];
      this.fields.forEach((f, i) => f.set_value(values[i]));
      cx.notify();
      cx.timer.after(100, () => this.fields[values.findIndex((v) => !v)]?.focus() ?? this.fields[0].focus());
    });
  }

  saveJira(cx) {
    const [site, project, email, token] = this.fields.map((f) => f.value().trim());
    if (!siteUrl(site) || !project || !email || !token) { this.jiraMsg = "Fill in all four fields."; return cx.notify(); }
    if (this.verifying) return;
    this.verifying = true;
    this.jiraMsg = "";
    cx.notify();
    cx.spawn(async (cx) => {
      const creds = { site, project: project.toUpperCase(), email, token };
      let who;
      try {
        who = await verifyCreds(creds); // nothing is stored unless Jira accepts it
        await saveCreds(creds);
      } catch (e) {
        this.verifying = false;
        this.jiraMsg = e instanceof Error ? e.message : String(e);
        cx.notify();
        return;
      }
      this.verifying = false;
      this.creds = creds;
      this.form = false;
      this.jiraMsg = "";
      this.jiraNote = `Connected as ${who}`;
      this.fields[3].set_value("");
      this.input.focus();
      await this.loadPool(cx);
    });
  }

  async create() {
    const branch = this.tickets[this.tat]?.key ?? this.text.trim();
    if (!branch) return "Type a branch name.";
    const path = `${ROOT(this.userHome)}/${this.repo.name}/${slug(branch)}`;
    const exists = (await git(this.repo.main, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], this.on)).ok;
    const add = exists ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, "HEAD"];
    const r = await git(this.repo.top, add, this.on, 600_000);
    if (!r.ok) return r.err || "git worktree add failed.";
    const p = props();
    // Leave spaces unnamed so they follow the checkout folder and nest under the repo.
    // `created` hooks run in the new space's first terminal (visible), before the agent or shell.
    const hit = this.on ? null : await hooksFor(this.repo, "created");
    run("space.new", { folder: path, machine: this.on ?? "", tab: p.tab, argv: hit ? hookArgv(hit, this.repo, path, p.argv) : p.argv });
    return "";
  }

  shown() {
    const f = this.text.trim().toLowerCase();
    return (this.list ?? []).filter((c) => !f || `${c.branch ?? ""} ${c.path}`.toLowerCase().includes(f));
  }

  open(c) {
    if (!c) return;
    this.close();
    const s = spaceOf(c.path, this.list, this.on, spaces(), panes());
    if (s) run("space.select", { id: s.id });
    else run("space.new", { folder: c.path, machine: this.on ?? "" });
  }

  async remove() {
    const s = this.space();
    const status = await git(this.repo.top, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], this.on);
    if (!status.ok) return status.err || "git status failed.";
    // git refuses a worktree with submodules unless forced, because their
    // history goes with it. The popup already showed what's at risk; only
    // risk that appeared since it opened gets one more warning.
    const { mods, unpushed } = await submodules(this.repo.top, this.on);
    const changed = (status.out && !this.dirty) || unpushed.some((name) => !this.unpushed.includes(name));
    this.dirty ||= status.out !== "";
    this.unpushed = [...new Set([...this.unpushed, ...unpushed])];
    if (changed) return "It changed since this opened. Enter again removes it anyway.";
    // Terminals first: a shell sitting in the folder keeps it busy on Windows.
    run("space.close", { id: s.id, confirmed: true });
    const force = this.dirty || mods.length > 0;
    const r = await git(this.repo.main, ["worktree", "remove", ...(force ? ["--force"] : []), this.repo.top], this.on, 600_000);
    if (!r.ok) return r.err || "git worktree remove failed.";
    // `removed` hooks run from the main checkout; the worktree folder is already gone.
    const hit = this.on ? null : await hooksFor(this.repo, "removed");
    for (const cmd of hit?.commands ?? []) {
      const res = await exec("env", [...hookEnv(hit, this.repo, this.repo.top, "removed"), "sh", "-c", cmd], { cwd: this.repo.main, timeout: 600_000 }).catch((e) => ({ code: 1, stderr: String(e) }));
      if (res.code !== 0) { notify({ title: "Worktree hook failed", body: `${cmd}\n${(res.stderr || "").trim().split("\n").pop()}`, level: "error" }); break; }
    }
    return "";
  }

  key(e, cx) {
    if (this.jira) {
      const ctrl = e.modifiers?.control;
      if (e.key === "escape" && this.form && this.creds) { this.form = false; this.input.focus(); cx.stop_propagation(); return cx.notify(); }
      if (!this.form && e.key !== "escape") {
        const n = this.tickets.length;
        if (ctrl && e.key === "j") { this.openForm(cx); cx.stop_propagation(); return; }
        if (e.key === "tab" && this.tickets[this.tat]) {
          this.text = this.tickets[this.tat].key;
          this.input.set_value(this.text);
          cx.stop_propagation();
          return cx.notify();
        }
        if (n && (e.key === "down" || e.key === "up" || (ctrl && (e.key === "n" || e.key === "p")))) {
          const d = e.key === "down" || e.key === "n" ? 1 : -1;
          this.tat = ((this.tat + 1 + d + (n + 1)) % (n + 1)) - 1;
          cx.stop_propagation();
          return cx.notify();
        }
      }
    }
    if (e.key === "escape") return this.close();
    if (this.opening) {
      const n = this.shown().length;
      if (e.key === "enter") this.open(this.shown()[this.at]);
      else if (n && (e.key === "down" || e.key === "up" || (e.modifiers?.control && (e.key === "n" || e.key === "p")))) {
        const down = e.key === "down" || e.key === "n";
        this.at = (this.at + (down ? 1 : n - 1)) % n;
      }
      else return;
      cx.stop_propagation();
      return cx.notify();
    }
    if (e.key === "enter" && props()?.action === "remove") return this.go(cx);
  }

  renderOpen(t) {
    const r = this.repo;
    const rows = this.shown();
    const all = this.list ?? [];
    const spaceList = spaces();
    const paneList = panes();
    const row = (c, i) => {
      const on = i === this.at;
      const there = spaceOf(c.path, all, this.on, spaceList, paneList);
      return v_flex()
        .id(`wt-${i}`)
        .flex_none()
        .h(44)
        .px(10)
        .justify_center()
        .rounded(7)
        .cursor_pointer()
        .when(on, (el) => el.bg(t.selected))
        .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click(() => this.open(c))
        .child(
          h_flex()
            .gap(8)
            .items_center()
            .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(c.branch ?? "detached"))
            .when(c.main, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("main checkout")))
            .when(Boolean(there), (el) => el.child(div().flex_none().text_size(11).text_color(t.accent).child("open")))
            .when(!there && c.at > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(ago(c.at)))),
        )
        .child(div().truncate().text_size(11.5).text_color(t.dim).child(tilde(c.path, this.userHome ?? "")));
    };
    const count = rows.length === all.length ? `${all.length} checkouts` : `${rows.length}/${all.length} checkouts`;
    return v_flex()
      .id("worktree")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .p(16)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .child(h_flex().child(div().flex_1().font_semibold().text_color(t.foreground).child(`Open worktree${r ? ` of ${r.name}` : ""}`)).child(div().text_size(11).text_color(t.dim).child(r ? count : "")))
      .when(r === undefined || (r && this.list === undefined), (el) => el.child(div().text_color(t.muted).child("\u2026")))
      .when(r === null, (el) => el.child(div().text_color(t.muted).child(`${this.folder ? tilde(this.folder, this.userHome ?? "") : "This folder"} is not in a git repository.`)))
      .when(Boolean(r && this.list), (el) =>
        el
          .child(Input.new(this.input).h(32).px(10).items_center().rounded(6).border(1).border_color(this.inputFocused ? t.accent : t.input).bg(t.background).text_color(t.foreground))
          .child(
            div()
              .relative()
              .flex_1()
              .min_h(0)
              .child(
                v_flex()
                  .id("wt-list")
                  .size_full()
                  .overflow_y_scroll()
                  .children(rows.map(row))
                  .when(rows.length === 0, (el) => el.child(div().p(10).text_color(t.dim).child("No matching worktrees."))),
              )
              .child(Scrollbar.vertical("wt-list").absolute().inset_0()),
          ),
      )
      .child(h_flex().justify_end().text_size(11).text_color(t.dim).child("\u2191\u2193 choose \u00b7 \u21b5 open \u00b7 esc close"));
  }

  renderJira(t, cx) {
    const box = (state) => Input.new(state).h(32).px(10).items_center().rounded(6).border(1).border_color(t.input).bg(t.background).text_color(t.foreground);
    if (this.form) {
      return v_flex().gap(8).flex_1().min_h(0)
        .child(div().text_size(11.5).text_color(t.dim).child("Connect Jira. Stored in the macOS Keychain, never in the dotfiles."))
        .children(this.fields.map(box))
        .when(Boolean(this.jiraMsg), (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(this.jiraMsg)))
        .child(div().text_size(11).text_color(t.dim).child(this.verifying ? "Checking with Jira…" : "↵ next / verify and save · esc back"));
    }
    if (this.creds === undefined) return div().flex_1().text_color(t.muted).child("…");
    if (this.creds === null) {
      return v_flex().flex_1().min_h(0).child(
        h_flex().id("jira-connect").h(44).px(10).items_center().rounded(7).cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click(() => this.openForm(cx))
          .child(div().text_color(t.accent).child("Connect Jira to pick a ticket…")),
      );
    }
    return v_flex().flex_1().min_h(0).gap(4)
      .when(Boolean(this.jiraMsg), (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(this.jiraMsg)))
      .when(Boolean(this.jiraNote || this.searching) && !this.jiraMsg, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(this.searching ? "Searching Jira…" : this.jiraNote)))
      .child(
        div().relative().flex_1().min_h(0)
          .child(
            v_flex().id("jira-list").size_full().overflow_y_scroll()
              .children(this.tickets.map((k, i) => {
                const on = i === this.tat;
                return v_flex().id(`jira-${i}`).flex_none().h(40).px(10).justify_center().rounded(7).cursor_pointer()
                  .when(on, (el) => el.bg(t.selected))
                  .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
                  .on_click(() => { this.tat = i; this.go(cx); })
                  .child(h_flex().gap(8).items_center()
                    .child(div().flex_none().font_semibold().text_color(t.foreground).child(k.key))
                    .child(div().flex_1().min_w(0).truncate().text_color(k.done ? t.dim : t.foreground).child(k.summary))
                    .child(div().flex_none().text_size(11).text_color(t.dim).child(k.status)));
              }))
              .when(this.tickets.length === 0 && !this.jiraMsg, (el) => el.child(div().p(10).text_color(t.dim).child(!this.poolReady ? "Loading tickets…" : this.searching ? "" : `No matching tickets${this.text.trim() ? ` · ↵ creates branch "${this.text.trim()}"` : ""}`))),
          )
          .child(Scrollbar.vertical("jira-list").absolute().inset_0()),
      );
  }

  render(cx) {
    const t = theme();
    if (this.opening) return this.renderOpen(t);
    const remove = props()?.action === "remove";
    const s = this.space();
    const r = this.repo;
    const title = remove ? `Remove worktree ${s?.name ?? ""}?` : `New worktree${r ? ` of ${r.name}` : ""}`;
    const detail =
      r === undefined
        ? "…"
        : r === null
          ? `${this.folder ? tilde(this.folder, this.userHome) : "This folder"} is not in a git repository.`
          : remove
            ? !r.linked
              ? "This is the repository's main checkout, not a worktree."
              : `Closes the space and deletes ${tilde(r.top, this.userHome)}. The branch stays.`
            : `A new space on a checkout in ${tilde(ROOT(this.userHome), this.userHome)}/${r.name}/. A branch that exists is checked out; a new one starts from here.`;
    const blocked = !r || (remove && !r.linked);
    return v_flex()
      .id("worktree")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .p(16)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .child(div().font_semibold().text_color(t.foreground).child(title))
      .child(div().text_color(t.muted).child(detail))
      .when(remove && this.dirty, (el) => el.child(div().text_color(t.blocked).child("It has uncommitted changes: they will be lost.")))
      .when(remove && this.unpushed.length > 0, (el) => el.child(div().text_color(t.blocked).child(`Submodule ${this.unpushed.join(", ")} has commits that aren't pushed anywhere: they will be lost.`)))
      .when(!remove && !blocked, (el) =>
        el.child(
          Input.new(this.input)
            .h(32)
            .px(10)
            .items_center()
            .rounded(6)
            .border(1)
            .border_color(this.inputFocused ? t.accent : t.input)
            .bg(t.background)
            .text_color(t.foreground),
        ),
      )
      .when(Boolean(this.error), (el) => el.child(div().text_color(t.blocked).child(this.error)))
      .when(!remove && !blocked && this.jira, (el) => el.child(this.renderJira(t, cx)))
      .when(!(this.jira && !remove && !blocked), (el) => el.child(div().flex_1()))
      .child(
        h_flex()
          .justify_end()
          .text_size(11)
          .text_color(t.dim)
          .gap(6)
          .when(this.busy, (el) => el.child(div().frames(["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], 90)))
          .child(this.busy ? "working…" : blocked ? "esc close" : remove ? "↵ remove · esc cancel" : this.jira && this.creds && !this.form ? "↑↓ ticket · ⇥ fill · ctrl+j jira · ↵ create · esc cancel" : "↵ create · esc cancel"),
      );
  }
}
