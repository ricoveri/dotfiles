// Jira search for the New worktree dialog. Nothing org-specific lives in this file
// (it is versioned): site, project key, email and token are entered in the dialog and
// kept in the macOS Keychain (service "herdr-jira", JSON { site, project, email, token }).
//
// Search is hybrid: fetchPool() loads the project's open tickets once, rank() filters and
// orders them locally on every keystroke, and searchIssues() asks Jira only when the local
// pool has too few hits (older or closed tickets).

import { exec } from "herdr";

const SERVICE = "herdr-jira";
const POOL = 100; // Jira's page cap; older tickets come through the server fallback

// "acme" or "acme.atlassian.net" or a full URL -> "https://acme.atlassian.net".
export function siteUrl(site) {
  let s = site.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (s && !s.includes(".")) s += ".atlassian.net";
  return s ? `https://${s}` : "";
}

export async function getCreds() {
  try {
    const r = await exec("security", ["find-generic-password", "-s", SERVICE, "-w"], { timeout: 15000 });
    if (r.code !== 0) return null;
    const c = JSON.parse(r.stdout.trim());
    return c?.site && c?.project && c?.email && c?.token ? c : null;
  } catch { return null; }
}

export async function saveCreds(creds) {
  const r = await exec("security", ["add-generic-password", "-U", "-s", SERVICE, "-a", "jira", "-w", JSON.stringify(creds)], { timeout: 15000 });
  if (r.code !== 0) throw new Error((r.stderr || "Couldn't save to Keychain.").trim());
}

export async function defaultEmail() {
  try {
    const r = await exec("git", ["config", "--global", "user.email"], { timeout: 5000 });
    return r.code === 0 ? r.stdout.trim() : "";
  } catch { return ""; }
}

async function get(creds, path) {
  const r = await exec("curl", ["-s", "-w", "\n%{http_code}", "-u", `${creds.email}:${creds.token}`, `${siteUrl(creds.site)}${path}`], { timeout: 20000 });
  const at = r.stdout.lastIndexOf("\n");
  return { code: Number(r.stdout.slice(at + 1)), body: r.stdout.slice(0, at) };
}

// Checks site, token and project before anything is saved. Resolves to the user's display name;
// throws an Error with a message fit to show.
export async function verifyCreds(creds) {
  const me = await get(creds, "/rest/api/3/myself");
  if (me.code === 401 || me.code === 403) throw new Error("Jira rejected the email or token.");
  if (me.code !== 200) throw new Error(me.code ? `Couldn't reach Jira at that site (HTTP ${me.code}).` : "Couldn't reach Jira at that site.");
  const project = await get(creds, `/rest/api/3/project/${encodeURIComponent(creds.project)}`);
  if (project.code === 404) throw new Error(`Project ${creds.project} not found, or your account can't see it.`);
  if (project.code !== 200) throw new Error(`Couldn't check project ${creds.project} (HTTP ${project.code}).`);
  try { return JSON.parse(me.body).displayName || creds.email; } catch { return creds.email; }
}

const esc = (s) => s.replace(/[\\"]/g, "\\$&");

// Each space-separated word must appear (as a word prefix), so "quer dup" narrows like the local ranker.
function jqlFor(q, project) {
  q = q.trim();
  const key = /^(?:([A-Za-z][A-Za-z0-9]*)-?)?(\d+)$/.exec(q);
  const byKey = key ? `key = ${(key[1] ?? project).toUpperCase()}-${key[2]} OR ` : "";
  const words = q.split(/\s+/).filter(Boolean).map((w) => `text ~ "${esc(w)}*"`).join(" AND ");
  return `${byKey}(project = ${project} AND ${words}) ORDER BY updated DESC`;
}

// Runs a JQL search -> [{ key, summary, status, type, done }]. Throws Error("auth") on 401/403.
async function query(creds, jql, max) {
  const r = await exec("curl", [
    "-s", "-w", "\n%{http_code}", "-u", `${creds.email}:${creds.token}`, "-G", `${siteUrl(creds.site)}/rest/api/3/search/jql`,
    "--data-urlencode", `jql=${jql}`,
    "--data-urlencode", "fields=summary,status,issuetype",
    "--data-urlencode", `maxResults=${max}`,
  ], { timeout: 30000 });
  const at = r.stdout.lastIndexOf("\n");
  const code = Number(r.stdout.slice(at + 1));
  if (code === 401 || code === 403) throw new Error("auth");
  if (code !== 200) throw new Error(`Jira ${code || "unreachable"}`);
  const data = JSON.parse(r.stdout.slice(0, at));
  // Jira answers a bad token with 200 and no issues (it treats the call as anonymous), so an
  // empty result must be checked against /myself before it can be called "no matches".
  if (!(data.issues ?? []).length && (await get(creds, "/rest/api/3/myself")).code !== 200) throw new Error("auth");
  return (data.issues ?? []).map((i) => ({
    key: i.key,
    summary: i.fields?.summary ?? "",
    status: i.fields?.status?.name ?? "",
    type: i.fields?.issuetype?.name ?? "",
    done: i.fields?.status?.statusCategory?.key === "done",
  }));
}

// The project's open tickets, most recently updated first: the local search pool.
export const fetchPool = (creds) => query(creds, `project = ${creds.project} AND statusCategory != Done ORDER BY updated DESC`, POOL);

// Server-side fallback for tickets outside the pool.
export const searchIssues = (q, creds) => query(creds, jqlFor(q, creds.project), 20);

// ---- local fuzzy ranking ----------------------------------------------------------------

// Position of w in s where a word starts, else -1.
function wordAt(s, w) {
  for (let i = s.indexOf(w); i >= 0; i = s.indexOf(w, i + 1)) if (i === 0 || !/[a-z0-9]/.test(s[i - 1])) return i;
  return -1;
}

// Typo / abbreviation tolerance: w's letters in order inside one word of s, starting at that word's
// first letter ("jckson" ~ "jacksonerror"). Within a single word so long sentences don't match by chance.
function typo(s, w) {
  if (w.length < 3) return false;
  return s.split(/[^a-z0-9]+/).some((tok) => {
    if (tok[0] !== w[0]) return false;
    let i = 0;
    for (const ch of tok) if (ch === w[i] && ++i === w.length) return true;
    return false;
  });
}

// Lower is better, null = no match. Every word must match somewhere.
function score(it, words) {
  const key = it.key.toLowerCase();
  const num = key.slice(key.indexOf("-") + 1);
  const sum = it.summary.toLowerCase();
  let total = 0;
  for (const w of words) {
    const dashed = w.replace(/^([a-z][a-z0-9]*?)(\d+)$/, "$1-$2"); // app13879 -> app-13879
    if (key.startsWith(w) || key.startsWith(dashed) || (/^\d+$/.test(w) && num.startsWith(w))) total += 0;
    else if (wordAt(sum, w) === 0) total += 1;
    else if (wordAt(sum, w) > 0) total += 2;
    else if (key.includes(w) || sum.includes(w)) total += 3;
    else if (it.status.toLowerCase().includes(w) || it.type.toLowerCase().includes(w)) total += 4;
    else if (typo(`${key} ${sum}`, w)) total += 5;
    else return null;
  }
  return total;
}

// The pool filtered and ordered for q. An empty query keeps the pool's own order (recently updated).
export function rank(pool, q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return pool;
  return pool.map((it, i) => ({ it, i, s: score(it, words) })).filter((x) => x.s !== null).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.it);
}
