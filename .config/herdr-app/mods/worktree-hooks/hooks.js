// Worktree hooks, read at run time from the classic herdr plugin's config
// (~/.config/herdr/plugins/config/freethinkel.worktree-hooks/config.yml, synced by dotsync).
// The commands live only there: nothing from it is copied into this mod.
//
//   <project>: { dir: <main checkout>, git_worktree_hooks: { created: [...], removed: [...] } }
// A worktree is matched by its main checkout path (dir), else by basename(dir) == repo name.
// Env for every command: $PROJECT, $MAIN (main checkout), $WORKTREE, $EVENT.

import { readTextFile, home } from "herdr";
import { parseYaml } from "./yaml.js";

const CONFIG = (h) => `${h}/.config/herdr/plugins/config/freethinkel.worktree-hooks/config.yml`;
const expand = (p, h) => (p === "~" ? h : p.startsWith("~/") ? h + p.slice(1) : p).replace(/\/+$/, "");
const base = (p) => p.split("/").filter(Boolean).pop();

// { project, commands } for this repo and event ("created" | "removed"), or null.
export async function hooksFor(repo, event) {
  const h = home();
  let raw;
  try { raw = parseYaml(await readTextFile(CONFIG(h))); } catch { return null; } // no config: no hooks
  if (!raw || typeof raw !== "object") return null;
  let byName = null;
  for (const [name, entry] of Object.entries(raw)) {
    if (!entry || typeof entry.dir !== "string") continue;
    const dir = expand(entry.dir, h);
    const commands = (entry.git_worktree_hooks?.[event] ?? []).filter((c) => typeof c === "string" && c.trim());
    const hit = { project: name, commands };
    if (dir === repo.main) return commands.length ? hit : null;
    if (!byName && base(dir) === repo.name) byName = hit;
  }
  return byName?.commands.length ? byName : null;
}

export const hookEnv = (hit, repo, worktree, event) => [`PROJECT=${hit.project}`, `MAIN=${repo.main}`, `WORKTREE=${worktree}`, `EVENT=${event}`];

// argv for a terminal that runs the hooks (shown, so slow ones like npm install are visible),
// stops at the first failure, then execs `rest` (an agent), else the login shell.
// Commands travel in $HERDR_HOOKS, one per line, so no quoting of them is needed.
const SCRIPT = [
  'printf "%s\\n" "$HERDR_HOOKS" | while IFS= read -r c; do',
  '  printf "\\033[2m$ %s\\033[0m\\n" "$c"',
  '  sh -c "$c" || { printf "\\033[31mworktree hook failed (exit %s): %s\\033[0m\\n" "$?" "$c"; break; }',
  "done",
  'if [ "$#" -gt 0 ]; then exec "$@"; else exec "${SHELL:-/bin/sh}" -l; fi',
].join("\n");

export function hookArgv(hit, repo, worktree, rest) {
  return ["env", ...hookEnv(hit, repo, worktree, "created"), `HERDR_HOOKS=${hit.commands.join("\n")}`, "sh", "-c", SCRIPT, "sh", ...(rest ?? [])];
}
