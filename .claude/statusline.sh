#!/bin/bash
# ~/.claude/statusline.sh
#
# Line 1+: git repo/branch + PR link for each workspace dir
# Last line: three labeled bars + cost + session time
#
#   ctx  — context window fill (input + cache tokens / window size)
#          Tracks input-only because output tokens from the current response
#          haven't been sent yet; they'll count as input on the next call.
#          At 100% the conversation can't continue without compaction.
#
#   5hr  — rolling 5-hour rate limit (Pro/Max only; hidden when unavailable)
#          Subscription-level budget across ALL sessions.
#          You can have a fresh context window but still be rate-limited.
#
# Claude Code passes session JSON on stdin.

JSON=$(cat)

git_branch() {
  git -C "$1" rev-parse --abbrev-ref HEAD 2>/dev/null
}

# Returns "NUMBER|URL" for the open PR on the given branch, using a 5-min cache.
get_pr_info() {
  local dir="$1"
  local branch="$2"
  local cache_key
  cache_key=$(printf '%s:%s' "$dir" "$branch" | md5)
  local cache_file="/tmp/.claude-pr-cache-${cache_key}"

  if [ -f "$cache_file" ]; then
    local age
    age=$(( $(date +%s) - $(stat -f %m "$cache_file" 2>/dev/null || echo 0) ))
    if [ "$age" -lt 300 ]; then
      cat "$cache_file"
      return
    fi
  fi

  local result
  result=$(cd "$dir" && gh pr view --json number,url -q '"\(.number)|\(.url)"' 2>/dev/null)
  echo "$result" > "$cache_file"
  echo "$result"
}

show_dir() {
  local dir="$1"
  local repo branch
  repo=$(basename "$dir")
  branch=$(git_branch "$dir")

  printf '📁 \033[36m%s\033[0m \033[90mon\033[0m 🌿 \033[32m%s\033[0m' "$repo" "$branch"

  if [ -n "$branch" ] && command -v gh &>/dev/null; then
    local pr_info pr_url
    pr_info=$(get_pr_info "$dir" "$branch")
    if [ -n "$pr_info" ]; then
      pr_url=$(echo "$pr_info" | cut -d'|' -f2)
      if [ -n "$pr_url" ]; then
        printf ' · '
        printf '%b' "\e]8;;${pr_url}\a\033[33m${pr_url}\033[0m\e]8;;\a"
      fi
    fi
  fi
}

# Build a labeled progress bar: make_bar LABEL PCT
# Color: green < 70%, yellow 70-89%, red 90%+
make_bar() {
  local label="$1"
  local pct="$2"
  local GREEN='\033[32m' YELLOW='\033[33m' RED='\033[31m' DIM='\033[90m' RESET='\033[0m'

  local bar_color
  if [ "$pct" -ge 90 ]; then bar_color="$RED"
  elif [ "$pct" -ge 70 ]; then bar_color="$YELLOW"
  else bar_color="$GREEN"; fi

  local filled=$(( pct / 10 )) empty=$(( 10 - pct / 10 ))
  local fill="" pad=""
  [ "$filled" -gt 0 ] && printf -v fill "%${filled}s" && fill="${fill// /█}"
  [ "$empty"  -gt 0 ] && printf -v pad  "%${empty}s"  && pad="${pad// /░}"

  printf "${DIM}%s${RESET} ${bar_color}%s%s${RESET} ${pct}%%" "$label" "$fill" "$pad"
}

# ── Line 1+: repo rows ────────────────────────────────────────────────────────

PROJECT_DIR=$(echo "$JSON" | jq -r '.workspace.project_dir // .cwd // ""')
if [ -n "$PROJECT_DIR" ]; then
  show_dir "$PROJECT_DIR"
fi

while IFS= read -r DIR; do
  [ -z "$DIR" ] && continue
  printf '\n'
  show_dir "$DIR"
done < <(echo "$JSON" | jq -r '.workspace.added_dirs // [] | .[]')

# ── Stats line ────────────────────────────────────────────────────────────────

CTX_PCT=$(echo "$JSON" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
COST=$(echo "$JSON" | jq -r '.cost.total_cost_usd // 0')
DURATION_MS=$(echo "$JSON" | jq -r '.cost.total_duration_ms // 0')
RATE_5HR=$(echo "$JSON" | jq -r '.rate_limits.five_hour.used_percentage // empty' 2>/dev/null | cut -d. -f1)
RATE_7D=$(echo "$JSON" | jq -r '.rate_limits.seven_day.used_percentage // empty' 2>/dev/null | cut -d. -f1)

MINS=$(( DURATION_MS / 60000 ))
SECS=$(( (DURATION_MS % 60000) / 1000 ))
COST_FMT=$(printf '$%.2f' "$COST")
YELLOW='\033[33m'; RESET='\033[0m'

printf '\n'
make_bar "ctx" "$CTX_PCT"

if [ -n "$RATE_5HR" ]; then
  printf ' · '
  make_bar "5hr" "$RATE_5HR"
fi

if [ -n "$RATE_7D" ]; then
  printf ' · '
  make_bar "7d" "$RATE_7D"
fi


printf " · ${YELLOW}${COST_FMT}${RESET} · ⏱️  ${MINS}m ${SECS}s"

# ── Caveman badge ─────────────────────────────────────────────────────────────

CAVEMAN_FLAG="$HOME/.claude/.caveman-active"
if [ -f "$CAVEMAN_FLAG" ]; then
  printf ' \033[38;5;172m[🦴]\033[0m'
fi

# ── Model + effort badge ───────────────────────────────────────────────────────

RAW_MODEL=$(echo "$JSON" | jq -r 'if (.model | type) == "object" then .model.id else .model end // ""')
if [ -z "$RAW_MODEL" ]; then
  RAW_MODEL=$(jq -r '.model // ""' "$HOME/.claude/settings.json" 2>/dev/null)
fi
# Shorten: claude-sonnet-4-6 → sonnet, claude-opus-4-7 → opus, etc.
SHORT_MODEL=$(echo "$RAW_MODEL" | sed 's/^claude-//' | sed 's/-[0-9]\{1,2\}-[0-9]\{1,2\}$//')

EFFORT=$(jq -r '.effortLevel // ""' "$HOME/.claude/settings.json" 2>/dev/null)

if [ -n "$SHORT_MODEL" ] || [ -n "$EFFORT" ]; then
  LABEL="${SHORT_MODEL}"
  [ -n "$EFFORT" ] && [ -n "$SHORT_MODEL" ] && LABEL="${LABEL} · ${EFFORT}"
  [ -z "$SHORT_MODEL" ] && LABEL="${EFFORT}"
  printf ' \033[38;5;39m[%s]\033[0m' "$LABEL"
fi
