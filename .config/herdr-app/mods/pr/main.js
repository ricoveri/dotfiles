import { View, div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { spaces, panes, focused, exec, theme } from "herdr";

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, branch: space?.branch };
}
const key = () => JSON.stringify(location());

const QUERY = `query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){
 number title url state isDraft merged reviewDecision mergeable mergeStateStatus headRefName baseRefName additions deletions changedFiles
 author{login}
 reviewRequests(first:20){nodes{requestedReviewer{__typename ... on User{login} ... on Team{name}}}}
 latestReviews(first:20){nodes{state author{login} submittedAt}}
 latestOpinionatedReviews(first:20){nodes{state author{login} submittedAt}}
 commits(last:1){nodes{commit{statusCheckRollup{state contexts(first:50){nodes{__typename ... on CheckRun{name status conclusion detailsUrl} ... on StatusContext{context state targetUrl}}}}}}}
 comments(first:30){nodes{author{login} body url createdAt}}
 reviewThreads(first:60){nodes{isResolved isOutdated path line comments(first:30){nodes{author{login} body url createdAt}}}}
}}}`;

// Strip HTML/markdown noise so bot walkthroughs shrink to something readable.
function clean(body, max = 220) {
  const s = (body || "").replace(/<!--[\s\S]*?-->/g, "").replace(/<details>[\s\S]*?<\/details>/g, "").replace(/<[^>]+>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/```[\s\S]*?```/g, "[code]").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max) + "…" : s;
}
const ago = (iso) => {
  const m = Math.max(0, (Date.now() - Date.parse(iso)) / 60000);
  return m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};

export default class PrPanel extends View {
  init(_props, cx) {
    this.pr = null; this.error = null; this.loading = false; this.open = {};
    this.refresh(cx);
    cx.timer.every(30000, (cx) => this.refresh(cx));
  }

  refresh(cx) {
    if (this.loading) return;
    const { cwd, on } = location(), context = key();
    if (context !== this.context) { this.context = context; this.pr = null; this.error = null; this.open = {}; }
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const v = await exec("gh", ["pr", "view", "--json", "number,url"], { cwd, on, timeout: 30000 });
        if (key() !== context) return;
        if (v.code !== 0) { this.pr = null; this.error = /no pull requests? found/i.test(v.stderr) ? "No PR for this branch" : (v.stderr || "gh failed").trim().split("\n")[0]; return; }
        const { number, url } = JSON.parse(v.stdout);
        const [, owner, repo] = /github\.com\/([^/]+)\/([^/]+)\/pull/.exec(url) || [];
        const g = await exec("gh", ["api", "graphql", "-f", `query=${QUERY}`, "-f", `o=${owner}`, "-f", `r=${repo}`, "-F", `n=${number}`], { cwd, on, timeout: 60000 });
        if (g.code !== 0) throw new Error(g.stderr.trim().split("\n")[0]);
        if (key() !== context) return;
        this.pr = JSON.parse(g.stdout).data.repository.pullRequest; this.error = null;
      } catch (e) { if (key() === context) this.error = String(e); }
      finally { this.loading = false; cx.notify(); }
    });
    cx.notify();
  }

  openUrl(url) { if (url) exec("open", [url]); }

  section(title, count, body, t) {
    return v_flex().w_full().flex_none().gap(6).py(10).border_b(1).border_color(t.border)
      .child(h_flex().items_center().gap(6).child(div().text_size(11).font_semibold().text_color(t.muted).child(title.toUpperCase()))
        .when(count != null, (e) => e.child(div().text_size(10).text_color(t.dim).child(String(count)))))
      .child(body);
  }

  pill(text, color, t) {
    return div().px(6).py(1).rounded(4).border_1().border_color(color).text_size(10).text_color(color).child(text);
  }

  render(cx) {
    if (key() !== this.context) this.refresh(cx);
    const t = theme(), pr = this.pr;
    const header = h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().font_semibold().child("Pull request"))
      .child(div().flex_1())
      .child(div().id("pr-refresh").px(6).rounded(5).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.refresh(cx)).child(this.loading ? "…" : "↻"));
    const root = v_flex().id("pr").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(12).child(header);
    if (!pr) return root.child(div().p(14).text_color(t.dim).child(this.error || (this.loading ? "Loading PR…" : "No folder")));

    const stateColor = pr.merged ? t.ansi5 : pr.state === "CLOSED" ? t.ansi1 : pr.isDraft ? t.dim : t.ansi2;
    const stateText = pr.merged ? "Merged" : pr.state === "CLOSED" ? "Closed" : pr.isDraft ? "Draft" : "Open";
    const decision = { APPROVED: ["Approved", t.ansi2], CHANGES_REQUESTED: ["Changes requested", t.ansi1], REVIEW_REQUIRED: ["Review required", t.blocked] }[pr.reviewDecision] || ["No decision", t.dim];
    const merge = { CLEAN: ["Ready to merge", t.ansi2], BEHIND: ["Behind base", t.blocked], BLOCKED: ["Blocked", t.blocked], DIRTY: ["Conflicts", t.ansi1], UNSTABLE: ["Checks failing", t.ansi1], HAS_HOOKS: ["Ready", t.ansi2], DRAFT: ["Draft", t.dim] }[pr.mergeStateStatus] || [pr.mergeStateStatus || "", t.dim];

    // Checks
    const rollup = pr.commits.nodes[0]?.commit.statusCheckRollup;
    const checks = (rollup?.contexts.nodes || []).map((c) => c.__typename === "CheckRun"
      ? { name: c.name, url: c.detailsUrl, s: c.status !== "COMPLETED" ? "pending" : ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(c.conclusion) ? "ok" : "fail" }
      : { name: c.context, url: c.targetUrl, s: c.state === "SUCCESS" ? "ok" : c.state === "PENDING" || c.state === "EXPECTED" ? "pending" : "fail" });
    const order = { fail: 0, pending: 1, ok: 2 };
    checks.sort((a, b) => order[a.s] - order[b.s]);
    const nFail = checks.filter((c) => c.s === "fail").length, nPend = checks.filter((c) => c.s === "pending").length;
    const mark = { ok: ["✓", t.ansi2], fail: ["✗", t.ansi1], pending: ["●", t.blocked] };

    // Reviewers
    // latestReviews = newest review per author, even a bare COMMENTED one that
    // masks an earlier APPROVED. Opinionated reviews (approve/changes) win; plain
    // commenters are appended after.
    const reviewed = new Map(pr.latestOpinionatedReviews.nodes.map((r) => [r.author?.login, r]));
    for (const r of pr.latestReviews.nodes) if (!reviewed.has(r.author?.login)) reviewed.set(r.author?.login, r);
    const requested = pr.reviewRequests.nodes.map((n) => n.requestedReviewer?.login || n.requestedReviewer?.name).filter(Boolean).filter((n) => !reviewed.has(n));
    const rv = { APPROVED: ["✓ approved", t.ansi2], CHANGES_REQUESTED: ["✗ changes", t.ansi1], COMMENTED: ["● commented", t.muted], DISMISSED: ["dismissed", t.dim], PENDING: ["pending", t.dim] };

    // Threads
    const threads = pr.reviewThreads.nodes;
    const unresolved = threads.filter((x) => !x.isResolved);
    const threadRow = (th, i) => {
      const first = th.comments.nodes[0], id = `th${i}`, expanded = this.open[id];
      return v_flex().id(`pr-${id}`).w_full().gap(3).p(8).rounded(7).bg(t.surface).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.open[id] = !this.open[id]; cx.notify(); })
        .child(h_flex().gap(6).items_center()
          .child(div().text_size(10).text_color(th.isResolved ? t.ansi2 : t.blocked).child(th.isResolved ? "✓" : "●"))
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(`${th.path}${th.line ? ":" + th.line : ""}`))
          .when(th.isOutdated, (e) => e.child(div().text_size(10).text_color(t.dim).child("outdated")))
          .child(div().text_size(10).text_color(t.dim).child(`${th.comments.nodes.length}💬`)))
        .children((expanded ? th.comments.nodes : [first]).map((c) => v_flex().gap(1)
          .child(h_flex().gap(6).child(div().font_semibold().text_size(11).child(c.author?.login || "ghost")).child(div().text_size(10).text_color(t.dim).child(ago(c.createdAt))))
          .child(div().text_color(t.muted).child(clean(c.body, expanded ? 600 : 160)))))
        .when(expanded, (e) => e.child(div().id(`pr-${id}-open`).text_size(11).text_color(t.accent).on_click((ev, cx) => { cx.stop_propagation(); this.openUrl(first.url); }).child("Open on GitHub ↗")));
    };
    const comments = pr.comments.nodes.slice().reverse();

    const body = v_flex().w_full().px(14).pb(14)
      // title + status
      .child(v_flex().w_full().gap(6).py(12).border_b(1).border_color(t.border)
        .child(div().id("pr-title").font_semibold().text_size(13).cursor_pointer().on_click(() => this.openUrl(pr.url)).child(`#${pr.number} ${pr.title}`))
        .child(h_flex().gap(6).flex_wrap().child(this.pill(stateText, stateColor, t)).child(this.pill(decision[0], decision[1], t)).child(this.pill(merge[0], merge[1], t)))
        .child(div().text_color(t.dim).text_size(11).truncate().child(`${pr.author?.login} · ${pr.headRefName} → ${pr.baseRefName}`))
        .child(h_flex().gap(8).text_size(11).child(div().text_color(t.ansi2).child(`+${pr.additions}`)).child(div().text_color(t.ansi1).child(`−${pr.deletions}`)).child(div().text_color(t.dim).child(`${pr.changedFiles} files`))))
      // checks
      .child(this.section("Checks", checks.length ? `${nFail ? nFail + " failing · " : ""}${nPend ? nPend + " running · " : ""}${checks.length - nFail - nPend} passing` : null,
        v_flex().gap(2).children(checks.length ? checks.slice(0, this.open.allChecks ? 50 : 8).map((c, i) => h_flex().id(`chk${i}`).gap(6).h(20).items_center().cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => this.openUrl(c.url))
          .child(div().w(12).text_color(mark[c.s][1]).child(mark[c.s][0])).child(div().flex_1().min_w(0).truncate().child(c.name)))
          .concat(checks.length > 8 ? [div().id("chk-more").text_size(11).text_color(t.accent).cursor_pointer().on_click((_e, cx) => { this.open.allChecks = !this.open.allChecks; cx.notify(); }).child(this.open.allChecks ? "Show less" : `Show all ${checks.length}`)] : [])
          : [div().text_color(t.dim).child("No checks")]), t))
      // reviewers
      .child(this.section("Reviewers", null, v_flex().gap(3).children([
        ...[...reviewed.values()].map((r) => h_flex().gap(8).child(div().flex_1().truncate().child(r.author?.login || "?")).child(div().text_size(11).text_color((rv[r.state] || rv.PENDING)[1]).child((rv[r.state] || [r.state])[0]))),
        ...requested.map((n) => h_flex().gap(8).child(div().flex_1().truncate().child(n)).child(div().text_size(11).text_color(t.blocked).child("requested"))),
        ...(!reviewed.size && !requested.length ? [div().text_color(t.dim).child("No reviewers")] : []),
      ]), t))
      // threads
      .child(this.section("Threads", `${unresolved.length} open · ${threads.length - unresolved.length} resolved`,
        v_flex().gap(6).children(threads.length ? [...unresolved, ...threads.filter((x) => x.isResolved)].map((th, i) => threadRow(th, i)) : [div().text_color(t.dim).child("No review threads")]), t))
      // comments
      .child(this.section("Comments", comments.length,
        v_flex().gap(8).children(comments.length ? comments.slice(0, 10).map((c) => v_flex().id(`cm-${c.url}`).gap(1).cursor_pointer().on_click(() => this.openUrl(c.url))
          .child(h_flex().gap(6).child(div().font_semibold().text_size(11).child(c.author?.login || "ghost")).child(div().text_size(10).text_color(t.dim).child(ago(c.createdAt))))
          .child(div().text_color(t.muted).child(clean(c.body)))) : [div().text_color(t.dim).child("No comments")]), t));

    return root.child(div().flex_1().min_h(0).relative()
      .child(v_flex().id("pr-scroll").absolute().inset_0().overflow_y_scroll().child(body))
      .child(Scrollbar.vertical("pr-scroll").absolute().inset_0()));
  }
}
